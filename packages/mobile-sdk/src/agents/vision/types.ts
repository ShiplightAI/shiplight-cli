/**
 * Vision Agent Types
 *
 * Types for pure vision-based mobile automation (coordinates, no selectors).
 */

import type { DeviceAction } from '../../devices/common/types';

export interface AIModelConfig {
  provider: 'openai' | 'anthropic' | 'gemini';
  model: string;
  /** API key (optional - provider can read from environment variables) */
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Canonical mobile action types supported across all LLM providers
 * Each provider maps their native actions to these types
 */
export enum MobileActionType {
  /** Single tap at coordinates */
  TAP = 'tap',
  /** Tap an element by index (from element tree) */
  TAP_ELEMENT = 'tap_element',
  /** Double tap at coordinates */
  DOUBLE_TAP = 'double_tap',
  /** Long press at coordinates */
  LONG_PRESS = 'long_press',
  /** Input text */
  INPUT = 'input',
  /** Swipe gesture in a direction (30% screen height - for quick gestures) */
  SWIPE = 'swipe',
  /** Swipe between two points */
  SWIPE_POINTS = 'swipe_points',
  /** Precise scroll in a direction (75% screen height - page-like scrolling) */
  SCROLL = 'scroll',
  /** Press back button */
  BACK = 'back',
  /** Press home button */
  HOME = 'home',
  /** Wait for duration */
  WAIT = 'wait',
  /** Generate verification assertion */
  GENERATE_VERIFICATION = 'generate_verification',
  /** Take a screenshot */
  SCREENSHOT = 'screenshot',
  /** Task completed */
  DONE = 'done',
}

export interface TaskStep {
  stepNumber: number;
  action: GeneratedAction;
  screenshot: string; // File path to screenshot (e.g., "./debug-screenshots/step-1-before.png")
  description?: string; // Human-readable description of the action (e.g., "Tap YouTube icon")
  result?: ActionResult;
  timestamp: Date;
}

export interface GeneratedAction {
  type: MobileActionType | string; // Allow string for backward compatibility
  parameters: Record<string, any>;
  reasoning?: string;
}

export interface DoneAction {
  text: string;
  success: boolean;
}

export interface MobileAgentOutput {
  screen_vision_description: string;
  thinking?: string;
  analysis_previous_step?: string;
  evaluation_previous_goal: string;
  memory: string;
  current_goal: string;
  description_of_target_element?: string;
  action: GeneratedAction | { type: MobileActionType.DONE; parameters: DoneAction };
  action_description: string;
  // When model returns multiple function calls, this contains all actions
  actions?: GeneratedAction[];
}

export interface ActionResult {
  success: boolean;
  message?: string; // Explanation of what happened (replaces error for better clarity)
  duration?: number;
}

export interface Trajectory {
  steps: TaskStep[];
  success: boolean;
  metadata: {
    platform: 'android' | 'ios';
    totalSteps: number;
    model: string;
    startTime: Date;
    endTime?: Date;
  };
}

export interface ExecutionHistoryEntry {
  statement: string;
  screenshot: string; // File path to screenshot (e.g., "./debug-screenshots/step-1-before.png")
  agentOutput: MobileAgentOutput;
  result: ActionResult;
  timestamp: Date;
}

export interface GenerateActionOptions {
  statement: string;
  screenshot: string; // Base64 data URL for AI vision processing
  capabilities: DeviceAction[];
  executionHistory?: ExecutionHistoryEntry[];
  deviceInfo: {
    width: number;
    height: number;
    dpr?: number;
  };
}

export interface PlanNextActionOptions {
  task: string;
  screenshot: string;
  capabilities: DeviceAction[];
  previousSteps: Omit<TaskStep, 'stepNumber'>[];
  executionHistory?: ExecutionHistoryEntry[];
}

export interface BuildTrajectoryOptions {
  steps: Omit<TaskStep, 'stepNumber'>[];
  startTime: Date;
  endTime?: Date;
  success?: boolean;
}

export type TaskCompletionSignal = { type: 'task_complete' };
