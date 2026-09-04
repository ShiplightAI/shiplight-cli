/**
 * Gemini Pro Provider
 *
 * Uses Gemini models with text (element tree) + vision (screenshot)
 * for selector-based mobile automation.
 *
 * Unlike the vision-only providers (Computer Use API with coordinates),
 * this provider outputs stable selectors (resource-id, text, content-desc).
 */

import { generateObject, type AssistantModelMessage, type UserModelMessage } from 'ai';
import { z } from 'zod';
import type { MobileActionEntity } from './actions';
import { getGoogleModel, getGoogleProviderOptions } from './googleModelUtils';
import { agentLogger } from '../../utils/agentLogger';
import { buildMobileActionUnionSchema, getToolDescriptions } from './toolRegistry';

/**
 * Configuration for Gemini Pro Provider
 */
export interface GeminiProConfig {
  /** Gemini API key (optional if GOOGLE_GENERATIVE_AI_API_KEY is set) */
  apiKey?: string;

  /** Model name (default: gemini-3-flash-preview) */
  model?: string;

  /** Temperature for generation (default: 0.1) */
  temperature?: number;
}

/**
 * Debug info from LLM call
 */
export interface LLMDebugInfo {
  /** System prompt sent to LLM */
  systemPrompt: string;
  /** User prompt sent to LLM */
  userPrompt: string;
  /** Raw response from LLM */
  rawResponse: string;
  /** Model used */
  model: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Token usage */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Result from statement evaluation
 */
export interface EvaluateResult {
  /** Whether the statement is true */
  success: boolean;

  /** Explanation of the evaluation */
  explanation: string;

  /** Error message if evaluation failed */
  error?: string;
}

/**
 * Options for evaluating a statement
 */
export interface EvaluateOptions {
  /** Statement to evaluate */
  statement: string;

  /** Screenshot as base64 data URL */
  screenshot: string;

  /** Element tree string */
  elementTree: string;
}

/**
 * Result from action generation
 */
export interface GenerateActionResult {
  /** Generated action entity */
  action: MobileActionEntity;

  /** Whether the task is complete */
  done: boolean;

  /** Reasoning/explanation from the model */
  reasoning?: string;

  /** Debug info from LLM call */
  debugInfo?: LLMDebugInfo;
}

/**
 * Options for generating an action
 */
export interface GenerateActionOptions {
  /** Task description */
  task: string;

  /** Screenshot as base64 data URL */
  screenshot: string;

  /** Element tree string from buildElementTreeString() */
  elementTree?: string;

