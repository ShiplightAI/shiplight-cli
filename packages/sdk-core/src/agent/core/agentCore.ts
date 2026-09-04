/**
 * Core agent logic for action generation and evaluation
 *
 * This module contains the reusable logic for:
 * - Getting DOM state and screenshot with SOM
 * - Building browser context for LLM
 * - Calling LLM with structured output
 * - Action generation and assertion evaluation
 */

import { generateText, Output, UserContent } from 'ai';
import { z } from 'zod';
import { createKnowledgeParts, countKnowledgeImages } from '../../services/knowledgeService';
import { toStrictOutputSchema } from '../../llm_tools/strictSchema';
import { buildPageContext } from '../../utils/pageContext';
import { convertUsageToTokenUsage } from '../../utils/tokenUsage';
import { generateAction as generateActionWithCoordinatesBased } from '../action-generation/coordinatesBased';
import { generateAction as generateActionWithElementBased } from '../action-generation/elementBased';
import { getModel, getProviderOptions, resolveTemperature } from '../llm';
import { runWithModelFallback } from '../task/modelFallback';
import { AgentOptions, AssertionResult, GeneratedAction, TaskExecutionContext } from '../core/types';
import { ActionGenerationDebugInfo, MessageForLogging, MessagePartForLogging, TokenUsage } from 'shiplight-types';
import { withLlmTimeout } from '../llm/timeout';

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

// Schema for assertion evaluation response
const assertionResponseSchema = z.object({
	screenshotDescription: z.string().describe(`Description of the screenshot content, listing out key elements along with their Set of Mark indices, 
		and a description of their location: formatting example: [12] A red button with text "Submit", next to [11]\n[45] A modal dialog titled "Confirmation", 
		in the center of the screen`),
	explanation: z.string().describe('Step by step reasoning explaining your conclusion about the statement'),
	conclusion: z.enum(['true', 'false', 'unknown']).describe('Whether the statement is true, false, or unknown if you cannot make a conclusion'),
});

// What actually goes on the wire. This schema has no optional fields today, so
// the transform changes none of its properties — it is applied so that adding
// one later cannot silently make the request invalid under OpenAI strict
// structured outputs, and so every object carries additionalProperties: false.
const submittedAssertionResponseSchema = toStrictOutputSchema(assertionResponseSchema);

export async function generateAction(
	statement: string,
	context: TaskExecutionContext,
	options: AgentOptions = {}
): Promise<GeneratedAction> {
	if (options.usePureVision) {
		return generateActionWithCoordinatesBased(statement, context, options);
	} else {
		return generateActionWithElementBased(statement, context, options);
	}
}

/**
 * Get the current date/time formatted for prompts
 */
function getCurrentTimeInfo(): { dateString: string; timeString: string } {
	const now = new Date();
	const dateString = now.toLocaleDateString('en-US', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'America/Los_Angeles',
	});
	const timeString = now.toLocaleTimeString('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		fractionalSecondDigits: 3,
		timeZoneName: 'short',
		timeZone: 'America/Los_Angeles',
	});
	return { dateString, timeString };
}

/**
 * Build the evaluation system prompt
 * Note: Keep this minimal - Gemini 2.5 Pro follows user prompt instructions more reliably.
 * UI terminology and detailed instructions are in the user prompt instead.
 */
function getEvaluationSystemPrompt(): string {
	return `# Role
You are an experienced QA person for web applications.
You are tasked to verify the validity of a given statement based on the screenshot and element tree of a web page.
`;
}

/**
 * Evaluate a statement about the current page state using LLM
 *
 * This is the core LLM function that:
 * 1. Gets current DOM state and screenshot
 * 2. Calls LLM to evaluate if the statement is true or false
 * 3. Returns the result with explanation
 *
 * @param statement - Statement to evaluate (already resolved, no $variables)
 * @param context - Task execution context with page, domService, etc.
 * @param options - Agent options (model, temperature, etc.)
 * @returns AssertionResult with success flag and explanation
 */
