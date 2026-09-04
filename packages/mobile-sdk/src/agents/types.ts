/**
 * Common Agent Types
 *
 * Shared interfaces for mobile automation agents.
 */

import type { MobileActionEntity, ActionResult } from './text-vision/actions';
import type { TaskExecutionResult, TaskExecutionOptions } from './text-vision/types';

// Re-export for convenience
export type { TaskExecutionResult, TaskExecutionOptions };

/**
 * Step execution result for tracking
 */
export interface StepExecutionResult {
  description: string;
  startTime: number;
  duration?: number;
  status?: 'success' | 'failure' | 'skipped';
  message?: string;
  artifacts: Array<Record<string, string>>;
  screenshot?: string;
}

/**
 * Step tracking configuration
 * Similar to web-sdk's StepTrackingConfig for consistency
 */
export interface StepTrackingConfig {
  /** Per-step results */
  results: Record<string, StepExecutionResult>;
  /** Directory for per-step artifacts (screenshots, LLM logs) */
  artifactsDir?: string;
  /** Callback when step completes */
  onStepComplete?: (stepId: string, result: StepExecutionResult) => void;
}

/**
 * Result of generating an action step
 */
export interface GenerateActionStepResult {
  /** The generated action */
  action: MobileActionEntity;
  /** Screenshot taken before generation (base64) */
  screenshot: string;
  /** Element tree string (for text-vision agents) */
  elementTree?: string;
  /** AI reasoning for this action */
  reasoning?: string;
  /** Whether this action indicates task completion */
  done: boolean;
}

/**
 * Common interface for mobile automation agents
 *
 * Both VisionAgent and TextVisionAgent implement this interface,
 * allowing them to be used interchangeably.
 */
export interface IMobileAgent {
  /**
   * Setup agent dependencies (e.g., start Appium for TextVisionAgent)
   *
   * Called before first use to ensure all dependencies are ready.
   * - TextVisionAgent: Starts Appium server if not running
   * - VisionAgent: No-op (uses direct ADB)
   */
  setup(): Promise<void>;

  /**
   * Generate an action step without executing it
   *
   * Takes a screenshot, analyzes the screen, and generates an action via AI.
   * Useful for previewing what the agent would do without actually doing it.
   *
   * @param task - The task/statement to generate action for
   * @param previousFeedback - Optional feedback from previous action (for retry context)
   * @returns Generated action, screenshot, and reasoning
   */
  generateActionStep(
    task: string,
    previousFeedback?: string,
  ): Promise<GenerateActionStepResult>;

  /**
   * Execute a generated action
   *
   * Use this after generateActionStep to execute the action.
   *
   * @param action - The action to execute
   * @returns Action result (success/failure)
   */
  executeAction(action: MobileActionEntity): Promise<ActionResult>;

  /**
   * Execute a single step (generate + execute one action)
   *
   * Combines generateActionStep and executeAction into one call.
   * Useful for step-by-step execution with manual control.
   *
   * @param task - The task/statement to execute
   * @returns Whether the step succeeded
   */
  executeSingleStep(task: string): Promise<boolean>;

  /**
   * Execute a complete task
   *
   * Runs a multi-step task until completion or max steps reached.
   *
   * @param task - The task to execute
   * @param options - Execution options
   * @returns Task execution result with full trajectory
   */
  executeTask(task: string, options?: TaskExecutionOptions): Promise<TaskExecutionResult>;

  /**
   * Cleanup resources (stop Appium, close connections, etc.)
   */
  cleanup(): Promise<void>;

  /**
   * Set variables for substitution in actions
   */
  setVariables?(variables: Map<string, string>): void;

  /**
   * Set a single variable
   */
  setVariable?(key: string, value: string): void;

  /**
   * Stop any ongoing task execution
   */
  stop?(): void;

  /**
   * Reset internal execution state
   *
   * Clears execution history to start fresh.
   * For VisionAgent: resets the internal ExecutionState
   * For TextVisionAgent: resets the conversation history
   */
  resetState?(): void;

  /**
   * Get the last execution result
   *
   * Returns the result from the last executeTask or executeSingleStep call.
   * Useful for showing/exporting trajectory without storing it externally.
   */
  getLastResult?(): TaskExecutionResult | null;

  /**
   * Take a screenshot of the current screen
   *
   * Returns base64-encoded PNG image data.
   * This is a lightweight operation that doesn't invoke the LLM.
   */
  screenshot?(): Promise<string>;
}