  /** Previous action feedback (for retry context) */
  previousFeedback?: string;
}

/**
 * Build system prompt with dynamic tool descriptions
 */
function buildSystemPrompt(): string {
  const toolDescriptions = getToolDescriptions();

  return `You are a mobile automation agent that controls an Android device.

Your job is to analyze the screenshot and element tree, then output the next action to accomplish the given task.

## Input Format

You receive:
1. A screenshot of the current screen
2. An element tree listing interactive elements with their attributes:
   - [index] ElementType text="visible text" content-desc="accessibility label" resource-id="unique.id" bounds=[left,top][right,bottom]

## Output Format

Respond with a JSON object containing exactly ONE action:
{
  "thought": "Step by step reasoning of your decision making process",
  "description": "Detailed description of the action (e.g. 'Tap the Login button to proceed')",
  "action": { "action_name": { ...parameters } },
  "done": false  // set to true only when the task is fully complete
}

## Locator Format

When choosing a locator for an element, prefer these in order (most stable first):
1. resource-id=... (most stable, use full ID like "com.app:id/button_login")
2. text=... (for buttons/labels with unique visible text)
3. content-desc=... (for icons/images with accessibility labels)
4. class=... (for elements with no other identifiers, e.g., "class=android.widget.EditText")

IMPORTANT: For TextField/input elements that show no resource-id, text, or content-desc in the element tree,
use their class name as the locator (e.g., "class=android.widget.EditText").
Do NOT use the parent container's resource-id or a child's text as the locator for input_text.

## Available Actions

${toolDescriptions}

## Important Rules

1. ALWAYS use the full resource-id from the element tree (e.g., "com.google.android.youtube:id/menu_item_1")
2. When an element has a resource-id, prefer it over text or content-desc
3. For input_text, tap the field first in a separate action if it's not focused
4. Set done=true ONLY when the task is fully accomplished
5. If you cannot find the right element, use scroll to reveal more content. For scroll DOWN (reveal below): from_y > to_y. For scroll UP (reveal above): from_y < to_y
6. Use swipe only for gestures like switching tabs, dismissing dialogs, or navigating between pages
7. If the task cannot be completed, use done with success=false

## Avoiding Stuck Loops

If an action fails or doesn't produce the expected result:
1. DO NOT repeat the same action - try a DIFFERENT approach
2. Alternative strategies to try:
   - If tap on a suggestion item fails, try input_text with the text + press Enter key
   - If tap doesn't work, try a different locator (text= instead of resource-id=, or vice versa)
   - If element is not responding, try swiping to refresh or scroll to a different position
   - If a button doesn't work, look for alternative UI paths (e.g., menu, long-press, back button)
3. After a failed attempt, you MUST try a different approach
4. Consider the broader goal - there may be multiple ways to achieve the same outcome

## Examples

### Tap an element:
{ "thought": "I see the login button on the screen. I need to tap it to proceed.", "description": "Tap the Login button to proceed", "action": { "tap": { "locator": "resource-id=com.app:id/login_btn" } }, "done": false }

### Type text (with resource-id):
{ "thought": "The username field is focused. I need to enter the email address.", "description": "Enter email into username field", "action": { "input_text": { "locator": "resource-id=com.app:id/username", "text": "user@example.com" } }, "done": false }

### Type text (TextField with no resource-id - use class locator):
{ "thought": "I see a TextField with class=android.widget.EditText but no resource-id. I will use the class locator to type into it.", "description": "Type destination into search field", "action": { "input_text": { "locator": "class=android.widget.EditText", "text": "San Jose, CA" } }, "done": false }

### Scroll down (to reveal content BELOW - finger drags UP):
{ "thought": "I cannot see the target element. I need to scroll down to reveal more content below.", "description": "Scroll down to reveal more content", "action": { "scroll": { "from_x": 540, "from_y": 1800, "to_x": 540, "to_y": 600 } }, "done": false }

### Scroll up (to reveal content ABOVE - finger drags DOWN):
{ "thought": "I need to scroll up to see content at the top.", "description": "Scroll up to reveal content above", "action": { "scroll": { "from_x": 540, "from_y": 600, "to_x": 540, "to_y": 1800 } }, "done": false }

### Swipe (for gestures like switching tabs/pages):
{ "thought": "I need to swipe left to go to the next tab/page.", "description": "Swipe left to switch to next page", "action": { "swipe": { "direction": "left" } }, "done": false }

### Failed attempt:
{ "thought": "The previous attempt to tap the search suggestion 'outdoor boys' failed. I will try to press the enter key to perform the search instead, as the text is already in the search field." "action": { "enter": {} }, "done": false }

### Mark complete:
{ "thought": "I have successfully logged in and can see the home screen.", "description": "Task complete - successfully logged in", "action": { "done": { "success": true, "message": "Successfully logged in" } }, "done": true }`;
}

/**
 * Build the response schema with dynamic action union
 */
function buildResponseSchema() {
  const actionUnionSchema = buildMobileActionUnionSchema();

  return z.object({
    thought: z.string().describe('Step by step reasoning of your decision making process'),
    description: z.string().describe('Detailed description of the action to be performed'),
    action: actionUnionSchema,
    done: z.boolean().describe('Whether the task is fully complete'),
  });
}

export class GeminiProProvider {
  private model: string;
  private temperature: number;
  private conversationHistory: Array<UserModelMessage | AssistantModelMessage> = [];

  constructor(config: GeminiProConfig) {
    this.model = config.model || 'gemini-3-flash-preview';
    this.temperature = config.temperature ?? 0.1;
  }

  /**
   * Reset conversation history (call when starting a new task)
   */
  resetConversation(): void {
    this.conversationHistory = [];
  }

