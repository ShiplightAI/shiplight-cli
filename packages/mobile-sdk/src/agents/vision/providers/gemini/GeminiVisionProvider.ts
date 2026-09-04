/**
 * Gemini Vision Provider
 * Google Gemini Computer Use implementation for vision-based mobile automation
 *
 * Gemini Computer Use features:
 * - Uses normalized 1000x1000 coordinate system
 * - Excludes all predefined Computer Use functions
 * - Uses only custom mobile-specific function declarations
 * - Multi-turn conversation with history management
 */

import { GoogleGenAI, type Content, type Part, type FunctionCall } from '@google/genai';
import { BaseVisionProvider } from '../base/BaseVisionProvider';
import type { GenerateActionOptions, BuildTrajectoryOptions } from '../base/types';
import type {
  AIModelConfig,
  GeneratedAction,
  MobileAgentOutput,
  Trajectory,
  TaskStep,
} from '../../types';
import { MobileActionType } from '../../types';
import { getMobileSdkConfig } from '../../../../config';

/**
 * Exclude all predefined Gemini Computer Use functions
 * We provide our own mobile-specific functions instead
 * List from official Gemini Computer Use API
 */
const EXCLUDED_PREDEFINED_FUNCTIONS = [
  'open_web_browser',
  'click_at',
  'hover_at',
  'type_text_at',
  'scroll_document',
  'scroll_at',
  'wait_5_seconds',
  'go_back',
  'go_forward',
  'search',
  'navigate',
  'key_combination',
  'drag_and_drop',
];

/**
 * Generate a fallback description for an action when reasoning is not provided
 */
function generateFallbackDescription(actionType: MobileActionType | string, parameters: Record<string, any>): string {
  switch (actionType) {
    case MobileActionType.TAP:
      return 'Tap element';
    case MobileActionType.DOUBLE_TAP:
      return 'Double-tap element';
    case MobileActionType.LONG_PRESS:
      return 'Long press element';
    case MobileActionType.INPUT:
      return 'Enter text';
    case MobileActionType.SWIPE:
      return parameters.direction ? `Swipe ${parameters.direction}` : 'Swipe';
    case MobileActionType.SCROLL:
      return parameters.direction ? `Scroll ${parameters.direction}` : 'Scroll';
    case MobileActionType.SWIPE_POINTS:
      return 'Swipe between points';
    case MobileActionType.BACK:
      return 'Go back';
    case MobileActionType.HOME:
      return 'Go to home screen';
    case MobileActionType.WAIT:
      return 'Wait';
    case MobileActionType.DONE:
      return parameters.text || 'Task completed';
    default:
      return `Perform ${actionType}`;
  }
}

export class GeminiVisionProvider extends BaseVisionProvider {
  private client: GoogleGenAI;
  private modelName: string;
  private conversationHistory: Content[] = [];
  private systemInstructions: string;

  constructor(platform: 'android' | 'ios', modelConfig: AIModelConfig) {
    super(platform, modelConfig);

    // Get SDK config for env vars (SDK config takes precedence over process.env)
    const sdkConfig = getMobileSdkConfig();
    const env = sdkConfig.env || {};

    // Check for Vertex AI explicit flag
    const useVertexAIFlag = env.GOOGLE_GENAI_USE_VERTEXAI || process.env.GOOGLE_GENAI_USE_VERTEXAI;
    const useVertexAI = useVertexAIFlag === 'True' || useVertexAIFlag === 'true';

    // Check for API key in config or env
    const apiKey =
      modelConfig.apiKey ||
      env.GOOGLE_API_KEY ||
      process.env.GOOGLE_API_KEY;

    // Debug: log what we found
    console.log(`[Gemini] Debug: useVertexAI=${useVertexAI}, apiKey=${apiKey ? 'set' : 'not set'}, modelConfig.apiKey=${modelConfig.apiKey ? 'set' : 'not set'}`);

    // If Vertex AI is NOT explicitly requested and an API key is available, use API key
    // This avoids Vertex AI's CUA enablement requirement
    if (!useVertexAI && apiKey) {
      this.client = new GoogleGenAI({ apiKey });
      console.log('[Gemini] Using Google AI (API key)');
    } else {
      // Check for Vertex AI project
      const vertexProject = env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

      if (useVertexAI || vertexProject) {
        if (!vertexProject) {
          throw new Error('GOOGLE_CLOUD_PROJECT is required when using Vertex AI');
        }
        // gemini-2.5-computer-use model might need specific location
        const vertexLocation = env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'global';
        this.client = new GoogleGenAI({
          vertexai: true,
          project: vertexProject,
          location: vertexLocation,
        });
        console.log(`[Gemini] Using Vertex AI (project: ${vertexProject}, location: ${vertexLocation})`);
      } else {
        throw new Error(
          'Gemini API key is required. Set GOOGLE_API_KEY env var, ' +
          'or use Vertex AI by setting GOOGLE_GENAI_USE_VERTEXAI=True'
        );
      }
    }

    this.modelName = modelConfig.model || 'gemini-2.5-computer-use-preview-10-2025';

    // Build system instructions
    this.systemInstructions = this.buildSystemInstructions(platform);

    // Allow custom instructions from environment
    const customInstructions = process.env.GEMINI_SYSTEM_INSTRUCTIONS || process.env.SYSTEM_INSTRUCTIONS;
    if (customInstructions) {
      this.systemInstructions += '\n\n---\n\nCUSTOM INSTRUCTIONS:\n' + customInstructions;
      console.log('[Gemini] Added custom system instructions');
    }
  }

