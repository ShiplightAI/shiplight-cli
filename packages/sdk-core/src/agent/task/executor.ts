/**
 * Task Executor
 *
 * Autonomous agent for browser automation tasks using JSON-based LLM responses.
 * Simplified from tool calling to single JSON response per step.
 */

import { generateText } from 'ai';
import { Page } from 'playwright';
import { ActionEntity } from '../../actions/types';
import { waitForPageAndFramesLoad } from '../../browser/browserUtils';
import { DomService } from '../../dom';
import { toolRegistry } from '../../llm_tools/registry';
import { getActionEntityLocatorInfo } from '../../llm_tools/utils';
import { ActionGenerationDebugInfo, MessageForLogging, MessagePartForLogging, TokenUsage } from 'shiplight-types';
import { getModel, getProviderOptions, resolveTemperature } from '../llm';
import {
	shouldFallBackToNextModel,
	resolveLlmTimeoutMs,
	combineAbortSignals,
} from './modelFallback';
import { TaskMessageManager } from './messageManager';
import { getBrowserTaskJSONPrompt } from './prompts';
import {
	TaskExecutionContext,
	TaskExecutionOptions,
	TaskExecutionResult,
	TaskExecutionState,
	TaskStepOutput,
	TaskStepRecord,
} from './types';
import { agentLogger } from '../../utils/agentLogger';
import { convertUsageToTokenUsage } from '../../utils/tokenUsage';
import { withLlmTimeout } from '../llm/timeout';

/**
 * Result from planNextAction including debug info
 */
interface PlanResult {
	stepOutput: TaskStepOutput | null;
	debugInfo?: ActionGenerationDebugInfo;
	tokenUsages?: TokenUsage[];
	/** Index into the model chain that served this step. The run loop carries
	 *  it forward so subsequent steps start from the last working model instead
	 *  of re-probing a failing primary (sticky fallback within a run). */
	modelIndexUsed?: number;
}

/**
 * Execute a task using AI-powered browser automation with JSON responses
 */