  /**
   * Generate the next action based on screenshot and element tree
   */
  async generateAction(options: GenerateActionOptions): Promise<GenerateActionResult> {
    const { task, screenshot, elementTree, previousFeedback } = options;

    // Build user message content with element tree + screenshot
    let textPrompt = `## Task\n${task}\n\n## Element Tree\n${elementTree || '(no elements found)'}`;

    if (previousFeedback) {
      textPrompt += `\n\n## Previous Attempt Feedback\n${previousFeedback}\n\nPlease try a different approach.`;
    }

    // Build user message with text and image
    const userMessage: UserModelMessage = {
      role: 'user',
      content: [
        { type: 'text', text: textPrompt },
        { type: 'file', mediaType: 'image/png', data: screenshot },
      ],
    };

    // Add to conversation history
    this.conversationHistory.push(userMessage);

    // Get model instance (uses SDK config for API key / Vertex AI)
    const model = getGoogleModel(this.model);
    const providerOptions = getGoogleProviderOptions(this.model);

    // Build system prompt and response schema
    const systemPrompt = buildSystemPrompt();
    const responseSchema = buildResponseSchema();

    // Log prompt before LLM call
    agentLogger.prompt(systemPrompt, textPrompt);

    // Call Gemini using generateObject for structured output
    const startTime = Date.now();
    const result = await generateObject({
      model,
      system: systemPrompt,
      messages: this.conversationHistory,
      temperature: this.temperature,
      schema: responseSchema,
      providerOptions,
    });
    const duration = Date.now() - startTime;

    const jsonResponse = result.object;
    const rawResponse = JSON.stringify(jsonResponse, null, 2);

    // Log LLM call details
    agentLogger.llmCall(this.model, duration, result.usage);
    agentLogger.response(rawResponse);

    // Add assistant response to history
    this.conversationHistory.push({
      role: 'assistant',
      content: rawResponse,
    });

    // Parse union action format: { tap: { locator: "..." } } -> action_name and params
    const actionObject = jsonResponse.action as Record<string, Record<string, unknown>>;
    const actionName = Object.keys(actionObject)[0];
    const actionParams = actionObject[actionName] || {};

    // Extract locator and kwargs from params
    // For locator-based actions, locator is in params
    // For non-locator actions, all params are kwargs
    const locator = actionParams.locator as string | undefined;
    const { locator: _locator, ...kwargs } = actionParams;

    // Convert to MobileActionEntity
    const action: MobileActionEntity = {
      locator,
      action_data: {
        action_name: actionName,
        kwargs,
      },
      action_description: jsonResponse.description || `Execute ${actionName}`,
    };

    // Log parsed action
    agentLogger.action(
      action.action_data.action_name,
      action.locator,
      action.action_data.kwargs
    );

    // Build debug info
    const usage = result.usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number; inputTokens?: number; outputTokens?: number } | undefined;
    const debugInfo: LLMDebugInfo = {
      systemPrompt,
      userPrompt: textPrompt,
      rawResponse,
      model: this.model,
      durationMs: duration,
      usage: usage ? {
        promptTokens: usage.promptTokens ?? usage.inputTokens,
        completionTokens: usage.completionTokens ?? usage.outputTokens,
        totalTokens: usage.totalTokens ?? ((usage.promptTokens ?? usage.inputTokens ?? 0) + (usage.completionTokens ?? usage.outputTokens ?? 0)),
      } : undefined,
    };

    return {
      action,
      done: jsonResponse.done,
      reasoning: jsonResponse.thought,
      debugInfo,
    };
  }

  /**
   * Evaluate a statement against current screen state
   * Uses screenshot + element tree for text+vision evaluation
   */
  async evaluate(options: EvaluateOptions): Promise<EvaluateResult> {
    const { statement, screenshot, elementTree } = options;

    const systemPrompt = `You are a mobile test verification assistant. Your job is to analyze a screenshot and element tree to determine if a given statement is true or false.

## Input
You receive:
1. A screenshot of the current mobile screen
2. An element tree listing UI elements with their attributes
3. A statement to verify

## Output
Respond with a JSON object:
{
  "conclusion": "true" or "false",
  "explanation": "Brief explanation of why the statement is true or false based on what you observe"
}

## Rules
1. Be strict - only conclude "true" if you're confident the statement is clearly met
2. Use both the screenshot AND element tree to make your determination
3. If you cannot determine the answer, conclude "false" with explanation
4. Focus on what is actually visible/present, not what might be`;

    const userPrompt = `## Statement to verify
"${statement}"

## Element Tree
${elementTree}

Based on the screenshot and element tree above, determine if the statement is true or false.`;

    // Build user message with text and image
    const userMessage: UserModelMessage = {
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'file', mediaType: 'image/png', data: screenshot },
      ],
    };

    // Schema for evaluation response
    const evaluationSchema = z.object({
      conclusion: z.enum(['true', 'false']).describe('Whether the statement is true or false'),
      explanation: z.string().describe('Brief explanation of the determination'),
    });

    try {
      const model = getGoogleModel(this.model);
      const providerOptions = getGoogleProviderOptions(this.model);

      // Log prompt before LLM call
      agentLogger.prompt(systemPrompt, userPrompt);

      const startTime = Date.now();
      const result = await generateObject({
        model,
        system: systemPrompt,
        messages: [userMessage],
        temperature: 0,
        schema: evaluationSchema,
        providerOptions,
      });
      const duration = Date.now() - startTime;

      const { conclusion, explanation } = result.object;
      const rawResponse = JSON.stringify(result.object, null, 2);

      // Log LLM call details
      agentLogger.llmCall(this.model, duration, result.usage);
      agentLogger.response(rawResponse);

      agentLogger.log(`Evaluate "${statement}": ${conclusion} - ${explanation}`);

      return {
        success: conclusion === 'true',
        explanation,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      agentLogger.log(`Evaluate error: ${errorMessage}`);
      return {
        success: false,
        explanation: 'Evaluation failed',
        error: errorMessage,
      };
    }
  }

  /**
   * Get the current model name
   */
  getModel(): string {
    return this.model;
  }
}