export async function evaluate(
	statement: string,
	context: TaskExecutionContext,
	options: AgentOptions = {}
): Promise<AssertionResult> {
	const { page, executionHistory } = context;
	const model = context.agentServices.getModel();

	try {
		// Get organization settings
		const useSlicedScreenshots = context.agentServices.isSlicedScreenshotsEnabled();
		const resizeSlicedScreenshots = context.agentServices.isResizeSlicedScreenshotsEnabled();
		const enableKnowledgeImages = context.agentServices.isKnowledgeImagesEnabled();
		const useAccessibilityTree = context.agentServices.isAccessibilityTreeEnabled();

		// Get current page state
		const { domTree, screenshotBase64, slicedScreenshotsBase64, domState, pageContext } = await buildPageContext(context, {
			useCleanScreenshot: options.useCleanScreenshotForAssertion,
			useSlicedScreenshots,
			resizeSlicedScreenshots,
			useAccessibilityTree,
		});
		context.domState = domState;

		// Build execution history section if available
		let executionHistoryText = '';
		if (executionHistory && executionHistory.length > 0) {
			const historyLines = executionHistory.map(([action, result], idx) =>
				`${idx + 1}. Action: ${action}\n   Result: ${result}`
			).join('\n');
			executionHistoryText = `\n# Previous actions in this session:\n${historyLines}\n`;
		}

		const { dateString, timeString } = getCurrentTimeInfo();

		// Build user prompt with UI terminology (Gemini 2.5 Pro follows user prompt more reliably than system prompt)
		const userPrompt = `
# User statement
"${statement}"

# Current webpage state
## Tab information:
${pageContext.currentTabText}Available tabs:
${pageContext.tabsText}

## Element interaction guidelines:
   - Each element has a unique index number (e.g., "[33]<button>")
   - Elements marked with "[]Non-interactive text" are non-interactive (for context only)
   - Elements are indented to show the structure of the element tree, with indentation level indicating depth

## Interactive elements from current page:
${domTree}

## Screenshot
${useSlicedScreenshots && slicedScreenshotsBase64 ? 'The following images are sliced screenshots of the current webpage (left, middle, right sections).' : 'The image provided is a screenshot of the current webpage.'}
`;

		// Add available variables context (non-sensitive only)
		let variablesContext = '';
		if (context.variables && Object.keys(context.variables).length > 0) {
			const variableList: string[] = [];
			for (const key of Object.keys(context.variables)) {
				const isSensitive = context.sensitiveKeys?.has(key);
				if (!isSensitive) {
					// Only show non-sensitive variables
					const value = context.variables[key];
					const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
					variableList.push(`  - ${key}: "${valueStr}"`);
				}
			}

			if (variableList.length > 0) {
				variablesContext = `
## Available Variables
The following non-sensitive variables are available:
${variableList.join('\n')}`;
			}
		}

		const endingPrompt = `
${variablesContext}
${executionHistoryText}

Today is ${dateString}. Current local time is ${timeString}.
Based on the above information, please determine if the statement is true.
`;

		// Retrieve knowledge via callback (matching Python assertion_prompts.py behavior)
		const knowledges = await context.agentServices.retrieveKnowledges(statement);

		// Build user message content array
		const userMessageContent: UserContent = [
			{ type: 'text', text: userPrompt },
		];

		// Add screenshot(s)
		let screenshotCount = 0;
		if (useSlicedScreenshots && slicedScreenshotsBase64 && slicedScreenshotsBase64.length > 0) {
			// Add sliced screenshots
			for (const slice of slicedScreenshotsBase64) {
				userMessageContent.push({ type: 'file', mediaType: 'image/png', data: slice });
				screenshotCount++;
			}
		} else {
			// Add single screenshot
			userMessageContent.push({ type: 'file', mediaType: 'image/png', data: screenshotBase64 });
			screenshotCount = 1;
		}

		// Add knowledge parts if available (matching Python: initial_parts + knowledge_pieces + [ending])
		if (knowledges && knowledges.length > 0) {
			const knowledgeParts = createKnowledgeParts(knowledges, enableKnowledgeImages);
			userMessageContent.push(...knowledgeParts);
		}

		userMessageContent.push({ type: 'text', text: endingPrompt });

		// Count images: screenshots + knowledge images
		const knowledgeImageCount = knowledges ? countKnowledgeImages(knowledges, enableKnowledgeImages) : 0;
		const totalImageCount = screenshotCount + knowledgeImageCount;
		const systemPrompt = getEvaluationSystemPrompt();

		// Model chain: primary + configured fallbacks (deduped), tried in order on an
		// availability failure (429/5xx/timeout) so a primary-model quota error on an
		// assert doesn't fail the test. Mirrors generateAction and the runTask loop.
		const modelChain = [model, ...context.agentServices.getFallbackModels().filter((m) => m !== model)];
		let usedModel = model;

		const result = await runWithModelFallback(modelChain, (candidateModel) => {
			usedModel = candidateModel;
			// Sampling-free Anthropic models (Opus 4.7/4.8, Sonnet 5, Fable 5) 400
			// on a non-default temperature, and a 400 does not fall back — so
			// resolve per candidate and omit the field when it returns undefined.
			const temperature = resolveTemperature(candidateModel, options.temperature);
			return withLlmTimeout((abortSignal) => generateText({
				model: getModel(candidateModel),
				abortSignal,
				instructions: systemPrompt,
				messages: [
					{
						role: 'user',
						content: userMessageContent,
					},
				],
				output: Output.object({ schema: submittedAssertionResponseSchema }),
				...(temperature !== undefined ? { temperature } : {}),
				// Provider options are model-specific — resolve per candidate model.
				providerOptions: getProviderOptions(candidateModel, totalImageCount),
			}));
		});

		const { conclusion, explanation } = result.output!;
		const rawLlmResponse = JSON.stringify(result.output, null, 2);

		// Capture token usage
		const tokenUsages: TokenUsage[] = [];
		const tokenUsage = convertUsageToTokenUsage((result as any).usage, usedModel);
		if (tokenUsage) {
			tokenUsages.push(tokenUsage);
		}

		// Convert actual userMessageContent to logging format (captures exactly what was sent to LLM)
		const userPromptForLogging: MessageForLogging[] = [
			{
				role: 'user',
				content: userMessageContent.map((part): MessagePartForLogging => {
					if (part.type === 'text') {
						return { type: 'text' as const, text: part.text };
					} else if (part.type === 'file') {
						const imageData = (part as any).data;
						// Check if it's a URL, otherwise treat as base64
						const imageUrl = extractImageUrl(imageData);
						if (imageUrl) {
							return { type: 'image' as const, file: imageUrl };
						}
						const base64Data = typeof imageData === 'string' ? imageData : '';
						return {
							type: 'image' as const,
							file: base64Data.startsWith('data:') ? base64Data : `data:image/png;base64,${base64Data}`,
						};
					}
					return { type: 'text' as const, text: '[unknown content type]' };
				}),
			},
		];

		// Build debug info
		const debugInfo: ActionGenerationDebugInfo = {
			systemPrompt,
			userPrompt: userPromptForLogging,
			rawLlmResponse,
			screenshotWithSom: screenshotBase64,
			tokenUsages,
			retrievedKnowledges: knowledges && knowledges.length > 0 ? knowledges : undefined,
			elementTree: domTree,
		};

		return {
			success: conclusion === 'true',
			explanation,
			debugInfo,
		};
	} catch (error) {
		return {
			success: false,
			error: (error as Error).message,
		};
	}
}