export async function runTaskLoop(
	task: string,
	context: TaskExecutionContext,
	options: TaskExecutionOptions = {}
): Promise<TaskExecutionResult> {
	const startTime = Date.now();
	if (options.maxSteps !== undefined && options.maxSteps <= 0) {
		throw new Error(`maxSteps must be >= 1, got ${options.maxSteps}`);
	}
	const maxSteps = options.maxSteps ?? 15;
	const maxFailures = 3;
	// Primary model plus any fallback models (WEB_AGENT_FALLBACK_MODELS; on by
	// default, opt out with WEB_AGENT_FALLBACK_MODELS="").
	// The chain is tried in order on availability failure; `modelStartIndex`
	// makes the fallback sticky across steps so a failing primary is not
	// re-probed every step once we have moved on to a working model.
	const primaryModel = context.agentServices.getModel();
	const modelChain = [primaryModel, ...context.agentServices.getFallbackModels().filter((m) => m !== primaryModel)];
	let modelStartIndex = 0;
	// The model that actually served the most recent step (may differ from the
	// primary once we have failed over). Reported in the result metadata.
	let lastUsedModel = primaryModel;

	// Ensure DOM service is created if not provided
	// Note: DomService no longer stores page - page is passed to each method
	const domService = context.domService || new DomService(context.agentServices.getDomServiceOptions());
	const executionContext: TaskExecutionContext = {
		...context,
		domService,
	};

	// Initialize agent logger
	agentLogger.init();
	agentLogger.section('Task Execution Started');
	agentLogger.log(`Task: ${task}`);
	agentLogger.log(`Max steps: ${maxSteps}`);
	agentLogger.log(`Model: ${modelChain.length > 1 ? modelChain.join(' → ') : primaryModel}`);

	// Track new tabs/pages opened during execution

	// Initialize state
	const state: TaskExecutionState = {
		currentStep: 0,
		maxSteps,
		consecutiveFailures: 0,
		maxFailures,
		lastFailReason: null,
		stepHistory: [],
		memory: [],
		lastGoal: null,
		lastEvaluation: null,
	};

	// Track all token usages across steps
	const allTokenUsages: TokenUsage[] = [];

	// Initialize message manager
	const systemPrompt = getBrowserTaskJSONPrompt(options.customPrompt);
	const messageManager = new TaskMessageManager(systemPrompt);
	agentLogger.log(`System prompt length: ${systemPrompt.length} chars`);

	let completed = false;
	let summary = '';
	const actionEntities: ActionEntity[] = [];

	try {
		options.onEvent?.({ type: 'start', task, maxSteps });

		// Main execution loop
		while (state.currentStep < maxSteps) {
			// Check for abort signal
			if (options.abortSignal?.aborted) {
				throw new Error('Task aborted by user');
			}
			state.currentStep++;
			const stepStartTime = Date.now();

			agentLogger.section(`Step ${state.currentStep}/${maxSteps}`);
			agentLogger.log(`URL: ${executionContext.page.url()}`);
			options.onEvent?.({ type: 'step_start', step: state.currentStep });

			// Wait for page to stabilize before preparing context
			try {
				agentLogger.log(`Waiting for page to stabilize...`);
				await waitForPageAndFramesLoad(executionContext.page);
				agentLogger.log('Page stabilized');
			} catch (error) {
				agentLogger.log('Page stabilization timed out, continuing anyway');
			}

			// Prepare context (DOM + screenshot)
			let pageSnapshot: PageSnapshot;
			try {
				agentLogger.log('Preparing context (DOM + screenshot)...');
				const interactiveClassNames = executionContext.agentServices.getInteractiveClassNames();
				const playwrightFrameFallbackDomains = executionContext.agentServices.getIframeFallbackDomains();
				pageSnapshot = await snapshotPage(
					executionContext.page,
					executionContext.domService,
					interactiveClassNames,
					playwrightFrameFallbackDomains
				);
				agentLogger.log('Context prepared');
			} catch (error) {
				const errorMsg = (error as Error).message;
				if (errorMsg.includes('Execution context was destroyed')) {
					// Page is navigating, wait and retry
					agentLogger.log('Page navigating, waiting for load...');
					await waitForPageAndFramesLoad(executionContext.page);
					const interactiveClassNames = executionContext.agentServices.getInteractiveClassNames();
					const playwrightFrameFallbackDomains = executionContext.agentServices.getIframeFallbackDomains();
					pageSnapshot = await snapshotPage(
						executionContext.page,
						executionContext.domService,
						interactiveClassNames,
						playwrightFrameFallbackDomains
					);
				} else {
					agentLogger.error('Error preparing context', error as Error);
					throw error;
				}
			}

			// Add state message to conversation
			messageManager.addStateMessage(
				task,
				pageSnapshot.currentUrl,
				pageSnapshot.domTree,
				pageSnapshot.screenshotBase64,
				state,
				{
					isFinalStep: state.currentStep === maxSteps - 1,
					placeholderData: context.variables,
					sensitiveKeys: context.sensitiveKeys,
				}
			);

			// Plan next action (get JSON response from LLM)
			const planResult = await planNextAction(
				messageManager,
				modelChain,
				modelStartIndex,
				options,
				pageSnapshot.screenshotBase64
			);

			// Sticky fallback: subsequent steps start from the model that just
			// worked, not the failing primary.
			if (typeof planResult.modelIndexUsed === 'number') {
				modelStartIndex = planResult.modelIndexUsed;
				lastUsedModel = modelChain[planResult.modelIndexUsed] ?? lastUsedModel;
			}

			// Collect token usages from this step
			if (planResult.tokenUsages && planResult.tokenUsages.length > 0) {
				allTokenUsages.push(...planResult.tokenUsages);
			}

			if (!planResult.stepOutput) {
				// Failed to get valid response
				agentLogger.error('Failed to get valid LLM response');
				state.consecutiveFailures++;
				if (state.consecutiveFailures >= maxFailures) {
					summary = `Reached the maximum allowed consecutive failures. Most recent error: Unable to get a valid response from the language model.`;
					break;
				}
				continue;
			}

			const stepOutput = planResult.stepOutput;

			// Log step information
			logStepInfo(state.currentStep, maxSteps, stepOutput);

			// Execute the planned actions (streams action events after each successful execution)
			const executionResult = await executeActions(
				stepOutput,
				executionContext,
				pageSnapshot.domState,
				state.currentStep,
				options.onEvent,
				pageSnapshot.screenshotBase64,
				planResult.debugInfo
			);

			// Add executed actions to collection
			actionEntities.push(...executionResult.actionEntities);

			// Post-process step results
			const record = postProcessStep(
				state.currentStep,
				stepOutput,
				executionResult,
				state,
				stepStartTime,
				planResult.debugInfo,
				planResult.tokenUsages
			);

			const stepDuration = Date.now() - stepStartTime;
			options.onEvent?.({
				type: 'step_complete',
				step: state.currentStep,
				duration: stepDuration,
			});

			// Check for consecutive failures
			if (state.consecutiveFailures >= maxFailures) {
				agentLogger.error(`Too many consecutive failures (${state.consecutiveFailures}), stopping`);
				summary = `Reached the maximum allowed consecutive failures. Most recent error: ${state.lastFailReason}`;
				break;
			}

			// Check if task is complete (either via done action or completes_instruction flag)
			if (executionResult.doneResult) {
				completed = executionResult.doneResult.success;
				summary = executionResult.doneResult.summary;
				break;
			}
			if (executionResult.completesInstruction) {
				completed = true;
				summary = 'Instruction completed';
				break;
			}
		}

		// Check completion status
		if (state.currentStep >= maxSteps && !completed) {
			summary = `Reached the maximum allowed steps.`;
		}

		options.onEvent?.({ type: 'complete', totalSteps: state.currentStep, duration: Date.now() - startTime });

		agentLogger.log(`Build success result: summary=${summary}, completed=${completed}, actions=${actionEntities.length}, tokens=${allTokenUsages.length}`);
		return buildSuccessResult(state, actionEntities, completed, summary, startTime, allTokenUsages, lastUsedModel);
	} catch (error) {
		const errorMsg = (error as Error).message;
		agentLogger.error(`Task execution failed: ${errorMsg}`, error as Error);
		options.onEvent?.({ type: 'error', error: errorMsg, recoverable: false });

		return buildErrorResult(state, errorMsg, startTime, allTokenUsages, lastUsedModel);
	}
}