  /**
   * Build system instructions for Gemini Computer Use
   */
  private buildSystemInstructions(platform: 'android' | 'ios'): string {
    const intro = `You are controlling a ${platform} mobile device using computer use actions.

TASK COMPLETION:
When you have successfully completed the task, call the "done" function with success=true.
The task is complete when you have achieved the goal stated in the TASK description.
Do NOT take any actions after calling "done".

COORDINATE SYSTEM:
- All coordinates use a 1000x1000 normalized coordinate system
- X ranges from 0 (left) to 1000 (right)
- Y ranges from 0 (top) to 1000 (bottom)
- The system will automatically translate to device coordinates`;

    const deviceInstructions = this.buildDeviceInstructions(platform);
    const appInstructions = this.buildAppInstructions();

    return `${intro}\n\n${deviceInstructions}\n\n${appInstructions}`;
  }

  /**
   * Build device-level instructions
   */
  private buildDeviceInstructions(platform: 'android' | 'ios'): string {
    const commonDevice = `IMPORTANT: Always provide a clear, human-readable 'text' parameter for every action describing what you're doing.`;

    if (platform === 'android') {
      return `${commonDevice}

ANDROID SYSTEM GESTURES:
- Home: Use home() function
- Back: Use back() function
- Recent apps: Use swipe_points() from bottom (500, 950) to middle (500, 500)
- Notifications: Use swipe_points() from top (500, 50) to middle (500, 500)
- Quick settings: Use swipe_points() from top twice`;
    } else {
      return `${commonDevice}

iOS SYSTEM GESTURES:
- Home: Use home() function
- Back: Use back() function
- App switcher: Use swipe_points() from bottom (500, 950) to middle (500, 500)
- Control center: Use swipe_points() from top-right (900, 50) to middle (500, 500)
- Notification center: Use swipe_points() from top-left (100, 50) to middle (500, 500)`;
    }
  }

  /**
   * Build app-specific instructions
   */
  private buildAppInstructions(): string {
    return `APP PATTERNS:
- Bottom navigation: Use tap() on icons at bottom to switch tabs
- Hamburger menu: Use tap() on ≡ icon in top-left to open side menu
- More options: Use tap() on ⋮ icon in top-right for more actions
- Pull to refresh: Use swipe_points() down from top of scrollable content
- Modal close: Use tap() on X button or swipe_points() down to dismiss
- Keyboard dismiss: Use tap() outside text field or back() to close keyboard
- Search/Text input: First tap() on search field, then use input() to type text

PROGRESS AWARENESS:
- Compare each screenshot to the previous one to detect if your action had any effect
- If the screen looks unchanged after an action, do NOT repeat the same action
- When stuck, try a completely different approach or call done(success=false)`;
  }

