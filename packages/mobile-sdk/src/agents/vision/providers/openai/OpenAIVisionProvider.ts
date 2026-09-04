/**
 * OpenAI Vision Provider
 * OpenAI Computer Use Preview implementation for vision-based mobile automation
 *
 * OpenAI-specific features:
 * - Native screen coordinates (no translation needed)
 * - Responses API (not Chat Completions)
 * - computer_call format with actions
 * - Safety checks and reasoning support
 */

import OpenAI from 'openai';
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
    case MobileActionType.SWIPE_POINTS:
      return 'Swipe between points';
    case MobileActionType.BACK:
      return 'Go back';
    case MobileActionType.HOME:
      return 'Go to home screen';
    case MobileActionType.WAIT:
      return 'Wait';
    case MobileActionType.GENERATE_VERIFICATION:
      return 'Generate verification';
    case MobileActionType.SCREENSHOT:
      return 'Take screenshot';
    case MobileActionType.DONE:
      return parameters.text || 'Task completed';
    default:
      return `Perform ${actionType}`;
  }
}

export class OpenAIVisionProvider extends BaseVisionProvider {
  private client: OpenAI;
  private previousResponseId?: string;
  private lastCallId?: string;
  private systemInstructions: string;

  constructor(platform: 'android' | 'ios', modelConfig: AIModelConfig) {
    super(platform, modelConfig);

    if (!modelConfig.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.client = new OpenAI({
      apiKey: modelConfig.apiKey,
    });

    // Set default system instructions for mobile
    this.systemInstructions = this.buildMobileInstructions(platform);

    // Allow custom instructions from environment variable
    const customInstructions = process.env.OPENAI_SYSTEM_INSTRUCTIONS || process.env.SYSTEM_INSTRUCTIONS;
    if (customInstructions) {
      this.systemInstructions += '\n\n---\n\nCUSTOM INSTRUCTIONS:\n' + customInstructions;
      console.log('[OpenAI] Added custom system instructions');
    }
  }

  /**
   * Build mobile-specific instructions for OpenAI CUA
   */
  private buildMobileInstructions(platform: 'android' | 'ios'): string {
    const intro = `You are controlling a mobile device through computer use actions.

TASK COMPLETION:
When you have successfully completed the task, stop taking actions and let the system know you're done.
The task is complete when you have achieved the goal stated in the TASK description.
Do NOT take any actions after the task is complete.`;

    const deviceInstructions = this.buildDeviceInstructions(platform);
    const appInstructions = this.buildAppInstructions();

    return `${intro}\n\n${deviceInstructions}\n\n${appInstructions}`;
  }

  /**
   * Build device-level instructions (OS and navigation)
   */
  private buildDeviceInstructions(platform: 'android' | 'ios'): string {
    const commonDevice = `DEVICE NAVIGATION:
- Tap: Single touch on an element
- Double-tap: Quick two taps on an element
- Long press: Hold finger on element for ~1 second
- Swipe: Quick gesture in a direction (up/down/left/right)
- Drag: Press and move element to a new position`;

    if (platform === 'android') {
      return `${commonDevice}

ANDROID SYSTEM GESTURES:
- Go to home screen: Swipe up from bottom of screen (or tap home button if visible)
- Back navigation: Swipe from left edge inward, or tap back button if visible
- Recent apps/Task switcher: Swipe up from bottom and pause in middle
- Notifications: Swipe down from top of screen
- Quick settings: Swipe down from top twice
- App drawer: Swipe up from bottom on home screen`;
    } else {
      return `${commonDevice}

iOS SYSTEM GESTURES:
- Go to home screen: Swipe up from bottom edge (or tap home button on older devices)
- Back navigation: Swipe from left edge inward
- App switcher: Swipe up from bottom edge and pause in middle
- Control center: Swipe down from top-right corner
- Notification center: Swipe down from top-left corner
- Spotlight search: Swipe down from middle of home screen`;
    }
  }

  /**
   * Build app-specific instructions
   */
  private buildAppInstructions(): string {
    return `APP-SPECIFIC BEHAVIORS:

YouTube:
- Enter picture-in-picture (PiP) mode: Drag the playing video to the bottom-right corner of screen
  * This minimizes video to corner AND reveals the top navigation bar
  * Once in PiP, you can interact with other parts of the app
  * Drag PiP video back to center to exit PiP mode
- Close/minimize video: Drag video to bottom-right corner, then swipe down to dismiss
- Pause/Play: Tap on the video
- Full screen: Tap video, then tap fullscreen button
- Navigate videos: Swipe left/right on video feed
- Search: Tap search icon in top bar (drag video to corner first if playing)
- Scrub video: Drag the progress bar slider left/right

Chrome/Browser:
- Scroll page: Swipe up (to scroll down) or swipe down (to scroll up)
- New tab: Tap tab count button, then tap "+"
- Switch tabs: Tap tab count, then tap desired tab
- Refresh: Pull down from top of page
- Go back: Swipe from left edge or tap back button
- Address bar: Tap the URL at top

Settings:
- Navigate menus: Tap menu items to drill down
- Go back: Tap back arrow top-left or swipe from left edge
- Toggle switches: Tap to enable/disable
- Scroll long lists: Swipe up to scroll down

General Mobile App Patterns:
- Bottom navigation: Apps often have 4-5 tabs at bottom - tap to switch
- Hamburger menu: Three horizontal lines (≡) in top-left - tap to open side menu
- More options: Three vertical dots (⋮) in top-right - tap for more actions
- Pull to refresh: Pull down from top of scrollable content to refresh
- Modal close: Tap X, or swipe down, or tap outside modal area
- Keyboard dismiss: Tap outside text field or swipe down on keyboard`;
  }

  /**
   * Generate a single action from screenshot and task description
   */
  async generateAction(options: GenerateActionOptions): Promise<MobileAgentOutput> {
    const { statement, screenshot, deviceInfo } = options;

    console.log(`[OpenAI] API call parameters: display_width=${deviceInfo.width}, display_height=${deviceInfo.height}`);
    console.log(`[OpenAI] Screenshot data URL length: ${screenshot.length} chars`);

    // Prepare request parameters
    const requestParams: any = {
      model: this.modelConfig.model || 'computer-use-preview',
      tools: [
        {
          type: 'computer_use_preview',
          display_width: deviceInfo.width,
          display_height: deviceInfo.height,
          environment: this.platform === 'android' ? 'browser' : 'browser', // Mobile uses browser environment
        } as any, // Type assertion needed due to SDK type definitions
      ],
      reasoning: {
        summary: 'concise',
      },
      truncation: 'auto',
    };

    // If this is a follow-up request, use previous_response_id and send only the new screenshot
    if (this.previousResponseId) {
      requestParams.previous_response_id = this.previousResponseId;
      requestParams.input = [
        {
          type: 'computer_call_output',
          call_id: this.lastCallId || `call_${Date.now()}`,
          output: {
            type: 'computer_screenshot',
            image_url: screenshot, // screenshot already includes data URL prefix
          },
        },
      ];
    } else {
      // First request - include system instructions + initial task and screenshot
      const fullText = `${this.systemInstructions}\n\n---\n\nTASK: ${statement}`;

      requestParams.input = [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: fullText,
            },
            {
              type: 'input_image',
              image_url: screenshot, // screenshot already includes data URL prefix
            },
          ],
        },
      ];
    }

    // Make API call
    const response = await this.client.responses.create(requestParams);

    // Save response ID and call ID for next request (using previous_response_id pattern)
    this.previousResponseId = response.id;

    // Extract reasoning and action from response
    let reasoning = '';
    let computerCall: any = null;

    for (const item of response.output) {
      if (item.type === 'reasoning' && item.summary) {
        reasoning = item.summary.map((s: any) => s.text).join(' ');
      }
      if (item.type === 'computer_call') {
        computerCall = item;
        // Save call_id for next request
        this.lastCallId = item.call_id;
      }
    }

    if (!computerCall) {
      // No action - task might be complete
      // Reset conversation state
      this.previousResponseId = undefined;
      this.lastCallId = undefined;

      return {
        screen_vision_description: 'Task completed',
        evaluation_previous_goal: 'No further actions needed',
        memory: reasoning || '',
        current_goal: 'Complete',
        action: {
          type: MobileActionType.DONE,
          parameters: {
            text: 'No computer action returned by model',
            success: true,
          },
        },
        action_description: 'Task completed',
      };
    }

    // Parse the computer action
    const action = computerCall.action;

    // Convert OpenAI action format to our format
    const generatedAction: GeneratedAction = this.convertOpenAIAction(action);
    const actionDescription = reasoning || generateFallbackDescription(generatedAction.type, generatedAction.parameters);

    return {
      screen_vision_description: reasoning || 'Performing action',
      evaluation_previous_goal: 'Action generated',
      memory: reasoning || '',
      current_goal: statement,
      action: generatedAction,
      action_description: actionDescription,
    };
  }

  /**
   * Convert OpenAI action format to our mobile action format
   * OpenAI uses native screen coordinates, so no translation needed
   */
  private convertOpenAIAction(openaiAction: any): GeneratedAction {
    const openaiType = openaiAction.type;
    const parameters: Record<string, any> = {};

    // Map OpenAI action types to our canonical mobile action types
    switch (openaiType) {
      case 'click':
        // OpenAI click → TAP (native screen coordinates)
        return {
          type: MobileActionType.TAP,
          parameters: {
            x: openaiAction.x,
            y: openaiAction.y,
          },
        };

      case 'double_click':
        // OpenAI double_click → DOUBLE_TAP
        return {
          type: MobileActionType.DOUBLE_TAP,
          parameters: {
            x: openaiAction.x,
            y: openaiAction.y,
          },
        };

      case 'type':
        // OpenAI type → INPUT
        return {
          type: MobileActionType.INPUT,
          parameters: {
            text: openaiAction.text,
          },
        };

      case 'drag':
        // OpenAI drag: { path: [{x, y}, {x, y}, ...] }
        // Map to SWIPE_POINTS using first and last points
        const path = openaiAction.path || [];
        if (path.length < 2) {
          console.warn('[OpenAI] Drag action requires at least 2 points in path');
          return {
            type: MobileActionType.SWIPE,
            parameters: { direction: 'down' },
          };
        }
        const from = path[0];
        const to = path[path.length - 1];
        return {
          type: MobileActionType.SWIPE_POINTS,
          parameters: {
            from: { x: from.x, y: from.y },
            to: { x: to.x, y: to.y },
            duration: 300,
          },
        };

      case 'scroll':
        // OpenAI scroll: scroll(x, y, scroll_x, scroll_y)
        // Map to SWIPE - scroll down = swipe up (opposite direction for mobile gestures)
        const scrollX = openaiAction.scroll_x || 0;
        const scrollY = openaiAction.scroll_y || 0;

        // Determine primary scroll direction (prefer Y if both are present)
        if (Math.abs(scrollY) >= Math.abs(scrollX)) {
          return {
            type: MobileActionType.SWIPE,
            parameters: {
              direction: scrollY > 0 ? 'up' : 'down', // Inverted: scroll down = swipe up
              distance: Math.abs(scrollY),
            },
          };
        } else {
          return {
            type: MobileActionType.SWIPE,
            parameters: {
              direction: scrollX > 0 ? 'left' : 'right', // Inverted: scroll right = swipe left
              distance: Math.abs(scrollX),
            },
          };
        }

      case 'wait':
        return {
          type: MobileActionType.WAIT,
          parameters: {
            seconds: (openaiAction.ms || 1000) / 1000,
          },
        };

      case 'keypress':
        // OpenAI keypress: { keys: ["Enter"] } or { keys: ["CTRL", "C"] }
        // Map to mobile-friendly actions
        const key = openaiAction.keys?.[0] || 'Enter';

        // Map common keys to text input
        if (key === 'Enter' || key === 'RETURN') {
          return {
            type: MobileActionType.INPUT,
            parameters: {
              text: '\n',
            },
          };
        } else if (key === 'Tab') {
          return {
            type: MobileActionType.INPUT,
            parameters: {
              text: '\t',
            },
          };
        } else if (key === 'Space') {
          return {
            type: MobileActionType.INPUT,
            parameters: {
              text: ' ',
            },
          };
        } else {
          // For other keys (Backspace, Delete, modifiers), log a warning and convert to INPUT if printable
          console.warn(`[OpenAI] Unsupported keypress on mobile: ${key}. Attempting to type as text.`);
          return {
            type: MobileActionType.INPUT,
            parameters: {
              text: key.length === 1 ? key : '',
            },
          };
        }

      case 'screenshot':
        // OpenAI screenshot action - mark for agent loop to handle
        return {
          type: MobileActionType.SCREENSHOT,
          parameters: {},
        };

      default:
        // Unknown action - pass through with all parameters
        Object.keys(openaiAction).forEach((key) => {
          if (key !== 'type') {
            parameters[key] = openaiAction[key];
          }
        });
        return {
          type: openaiType,
          parameters,
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
        model: this.modelConfig.model || 'computer-use-preview',
        startTime,
        endTime: endTime || new Date(),
      },
    };
  }

  /**
   * Build system prompt - OpenAI CUA uses built-in prompts
   * This is not used but required by base class
   */
  protected buildSystemPrompt(): string {
    return ''; // OpenAI CUA has built-in system prompts
  }

  /**
   * Build user prompt - OpenAI CUA uses structured input format
   * This is not used but required by base class
   */
  protected buildUserPrompt(task: string, _deviceInfo: { width: number; height: number }): string {
    return task; // OpenAI CUA uses structured input format
  }

  /**
   * Translate coordinates - OpenAI uses native screen coordinates
   * No translation needed
   */
  protected translateCoordinates(
    args: Record<string, any>,
    _deviceInfo: { width: number; height: number }
  ): Record<string, any> {
    return args; // OpenAI uses native coordinates - no translation needed
  }
}