interface PageSnapshot {
	currentUrl: string;
	domTree: string;
	screenshotBase64: string;
	domState: any;
}

/**
 * Prepare context for the step (DOM + screenshot)
 */
async function snapshotPage(
	page: Page,
	domService: DomService,
	interactiveClassNames?: string[],
	playwrightFrameFallbackDomains?: string[]
): Promise<PageSnapshot>
 {
	const { domState, screenshotBase64 } = await domService.getClickableElementsWithScreenshot(page, {
		interactiveClassNames,
		playwrightFrameFallbackDomains,
	});
	const domTree = domState.elementTree.clickableElementsToString();

	return {
		currentUrl: page.url(),
		domTree,
		screenshotBase64,
		domState,
	};
}

/**
 * Convert messages to MessageForLogging format for debug info
 * Preserves the JSON structure instead of flattening to text
 */
function convertMessagesToLoggingFormat(messages: any[]): MessageForLogging[] {
	return messages.map((msg) => ({
		role: msg.role,
		content: Array.isArray(msg.content)
			? msg.content.map((part: any): MessagePartForLogging => {
					if (part.type === 'file') {
						const imageData = part.data;
						// Check if it's a URL or base64 data
						const base64Data = typeof imageData === 'string' ? imageData : '';
						return {
							type: 'image',
							file: base64Data.startsWith('data:') ? base64Data : `data:image/png;base64,${base64Data}`,
						};
					}
					return { type: 'text', text: part.text };
			  })
			: msg.content,
	}));
}

/**
 * Plan next action - get JSON response from LLM
 */