  /**
   * Build custom function declarations for mobile-specific actions
   * All functions include a 'text' parameter for human-readable action description
   */
  private buildCustomFunctions(): any[] {
    return [
      {
        name: 'tap',
        description: 'Tap at specific coordinates on the mobile screen',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate (0-1000 normalized)' },
            y: { type: 'number', description: 'Y coordinate (0-1000 normalized)' },
            text: { type: 'string', description: 'Human-readable description of what element is being tapped (e.g., "Tap YouTube icon", "Tap search button")' },
          },
          required: ['x', 'y', 'text'],
        },
      },
      {
        name: 'input',
        description: 'Type text into the currently focused input field',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'string', description: 'Text to input' },
            text: { type: 'string', description: 'Human-readable description (e.g., "Type \'outdoor boys\' in search bar", "Enter email address")' },
          },
          required: ['value', 'text'],
        },
      },
      {
        name: 'scroll',
        description: 'Scroll the screen by dragging from one point to another. Use this for precise scrolling within a specific area (e.g., scrolling a list, scrolling within a modal).',
        parameters: {
          type: 'object',
          properties: {
            from_x: { type: 'number', description: 'Start X coordinate (0-1000 normalized)' },
            from_y: { type: 'number', description: 'Start Y coordinate (0-1000 normalized)' },
            to_x: { type: 'number', description: 'End X coordinate (0-1000 normalized)' },
            to_y: { type: 'number', description: 'End Y coordinate (0-1000 normalized)' },
            text: { type: 'string', description: 'Human-readable description (e.g., "Scroll down the video list", "Scroll up to see previous items")' },
          },
          required: ['from_x', 'from_y', 'to_x', 'to_y', 'text'],
        },
      },
      {
        name: 'swipe_points',
        description: 'Drag/swipe between two specific points (for drag-and-drop, picture-in-picture, etc.)',
        parameters: {
          type: 'object',
          properties: {
            from_x: { type: 'number', description: 'Start X coordinate (0-1000 normalized)' },
            from_y: { type: 'number', description: 'Start Y coordinate (0-1000 normalized)' },
            to_x: { type: 'number', description: 'End X coordinate (0-1000 normalized)' },
            to_y: { type: 'number', description: 'End Y coordinate (0-1000 normalized)' },
            text: { type: 'string', description: 'Human-readable description (e.g., "Drag video to bottom-right corner", "Swipe notification away")' },
          },
          required: ['from_x', 'from_y', 'to_x', 'to_y', 'text'],
        },
      },
      {
        name: 'wait',
        description: 'Wait for a specified duration (use sparingly, max 10 seconds)',
        parameters: {
          type: 'object',
          properties: {
            seconds: { type: 'number', description: 'Number of seconds to wait (max 10)' },
            text: { type: 'string', description: 'Human-readable description (e.g., "Wait for video to load", "Wait for page to render")' },
          },
          required: ['seconds', 'text'],
        },
      },
      {
        name: 'back',
        description: 'Press the back button',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Human-readable description (e.g., "Go back to previous screen")' },
          },
          required: ['text'],
        },
      },
      {
        name: 'home',
        description: 'Press the home button',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Human-readable description (e.g., "Go to home screen")' },
          },
          required: ['text'],
        },
      },
      {
        name: 'done',
        description: 'Signal that the task is complete',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Summary of what was accomplished' },
            success: { type: 'boolean', description: 'Whether the task was completed successfully' },
          },
          required: ['text', 'success'],
        },
      },
    ];
  }

  /**
   * Generate a single action from screenshot and task description
   */
  async generateAction(options: GenerateActionOptions): Promise<MobileAgentOutput> {
    const { statement, screenshot, deviceInfo } = options;

    console.log(`[Gemini] API call parameters: display_width=${deviceInfo.width}, display_height=${deviceInfo.height}`);
    console.log(`[Gemini] Screenshot data URL length: ${screenshot.length} chars`);

    // Convert base64 screenshot to bytes
    const imageData = screenshot.replace(/^data:image\/png;base64,/, '');

    // Build content parts
    const parts: Part[] = [];

    // Add text instruction (system + task)
    if (this.conversationHistory.length === 0) {
      // First turn: include system instructions
      parts.push({ text: `${this.systemInstructions}\n\n---\n\nTASK: ${statement}` });
    } else {
      // Subsequent turns: just the task
      parts.push({ text: `TASK: ${statement}` });
    }

    // Add screenshot
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: imageData,
      },
    });

    // Append to conversation history
    this.conversationHistory.push({
      role: 'user',
      parts,
    });

    // Configure Computer Use with custom functions only
    // Exclude ALL predefined functions - we provide our own mobile-specific ones
    const config = {
      tools: [
        {
          computerUse: {
            environment: 'ENVIRONMENT_BROWSER',
            excludedPredefinedFunctions: EXCLUDED_PREDEFINED_FUNCTIONS,
          },
        },
        {
          functionDeclarations: this.buildCustomFunctions(),
        },
      ],
      temperature: this.modelConfig.temperature || 0.1,
      maxOutputTokens: this.modelConfig.maxTokens || 2000,
    };

    // Make API call
    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents: this.conversationHistory,
      config: config as any,
    });

    // Extract reasoning and function calls
    // Following the pattern from Google's agent.py example
    let reasoning = '';
    let functionCall: FunctionCall | null = null;

    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];

      if (candidate.content && candidate.content.parts) {
        // Collect all text parts as reasoning (thinking/explanation)
        const textParts: string[] = [];
        for (const part of candidate.content.parts) {
          if ('text' in part && part.text) {
            textParts.push(part.text.trim());
          }
          if ('functionCall' in part && part.functionCall) {
            functionCall = part.functionCall;
          }
        }

        // Join all text parts with spaces to form complete reasoning
        reasoning = textParts.join(' ').trim();

        // Append model response to history
        this.conversationHistory.push({
          role: 'model',
          parts: candidate.content.parts,
        });
      }
    }

    // Log reasoning and function call for debugging
    if (reasoning) {
      console.log(`[Gemini] Reasoning: ${reasoning}`);
    }
    console.log(`[Gemini] Function call: ${functionCall ? functionCall.name : 'none'}`);

    if (!functionCall) {
      // No action - task might be complete
      // Reset conversation state
      this.conversationHistory = [];

      return {
        screen_vision_description: reasoning || 'Task analysis',
        evaluation_previous_goal: 'No action needed',
        memory: reasoning,
        current_goal: 'Complete',
        action: {
          type: MobileActionType.DONE,
          parameters: {
            text: reasoning || 'No action returned by model',
            success: true,
          },
        },
        action_description: 'Task completed',
      };
    }

    // Parse function call to get action
    const action = this.parseFunctionCall(functionCall, deviceInfo);

    // Add reasoning to the action itself
    // Prefer action's own reasoning (from 'text' parameter) over general reasoning
    if (!action.reasoning) {
      action.reasoning = reasoning || undefined;
    }

    // Use action.reasoning (from function call's 'text' parameter) as action description
    // This is the LLM-generated human-readable description like "Tap on February 3rd"
    // Fall back to general reasoning or generate a fallback description
    const actionDescription = action.reasoning || reasoning || generateFallbackDescription(action.type, action.parameters);

    return {
      screen_vision_description: reasoning || 'Analyzing screen',
      evaluation_previous_goal: 'Action generated',
      memory: reasoning,
      current_goal: statement,
      action,
      action_description: actionDescription,
    };
  }

  /**
   * Parse Gemini function call to mobile action
   */
  private parseFunctionCall(functionCall: FunctionCall, deviceInfo: { width: number; height: number }): GeneratedAction {
    const name = functionCall.name;
    const args = functionCall.args || {};

    // Translate coordinates from 1000x1000 to device size
    const translatedArgs = this.translateCoordinates(args, deviceInfo);

    console.log(`[Gemini] Parsing function: ${name} with args:`, args);
    console.log(`[Gemini] Translated args:`, translatedArgs);

    switch (name) {
      // Gemini Computer Use predefined actions
      case 'click_at':
        return {
          type: MobileActionType.TAP,
          parameters: {
            x: translatedArgs.x,
            y: translatedArgs.y,
          },
        };

      // Custom mobile actions with human-readable descriptions
      case 'tap': {
        const action: GeneratedAction = {
          type: MobileActionType.TAP,
          parameters: {
            x: translatedArgs.x,
            y: translatedArgs.y,
          },
        };
        if (args.text && typeof args.text === 'string') {
          action.reasoning = args.text;
        }
        return action;
      }

      case 'input': {
        const action: GeneratedAction = {
          type: MobileActionType.INPUT,
          parameters: {
            text: args.value || '',
          },
        };
        if (args.text && typeof args.text === 'string') {
          action.reasoning = args.text;
        }
        return action;
      }

      case 'scroll': {
        // SCROLL with precise coordinates (like drag-and-drop)
        const action: GeneratedAction = {
          type: MobileActionType.SCROLL,
          parameters: {
            from: { x: translatedArgs.from_x, y: translatedArgs.from_y },
            to: { x: translatedArgs.to_x, y: translatedArgs.to_y },
          },
        };
        if (args.text && typeof args.text === 'string') {
          action.reasoning = args.text;
        }
        return action;
      }

      case 'swipe_points': {
        const action: GeneratedAction = {
          type: MobileActionType.SWIPE_POINTS,
          parameters: {
            from: { x: translatedArgs.from_x, y: translatedArgs.from_y },
            to: { x: translatedArgs.to_x, y: translatedArgs.to_y },
            duration: 300,
          },
        };
        if (args.text && typeof args.text === 'string') {
          action.reasoning = args.text;
        }
        return action;
      }

      case 'wait': {
        const action: GeneratedAction = {
          type: MobileActionType.WAIT,
          parameters: {
            seconds: args.seconds || 1,
          },
        };
        if (args.text && typeof args.text === 'string') {
          action.reasoning = args.text;
        }
        return action;
      }

      case 'back': {
        const action: GeneratedAction = {
          type: MobileActionType.BACK,
          parameters: {},
        };
        if (args.text && typeof args.text === 'string') {
          action.reasoning = args.text;
        }
        return action;
      }

      case 'home': {
        const action: GeneratedAction = {
          type: MobileActionType.HOME,
          parameters: {},
        };
        if (args.text && typeof args.text === 'string') {
          action.reasoning = args.text;
        }
        return action;
      }

      case 'done':
        return {
          type: MobileActionType.DONE,
          parameters: {
            text: args.text || 'Task completed',
            success: args.success ?? true,
          },
        };

      default:
        console.warn(`[Gemini] Unknown function call: ${name}`);
        return {
          type: name as MobileActionType,
          parameters: args,
        };
    }
  }

  /**
   * Build trajectory from task execution
   */
  buildTrajectory(options: BuildTrajectoryOptions): Trajectory {
    const { steps, startTime, endTime, success = true } = options;

    const numberedSteps: TaskStep[] = steps.map((step, index) => ({
      ...step,
      stepNumber: index + 1,
    }));

    return {
      steps: numberedSteps,
      success,
      metadata: {
        platform: this.platform,
        totalSteps: numberedSteps.length,
        model: this.modelConfig.model || this.modelName,
        startTime,
        endTime: endTime || new Date(),
      },
    };
  }

  /**
   * Build system prompt - not used in new API but required by base class
   */
  protected buildSystemPrompt(): string {
    return this.systemInstructions;
  }

  /**
   * Build user prompt - not used in new API but required by base class
   */
  protected buildUserPrompt(task: string, _deviceInfo: { width: number; height: number }): string {
    return task;
  }

  /**
   * Translate coordinates from Gemini's 1000x1000 system to device coordinates
   */
  protected translateCoordinates(
    args: Record<string, any>,
    deviceInfo: { width: number; height: number }
  ): Record<string, any> {
    const translated: Record<string, any> = { ...args };

    // Scale from 1000x1000 to device size
    const scaleX = deviceInfo.width / 1000;
    const scaleY = deviceInfo.height / 1000;

    // Translate single coordinate pairs
    if ('x' in args && typeof args.x === 'number') {
      translated.x = Math.round(args.x * scaleX);
    }
    if ('y' in args && typeof args.y === 'number') {
      translated.y = Math.round(args.y * scaleY);
    }

    // Translate destination coordinates for drag_drop
    if ('destination_x' in args && typeof args.destination_x === 'number') {
      translated.destination_x = Math.round(args.destination_x * scaleX);
    }
    if ('destination_y' in args && typeof args.destination_y === 'number') {
      translated.destination_y = Math.round(args.destination_y * scaleY);
    }

    // Translate from/to coordinates for swipe_points
    if ('from_x' in args && typeof args.from_x === 'number') {
      translated.from_x = Math.round(args.from_x * scaleX);
    }
    if ('from_y' in args && typeof args.from_y === 'number') {
      translated.from_y = Math.round(args.from_y * scaleY);
    }
    if ('to_x' in args && typeof args.to_x === 'number') {
      translated.to_x = Math.round(args.to_x * scaleX);
    }
    if ('to_y' in args && typeof args.to_y === 'number') {
      translated.to_y = Math.round(args.to_y * scaleY);
    }

    return translated;
  }
}
