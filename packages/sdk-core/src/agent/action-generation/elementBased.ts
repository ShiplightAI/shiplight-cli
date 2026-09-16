import { AssistantModelMessage, generateText, NoObjectGeneratedError, Output, UserModelMessage } from 'ai';
import { z } from 'zod';
import { ActionEntity } from '../../actions/types';
import { ActionIntent } from '../../dom/types';
import { toolRegistry } from '../../llm_tools/registry';
import { toStrictOutputSchema } from '../../llm_tools/strictSchema';
import { OpenAIToolProvider } from '../../llm_tools/providers/openai';
import { getActionEntityLocatorInfo } from '../../llm_tools/utils';
import { agentLogger } from '../../utils/agentLogger';
import logger from '../../utils/logger';
import { convertUsageToTokenUsage } from '../../utils/tokenUsage';
import { buildPageContext } from '../../utils/pageContext';
import { ActionGenerationDebugInfo, MessageForLogging, MessagePartForLogging, TokenUsage } from 'shiplight-types';
import {  AgentOptions, GeneratedAction, TaskExecutionContext } from '../core/types';

import { getModel, getProviderOptions, resolveTemperature } from '../llm';
import { describeModelFallbackError, runWithModelFallback } from '../task/modelFallback';
import { getActionGenerationSystemPrompt, getActionGenerationUserPrompt } from './actionPrompts';
import { generateAction as generateActionWithCoordinatesBased } from './coordinatesBased';
import { withLlmTimeout, LLM_MAX_RETRIES } from '../llm/timeout';

/**
 * Determine action intent from a statement using simple keyword matching.
 * This is used to filter DOM elements to only those relevant to the likely action.
 *
 * @param statement - The user's goal/instruction
 * @returns ActionIntent: 'click', 'input', 'scroll', or 'all'
 */
function determineActionIntent(statement: string): ActionIntent {
	const lower = statement.toLowerCase();

	// Input intent: typing, entering, filling, etc.
	const inputPatterns = [
		/\b(type|enter|input|fill|write|set)\b/,
		/\b(text|value|field|box)\b.*\b(to|with|as)\b/,
		/\b(username|password|email|search|query)\b/,
	];
	if (inputPatterns.some(pattern => pattern.test(lower))) {
		return 'input';
	}

	// Scroll intent: scrolling, navigating down/up
	const scrollPatterns = [
		/\bscroll\b/,
		/\b(scroll|swipe)\s*(up|down|left|right)\b/,
		/\b(page|move)\s*(down|up)\b/,
	];
	if (scrollPatterns.some(pattern => pattern.test(lower))) {
		return 'scroll';
	}

	// Click intent: clicking, pressing, selecting, etc.
	const clickPatterns = [
		/\b(click|tap|press|select|choose|pick|check|toggle)\b/,
		/\b(open|close|submit|confirm|cancel|dismiss)\b/,
		/\b(button|link|menu|dropdown|checkbox|radio)\b/,
	];
	if (clickPatterns.some(pattern => pattern.test(lower))) {
		return 'click';
	}

	// Default to 'all' if we can't determine the intent
	return 'all';
}


/**
 * Extract text parts from multimodal user prompt content
 * Used for debug info - excludes images to keep logs readable
 */
function extractUserPromptText(content: any): string {
	if (typeof content === 'string') {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.filter((part: any) => part.type === 'text')
			.map((part: any) => part.text)
			.join('\n');
	}
	return '';
}

/**
 * Extract URL string from various image data formats
 */
function extractImageUrl(imageData: any): string | null {
	if (!imageData) return null;

	// Native URL object
	if (imageData instanceof URL) {
		return imageData.href;
	}

	// URL-like object with href property
	if (typeof imageData === 'object' && imageData.href) {
		return String(imageData.href);
	}

	// URL-like object with toString method (URL objects have this)
	if (typeof imageData === 'object' && typeof imageData.toString === 'function') {
		const str = imageData.toString();
		if (str.startsWith('http://') || str.startsWith('https://')) {
			return str;
		}
	}

	// String URL
	if (typeof imageData === 'string' && (imageData.startsWith('http://') || imageData.startsWith('https://'))) {
		return imageData;
	}

	return null;
}