async function planNextAction(
	messageManager: TaskMessageManager,
	models: string[],
	startIndex: number,
	options: TaskExecutionOptions,
	screenshotBase64?: string
): Promise<PlanResult> {
	// Count images across all messages to determine provider options.
	const { messages: initialMessages } = messageManager.getMessages();
	let imageCount = 0;
	for (const msg of initialMessages) {
		if (Array.isArray(msg.content)) {
			imageCount += msg.content.filter((part: any) => part.type === 'file').length;
		}
	}

	const timeoutMs = resolveLlmTimeoutMs();
	// How many times to re-prompt the SAME model when it returns unparseable
	// output (an agent-level issue, distinct from provider availability).
	const JSON_PARSE_RETRIES = 3;

	const firstIndex = Math.max(0, Math.min(startIndex, models.length - 1));

	// Outer loop: model fallback. Same-model transient retry (exponential
	// backoff, Retry-After) is handled inside generateText by the AI SDK — we
	// only advance to the next model when a model is genuinely unavailable.
	for (let mi = firstIndex; mi < models.length; mi++) {
		const model = models[mi];
		const isLastModel = mi === models.length - 1;
		const providerOptions = getProviderOptions(model, imageCount);
		// Per-model: sampling-free Anthropic models (Opus 4.7/4.8, Sonnet 5,
		// Fable 5) 400 on a non-default temperature, and a 400 does not fall back
		// — so resolveTemperature returns undefined for them and we omit the field.
		const temperature = resolveTemperature(model, options.temperature);

		try {
			// Inner loop: re-prompt the same model on unparseable JSON output.
			for (let jsonAttempt = 0; jsonAttempt < JSON_PARSE_RETRIES; jsonAttempt++) {
				// Re-read messages each attempt so a corrective note appended on a
				// prior parse failure is actually sent to the model.
				const { system, messages } = messageManager.getMessages();

				const generateConfig: any = {
					model: getModel(model),
					instructions: system,
					messages,
					providerOptions,
				};
				// Only send temperature when the model accepts it (see above).
				if (temperature !== undefined) {
					generateConfig.temperature = temperature;
				}

				// Bound each attempt so a hung upstream fails over instead of
				// stalling the whole run. Combine with any external cancel signal.
				const timeoutController = new AbortController();
				const timer =
					timeoutMs > 0 ? setTimeout(() => timeoutController.abort(), timeoutMs) : undefined;
				const signal = combineAbortSignals(
					options.abortSignal,
					timeoutMs > 0 ? timeoutController.signal : undefined
				);
				if (signal) generateConfig.abortSignal = signal;

				let result: Awaited<ReturnType<typeof generateText>>;
				try {
					const llmStartTime = Date.now();
					if (mi === firstIndex) {
						agentLogger.log(`Calling LLM (${model})...`);
					} else {
						agentLogger.log(`Calling LLM (${model}) [fallback ${mi}/${models.length - 1}]...`);
					}
					result = await withLlmTimeout((abortSignal) => generateText({ ...generateConfig, abortSignal }));
					const llmDuration = Date.now() - llmStartTime;
					agentLogger.llmCall(model, llmDuration, (result as any).usage);
				} finally {
					if (timer) clearTimeout(timer);
				}

				const resultAny = result as any;
				const usage = resultAny.usage;

				// Log native thinking
				const thinking = resultAny.reasoningText;
				if (thinking) {
					agentLogger.thinking(thinking);
					options.onEvent?.({ type: 'thinking', text: thinking });
				}

				// Save assistant response to conversation
				messageManager.addAssistantMessage(result.text);

				// Build debug info
				const debugInfo: ActionGenerationDebugInfo = {
					systemPrompt: system,
					userPrompt: convertMessagesToLoggingFormat(messages),
					rawLlmResponse: result.text,
					reasoningContent: thinking,
					screenshotWithSom: screenshotBase64,
				};

				// Build token usages
				const tokenUsages: TokenUsage[] = [];
				const tokenUsage = convertUsageToTokenUsage(usage, model);
				if (tokenUsage) {
					tokenUsages.push(tokenUsage);
				}

				// Parse JSON response
				const parsedOutput = parseLLMResponse(result.text);

				if (!parsedOutput) {
					// A parse failure is NOT a provider-availability problem — do not
					// fall back to another model; re-prompt the same model instead.
					if (jsonAttempt < JSON_PARSE_RETRIES - 1) {
						agentLogger.log(
							`Attempt ${jsonAttempt + 1}/${JSON_PARSE_RETRIES}: Failed to parse response, retrying...`
						);
						messageManager.addTextMessage(
							'user',
							'Your response was not valid JSON. Please respond with a properly formatted JSON object according to the expected format.'
						);
						continue;
					}
					agentLogger.error('All parsing attempts failed');
					return { stepOutput: null, debugInfo, tokenUsages, modelIndexUsed: mi };
				}

				return { stepOutput: parsedOutput, debugInfo, tokenUsages, modelIndexUsed: mi };
			}
		} catch (error) {
			// External cancellation (user/host abort) is terminal — never retry
			// or fall back.
			if (options.abortSignal?.aborted) {
				throw error;
			}
			if (!isLastModel && shouldFallBackToNextModel(error)) {
				agentLogger.log(
					`Model "${model}" failed (${(error as Error).message}); falling back to "${models[mi + 1]}"`
				);
				continue;
			}
			agentLogger.error('All LLM call attempts failed', error as Error);
			throw error;
		}
	}

	return { stepOutput: null };
}