/**
 * Convert messages to logging format
 * Images are converted to data URLs (base64) or kept as regular URLs
 */
function convertMessagesToLoggingFormat(messages: any[]): MessageForLogging[] {
	return messages.map((msg) => ({
		role: msg.role,
		content: Array.isArray(msg.content)
			? msg.content.map((part: any): MessagePartForLogging => {
					if (part.type === 'file') {
						const imageData = part.data;
						// Check if it's a URL, otherwise treat as base64
						const imageUrl = extractImageUrl(imageData);
						if (imageUrl) {
							return { type: 'image', file: imageUrl };
						}
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
 * Generate a single action from LLM using JSON mode
 *
 * This is the core function that:
 * 1. Gets fresh DOM state and screenshot
 * 2. Calls LLM with browser context in JSON mode (optionally with chat history)
 * 3. Parses JSON response to extract action and completion flag
 *
 * @param statement - User's goal/instruction
 * @param context - Agent context with page, agent, domService
 * @param options - Agent options (model, temperature, chatHistory, etc.)
 * @returns Generated action result (always returns, never throws)
 */
export async function generateAction(
	statement: string,
	context: TaskExecutionContext,
	options: AgentOptions = {}
): Promise<GeneratedAction> {
	const { page, agentServices } = context;
	const model = agentServices.getModel();

	// Retrieve knowledges for this statement via callback
	const knowledgePromise = agentServices
		.retrieveKnowledges(statement)
		.catch((error) => {
			agentLogger.log(`Failed to retrieve knowledges: ${error.message}`);
			return [];
		});

	// Get organization settings
	const useSlicedScreenshots = agentServices.isSlicedScreenshotsEnabled();
	const resizeSlicedScreenshots = agentServices.isResizeSlicedScreenshotsEnabled();
	const enableKnowledgeImages = agentServices.isKnowledgeImagesEnabled();
	const useAccessibilityTree = agentServices.isAccessibilityTreeEnabled();
	const useActionIntentFiltering = agentServices.isActionIntentFilteringEnabled();

	// Determine action intent from statement (if filtering is enabled)
	const actionIntent = useActionIntentFiltering ? determineActionIntent(statement) : 'all';
	if (useActionIntentFiltering && actionIntent !== 'all') {
		agentLogger.log(`Action intent filtering: detected '${actionIntent}' intent from statement`);
	}

	// Build page context (DOM state, screenshot, page context)
	const { screenshotBase64, domState, pageContext } =
		await buildPageContext(context, { useSlicedScreenshots, resizeSlicedScreenshots, useAccessibilityTree, actionIntent });
	context.domState = domState;

	// Get tool descriptions for the prompt
	const provider = new OpenAIToolProvider(toolRegistry);
	const openaiTools = provider.getToolDefinitions();
	const toolDescriptions = openaiTools
		.map((tool: any) => {
			const func = tool.function;
			return `${func.name}: ${func.description}\nParameters: ${JSON.stringify(func.parameters, null, 2)}`;
		})
		.join('\n\n');

	// Build system prompt with tool descriptions
	const systemPrompt = getActionGenerationSystemPrompt(toolDescriptions);
	const knowledges = await knowledgePromise;

	// Build the current user prompt with browser state, execution history, and goal
	const userPrompt = getActionGenerationUserPrompt(
		pageContext,
		statement,
		context.variables,
		context.executionHistory,
		knowledges.length > 0 ? knowledges : undefined,
		screenshotBase64,
		useSlicedScreenshots,
		undefined, // currentTime - use default
		enableKnowledgeImages,
		context.sensitiveKeys
	);

	// Build messages array - start with chat history (if provided), then add current state
	const messages: Array<UserModelMessage | AssistantModelMessage> = [];

	// Add previous conversation messages (for copilot mode)
	if (options.chatHistory && options.chatHistory.length > 0) {
		options.chatHistory.forEach((msg) => {
			if (msg.role === 'user') {
				messages.push({
					role: 'user',
					content: msg.content,
				});
			} else if (msg.role === 'assistant') {
				messages.push({
					role: 'assistant',
					content: msg.content,
				});
			}
		});
	}

	// Add current user message with screenshot
	messages.push({
		role: 'user',
		content: userPrompt,
	});

	// Create messagesForLogging for debugInfo (processes images without saving files)
	const userMessagesForDebug = convertMessagesToLoggingFormat(messages);

	// Build action schema dynamically from tool registry
	// Each registered tool's schema is wrapped as { toolName: schema } and combined into a union
	// This gives Gemini explicit schema guidance while being plug-and-play for new actions
	const actionSchema = toolRegistry.buildActionUnionSchema();

	const actionResponseSchema = z.object({
		thought: z.string().describe('Step by step reasoning of your decision making process').optional().default(''),
		description: z.string().describe('Detailed description of the action to be performed').optional().default(''),
		action: actionSchema,
		completes_instruction: z.boolean().describe('Whether this action completes the given instruction').optional().default(true),
	});

	// Submit a strict-valid view of the schema. Every `.optional()` above and in
	// any tool schema in the union would otherwise be missing from `required`,
	// which OpenAI's strict structured outputs reject outright — the request
	// fails before the model is consulted, so the AI fallback can never run.
	// The transform parses back to the same values, so nothing downstream changes.
	const submittedResponseSchema = toStrictOutputSchema(actionResponseSchema);

	// Count images in userPrompt to determine provider options
	// Vertex AI only supports HIGH resolution for single images
	const imageCount = Array.isArray(userPrompt)
		? userPrompt.filter((part: any) => part.type === 'file').length
		: 0;
	// Model chain: primary + configured fallbacks (deduped), tried in order on an
	// availability failure (429/5xx/timeout). Without this, a primary-model Vertex
	// 429 fails the whole test — the fallback chain previously only wrapped the
	// runTask loop, not this single-shot action-generation path (incident: result
	// 198883). `usedModel` tracks which model actually served, for token labeling.
	const modelChain = [model, ...agentServices.getFallbackModels().filter((m) => m !== model)];
	let usedModel = model;

	// Call LLM with generateText + Output.object() to enforce structured JSON output
	let result: Awaited<ReturnType<typeof generateText>>;
	try {
		result = await runWithModelFallback(
			modelChain,
			(candidateModel) => {
				usedModel = candidateModel;
				// Sampling-free Anthropic models (Opus 4.7/4.8, Sonnet 5, Fable 5) 400
				// on a non-default temperature, and a 400 does not fall back — so
				// resolve per candidate and omit the field when it returns undefined.
				const temperature = resolveTemperature(candidateModel, options.temperature);
				return withLlmTimeout((abortSignal) => generateText({
					model: getModel(candidateModel),
					abortSignal,
					instructions: systemPrompt,
					messages,
					...(temperature !== undefined ? { temperature } : {}),
					output: Output.object({ schema: submittedResponseSchema }),
					// Provider options are model-specific (Vertex vs API-key auth key,
					// thinking config), so resolve them per candidate model.
					providerOptions: getProviderOptions(candidateModel, imageCount),
					maxRetries: LLM_MAX_RETRIES,
				}));
			},
			(failedModel, nextModel, error) => {
				const message =
					`Action-gen model ${failedModel} failed (${describeModelFallbackError(error)}); ` +
					`falling back to ${nextModel}`;
				agentLogger.log(message);
				logger.debug(message);
			},
		);
	} catch (err) {
		// The action union schema cannot represent an empty / "no matching element" action,
		// even though the prompt instructs the model to return one when nothing matches
		// (see actionPrompts.ts). When the model finishes normally (finishReason 'stop') but
		// returns such an empty (or otherwise schema-invalid) action, Output.object() throws
		// NoObjectGeneratedError, surfacing a generic "response did not match schema" message.
		// Recover the model's own reasoning from the raw response so the failure is
		// self-explanatory instead of misleading.
		//
		// NOTE: generateText only parses (and thus only throws here) when finishReason ===
		// 'stop' (see ai/dist: output is resolved under that guard). Abnormal finishes
		// (truncation, content filter) do NOT throw — they return `output: undefined` and are
		// handled by the `result.output == null` guard after this try/catch.
		if (NoObjectGeneratedError.isInstance(err)) {
			let recovered: { thought?: string; description?: string; action?: unknown; completes_instruction?: boolean } = {};
			let parsed = false;
			// Only treat the response as recoverable when there is actual text. If the SDK
			// produced no text at all (err.text == null), it is NOT a deliberate empty action —
			// fall through to the parse-failure branch instead of mislabeling it as a no-match.
			if (err.text != null) {
				try {
					recovered = JSON.parse(err.text);
					parsed = true;
				} catch {
					// Raw text was not JSON (wrapped in prose, partial, etc.).
				}
			}

			const reason = recovered.thought || recovered.description || '';
			// Error messages embed the model's reason; cap it so a multi-kilobyte reasoning
			// field can't bloat logs or overflow length-constrained sinks. The full text stays
			// in debugInfo.rawLlmResponse.
			const reasonForError = reason.length > 300 ? `${reason.slice(0, 300)}…` : reason;
			// A missing, null, or {}-empty action all mean "the model chose not to act" → no-match.
			// (`action: null` is intentionally caught here by `!recovered.action`, same as `{}`.)
			const actionIsEmpty =
				!recovered.action ||
				(typeof recovered.action === 'object' && Object.keys(recovered.action as object).length === 0);

			const tokenUsages: TokenUsage[] = [];
			const recoveredUsage = convertUsageToTokenUsage(err.usage, usedModel);
			if (recoveredUsage) {
				tokenUsages.push(recoveredUsage);
			}
			const debugInfo: ActionGenerationDebugInfo = {
				systemPrompt,
				userPrompt: userMessagesForDebug,
				rawLlmResponse: err.text ?? '',
				tokenUsages,
			};

			// Genuine no-match: the model deliberately returned an empty action object, which
			// the union schema can't represent.
			if (parsed && actionIsEmpty) {
				return {
					status: 'error',
					reasoning: reason || 'No matching element/action found',
					goalAccomplished: recovered.completes_instruction ?? false,
					error: reasonForError
						? `No matching element/action: ${reasonForError}`
						: 'Agent did not generate any action (no matching element found)',
					debugInfo,
				};
			}

			// Otherwise the model produced output that failed schema validation for a different
			// reason — unparseable text, or a non-empty action that didn't match any tool schema.
			const error = parsed
				? 'Action generation failed: the model returned an action that did not match any known action schema.'
				: 'Action generation failed: the model returned a response that could not be parsed as a valid action.';
			return {
				status: 'error',
				reasoning: reason || error,
				goalAccomplished: recovered.completes_instruction ?? false,
				error,
				debugInfo,
			};
		}
		throw err;
	}

	// generateText only parses structured output when the model finished normally
	// (finishReason 'stop'). For abnormal finishes — truncation ('length'), content filters,
	// etc. — it returns `output: undefined` WITHOUT throwing. Guard against that here so we
	// surface the real cause instead of dereferencing undefined below (`result.output!`).
	if (result.output == null) {
		const finishReason = result.finishReason;
		const error =
			finishReason === 'length'
				? 'Action generation failed: the model response was truncated before a complete action could be produced (token limit reached).'
				: finishReason === 'content-filter'
					? 'Action generation failed: the model response was blocked by a content filter.'
					: `Action generation failed: the model stopped before producing an action (finishReason=${finishReason ?? 'unknown'}).`;
		const tokenUsages: TokenUsage[] = [];
		const tokenUsage = convertUsageToTokenUsage(result.usage, usedModel);
		if (tokenUsage) {
			tokenUsages.push(tokenUsage);
		}
		return {
			status: 'error',
			reasoning: '',
			goalAccomplished: false,
			error,
			debugInfo: {
				systemPrompt,
				userPrompt: userMessagesForDebug,
				rawLlmResponse: result.text ?? '',
				tokenUsages,
			},
		};
	}

	const reasoning = result.reasoningText;
	logger.info(`Action Generation Reasoning: ${reasoning}`);

	const jsonResponse = result.output;
	const rawLlmResponse = JSON.stringify(jsonResponse, null, 2);
	logger.info(`Generate Action Raw Output: ${rawLlmResponse}`);

	// Build token usages
	const tokenUsages: TokenUsage[] = [];
	const tokenUsage = convertUsageToTokenUsage(result.usage, usedModel);
	if (tokenUsage) {
		tokenUsages.push(tokenUsage);
	}

	// Build debug info (includes token usages)
	const debugInfo: ActionGenerationDebugInfo = {
		systemPrompt,
		userPrompt: userMessagesForDebug,
		rawLlmResponse,
		// screenshotWithSom: screenshotBase64,
		// retrievedKnowledges: knowledges.length > 0 ? knowledges : undefined,
		tokenUsages,
		// elementTree: pageContext.elementsText,
	};

	// Extract fields from JSON response
	const thought = jsonResponse.thought || '';
	const description = jsonResponse.description || '';
	const action = jsonResponse.action || {};
	const completesInstruction = jsonResponse.completes_instruction || false;

	// Check if action is empty or 'done'
	if (!action || Object.keys(action).length === 0) {
		return {
			status: 'error',
			reasoning: thought || description || 'No action generated',
			goalAccomplished: completesInstruction,
			error: 'Agent did not generate any action',
			debugInfo,
		};
	}

	const actionName = Object.keys(action)[0];
	if (actionName === 'done') {
		return {
			status: 'error',
			reasoning: thought || description || 'Task marked as done',
			goalAccomplished: completesInstruction,
			error: 'Agent indicated task is done without generating an action',
			debugInfo,
		};
	}

	if (actionName === 'perform_accurate_operation') {
		const coordinatesBasedResult = await generateActionWithCoordinatesBased(statement, context, options);
		return coordinatesBasedResult;
	}

	if (!completesInstruction) {
		const cannotCompleteMessage = "Can't complete the instruction in one action";
		return {
			status: 'error',
			reasoning: thought || description || cannotCompleteMessage,
			goalAccomplished: false,
			error: cannotCompleteMessage,
			debugInfo,
		};
	}

	const actionParams = action[actionName] || {};

	// Build ActionEntity with locator info if action references an element by element_index
	let locatorInfo: { locator?: string; xpath?: string; frame_path?: string[] } = {};

	// Check if action has an element_index parameter that references a DOM element
	if (typeof actionParams.element_index === 'number') {
		const elementIndex = actionParams.element_index;

		// Check if element_index is negative (LLM didn't follow instructions to return empty action)
		if (elementIndex < 0) {
			return {
				status: 'error',
				reasoning: thought || description || 'No action generated',
				goalAccomplished: completesInstruction,
				error: 'Agent did not generate any action',
				debugInfo,
			};
		}

		const domElement = domState.selectorMap.get(elementIndex);

		if (domElement) {
			// Get locator info (xpath, locator, frame_path) for the element
			locatorInfo = await getActionEntityLocatorInfo(page, domElement);
		}
	}

	// If the action is a verification, must use the original statement as the assertion statement
	let actionDescription = description;
	if (actionName === 'verify') {
		actionDescription = statement;
		actionParams['statement'] = statement;
	}

	const actionEntity: ActionEntity = {
		...locatorInfo,
		action_description: actionDescription || thought || `${actionName}(${JSON.stringify(actionParams)})`,
		action_data: {
			action_name: actionName,
			kwargs: actionParams,
		},
	};

	return {
		status: 'success',
		actionEntity,
		reasoning: thought || description,
		goalAccomplished: completesInstruction,
		debugInfo,
	};
}