/**
 * Parse LLM JSON response with error handling
 */
function parseLLMResponse(responseText: string): TaskStepOutput | null {
	// Strip markdown code fences if present
	let jsonText = responseText.trim();
	if (jsonText.startsWith('```json')) {
		jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```\s*$/, '');
	} else if (jsonText.startsWith('```')) {
		jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```\s*$/, '');
	}

	try {
		const parsed = JSON.parse(jsonText);

		// Validate required fields
		if (!parsed.current_goal) {
			agentLogger.error('Missing required field: current_goal');
			return null;
		}

		// Validate actions array
		if (!parsed.actions || !Array.isArray(parsed.actions) || parsed.actions.length === 0) {
			agentLogger.error('Missing required field: actions (must be non-empty array)');
			return null;
		}

		// Validate each action has required fields
		for (const action of parsed.actions) {
			if (!action.action_name) {
				agentLogger.error('Action missing required field: action_name');
				return null;
			}
			if (!action.description) {
				agentLogger.error('Action missing required field: description');
				return null;
			}
		}

		return parsed as TaskStepOutput;
	} catch (error) {
		agentLogger.error(`Failed to parse LLM JSON response: ${jsonText.substring(0, 500)}`);
		agentLogger.error(`Parse error: ${(error as Error).message}`);
		return null;
	}
}

/**
 * Execute the planned actions
 */
async function executeActions(
	stepOutput: TaskStepOutput,
	context: TaskExecutionContext,
	domState: any,
	step: number,
	onEvent?: (event: any) => void,
	initialScreenshot?: string,
	debugInfo?: ActionGenerationDebugInfo
): Promise<{
	allSuccess: boolean;
	failReason: string | null;
	actionEntities: ActionEntity[];
	doneResult: {
		success: boolean;
		summary: string;
	} | null;
	completesInstruction: boolean;
}> {
	const actionEntities: ActionEntity[] = [];
	let allSuccess = true;
	let failReason: string | null = null;

	agentLogger.log(`Using pre-captured DOM state with ${domState.selectorMap.size} elements for ${stepOutput.actions.length} action(s)`);
	let doneResult: {
		success: boolean;
		summary: string;
	} | null = null;
	// Create context with pre-captured DOM state
	const executionContext = {
		...context,
		domState, // Add pre-captured DOM state to context
	};

	// Track current "before" screenshot (starts with the step's initial screenshot)
	let currentScreenshotBefore = initialScreenshot;

	// Execute each action in sequence
	for (const action of stepOutput.actions) {
		if (action.action_name === 'done') {
			doneResult = {
				success: action.kwargs.success ?? true,
				// Backward compatibility: support both 'summary' (new) and 'text' (old) fields
				summary: action.kwargs.summary || action.kwargs.text || 'Task completed',
			};
			break;
		}
		// Build ActionEntity with locator info if action references an element by index
		// Check both 'index' and 'element_index' as LLM may use either
		let locatorInfo: { locator?: string; xpath?: string; frame_path?: string[] } = {};

		const elementIndex = action.kwargs?.element_index ?? action.kwargs?.index;
		if (typeof elementIndex === 'number') {
			const domElement = domState.selectorMap.get(elementIndex);
			if (domElement) {
				locatorInfo = await getActionEntityLocatorInfo(context.page, domElement);
			}
		}

		let actionEntity: ActionEntity = {
			...locatorInfo,
			action_description: action.description,
			action_data: {
				action_name: action.action_name,
				kwargs: action.kwargs,
			},
		};

		// Execute the action
		try {
			const result = await toolRegistry.execute(action.action_name, action.kwargs, executionContext);
			if (action.action_name === 'perform_accurate_operation') {
				actionEntity = result.actionEntity;
			}

			// Update page reference if TabManager has a different current page
			// (e.g., after tab switch). Only update if getCurrentPage returns a valid page.
			const currentPage = await executionContext.agentServices.getCurrentPage();
			if (currentPage) {
				executionContext.page = currentPage;
				context.page = executionContext.page;
			}

			const success = (result as any)?.success !== false;

			if (!success) {
				allSuccess = false;
				agentLogger.log(`Action failed, stopping execution of remaining actions in this step`);
				failReason = result.error || 'Action execution failed';
				break;
			}

			// Screenshot capture disabled for memory optimization
			// let screenshotAfter: string | undefined;
			// try {
			// 	const screenshotBuffer = await context.page.screenshot({ type: 'jpeg', quality: 80 });
			// 	screenshotAfter = screenshotBuffer.toString('base64');
			// } catch (err) {
			// 	agentLogger.log(`Failed to capture screenshot after action: ${(err as Error).message}`);
			// }

			// Stream action event after successful execution
			actionEntities.push(actionEntity);
			onEvent?.({
				type: 'action',
				action_entity: actionEntity,
				step,
				// screenshot_before: currentScreenshotBefore,
				// screenshot_after: screenshotAfter,
				debugInfo,
			});

			// Update screenshot_before for next action
			// currentScreenshotBefore = screenshotAfter;
		} catch (error) {
			allSuccess = false;
			failReason = (error as Error).message;
			agentLogger.error(`Action execution failed: ${(error as Error).message}`);
			break;
		}
	}

	return {
		allSuccess,
		failReason,
		actionEntities,
		doneResult,
		completesInstruction: stepOutput.completes_instruction ?? false,
	};
}

/**
 * Post-process step results
 */
function postProcessStep(
	stepNumber: number,
	stepOutput: TaskStepOutput,
	executionResult: {
		allSuccess: boolean;
		failReason: string | null;
		actionEntities: ActionEntity[];
		doneResult: {
			success: boolean;
			summary: string;
		} | null;
		completesInstruction: boolean;
	},
	state: TaskExecutionState,
	stepStartTime: number,
	debugInfo?: ActionGenerationDebugInfo,
	tokenUsages?: TokenUsage[]
): TaskStepRecord {
	// Create step record
	const record: TaskStepRecord = {
		stepNumber,
		thinking: stepOutput.thinking,
		evaluation: stepOutput.evaluation_previous_goal,
		memory: stepOutput.memory,
		goal: stepOutput.current_goal,
		actions: executionResult.actionEntities,
		timestamp: stepStartTime,
		duration: Date.now() - stepStartTime,
		outcome: {
			success: executionResult.allSuccess,
		},
		debugInfo,
		tokenUsages,
	};

	// Update state
	state.lastGoal = stepOutput.current_goal;

	if (stepOutput.evaluation_previous_goal) {
		state.lastEvaluation = stepOutput.evaluation_previous_goal;
	}

	if (stepOutput.memory && stepOutput.memory.trim()) {
		// Only add to memory if it's new information
		const trimmedMemory = stepOutput.memory.trim();
		if (!state.memory.includes(trimmedMemory)) {
			state.memory.push(trimmedMemory);
			// Keep only last 10 memory items to avoid context overflow
			if (state.memory.length > 10) {
				state.memory = state.memory.slice(-10);
			}
		}
	}

	// Update failure tracking
	if (executionResult.allSuccess) {
		state.consecutiveFailures = 0;
		state.lastFailReason = null;
	} else {
		state.consecutiveFailures++;
		state.lastFailReason = executionResult.failReason as string;
	}

	// Add to history
	state.stepHistory.push(record);

	return record;
}

/**
 * Log step information
 */
function logStepInfo(stepNumber: number, maxSteps: number, stepOutput: TaskStepOutput): void {
	// Log detailed info to agent log file
	agentLogger.log(`Step ${stepNumber}/${maxSteps}`);

	if (stepOutput.thinking) {
		agentLogger.log(`Thinking: ${stepOutput.thinking}`);
	}

	if (stepOutput.evaluation_previous_goal) {
		agentLogger.log(`Evaluation: ${stepOutput.evaluation_previous_goal}`);
	}

	if (stepOutput.memory) {
		agentLogger.log(`Memory: ${stepOutput.memory}`);
	}

	agentLogger.log(`Goal: ${stepOutput.current_goal}`);

	// Log all actions
	if (stepOutput.actions.length === 1) {
		const action = stepOutput.actions[0];
		agentLogger.log(`Action: ${action.action_name}(${JSON.stringify(action.kwargs)}) - ${action.description}`);
	} else {
		agentLogger.log(`Actions (${stepOutput.actions.length}):`);
		stepOutput.actions.forEach((action, i) => {
			agentLogger.log(`  ${i + 1}. ${action.action_name}(${JSON.stringify(action.kwargs)}) - ${action.description}`);
		});
	}
}


/**
 * Build success result
 */
function buildSuccessResult(
	state: any,
	actions: ActionEntity[],
	completed: boolean,
	summary: string,
	startTime: number,
	tokenUsages: TokenUsage[],
	model: string
): TaskExecutionResult {
	// Calculate aggregated token counts
	const totalPromptTokens = tokenUsages.reduce((sum, u) => sum + u.prompt_tokens, 0);
	const totalCompletionTokens = tokenUsages.reduce((sum, u) => sum + u.completion_tokens, 0);
	const totalTokens = tokenUsages.reduce((sum, u) => sum + u.total_tokens, 0);

	return {
		success: true,
		completed,
		summary,
		trajectory: {
			steps: state.currentStep,
			actions,
			stepRecords: state.stepHistory,
		},
		metadata: {
			totalSteps: state.currentStep,
			totalDuration: Date.now() - startTime,
			model,
			successfulSteps: state.stepHistory.filter((s: any) => s.outcome.success).length,
			failedSteps: state.stepHistory.filter((s: any) => !s.outcome.success).length,
			promptTokens: totalPromptTokens,
			completionTokens: totalCompletionTokens,
			totalTokens,
			tokenUsages,
		},
	};
}

/**
 * Build error result
 */
function buildErrorResult(
	state: any,
	error: string,
	startTime: number,
	tokenUsages: TokenUsage[],
	model: string
): TaskExecutionResult {
	// Calculate aggregated token counts
	const totalPromptTokens = tokenUsages.reduce((sum, u) => sum + u.prompt_tokens, 0);
	const totalCompletionTokens = tokenUsages.reduce((sum, u) => sum + u.completion_tokens, 0);
	const totalTokens = tokenUsages.reduce((sum, u) => sum + u.total_tokens, 0);

	return {
		success: false,
		completed: false,
		error,
		trajectory: {
			steps: state.currentStep,
			actions: [],
			stepRecords: state.stepHistory,
		},
		metadata: {
			totalSteps: state.currentStep,
			totalDuration: Date.now() - startTime,
			model,
			successfulSteps: state.stepHistory.filter((s: any) => s.outcome.success).length,
			failedSteps: state.stepHistory.filter((s: any) => !s.outcome.success).length,
			promptTokens: totalPromptTokens,
			completionTokens: totalCompletionTokens,
			totalTokens,
			tokenUsages,
		},
	};
}
