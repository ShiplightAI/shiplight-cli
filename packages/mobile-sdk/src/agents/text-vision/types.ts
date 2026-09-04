/**
 * Text-Vision Agent Types
 *
 * Unified types for mobile task execution, aligned with web-sdk.
 * This enables future unification of mobile-sdk and web-sdk.
 */

import type { MobileActionEntity, ActionResult } from './actions';

// ============================================================================
// Task Execution Result (main return type)
// ============================================================================

/**
 * Task agent result - matches web-sdk's TaskExecutionResult
 */
export interface TaskExecutionResult {
  /** Overall success status */
  success: boolean;

  /** Was the task completed? (vs. max steps reached or error) */
  completed: boolean;

  /** Execution trajectory - what the agent did */
  trajectory: TaskExecutionTrajectory;

  /** Execution metadata */
  metadata: TaskExecutionMetadata;

  /** Error message if failed */
  error?: string;

  /** Summary of the task execution */
  summary?: string;
}

// ============================================================================
// Trajectory Types
// ============================================================================

/**
 * Task agent trajectory - semantic history with actions
 */
export interface TaskExecutionTrajectory {
  /** Number of steps taken */
  steps: number;

  /** All actions taken */
  actions: MobileActionEntity[];

  /** Step-by-step records */
  stepRecords: TaskStepRecord[];

  /** Agent-specific output (flexible) */
  output?: unknown;
}

/**
 * Single step record with action details
 */
export interface TaskStepRecord {
  stepNumber: number;
  timestamp: number;
  duration: number;

  // LLM reasoning
  thinking?: string;
  evaluation?: string;
  memory?: string;
  goal: string;

  // Actions executed in this step
  actions: MobileActionEntity[];

  // What happened in this step
  outcome: {
    success: boolean;
    error?: string;
  };

  // Mobile-specific: screenshot before action
  screenshotBefore?: string;
}

// ============================================================================
// Metadata Types
// ============================================================================

/**
 * Task agent execution metadata
 */
export interface TaskExecutionMetadata {
  /** Session ID */
  sessionId: string;

  /** Total steps taken */
  totalSteps: number;

  /** Total duration in ms */
  totalDuration: number;

  /** Model used */
  model: string;

  /** Agent type */
  agentType: 'vision' | 'text-vision';

  // Counters
  successfulSteps: number;
  failedSteps: number;

  // LLM stats (if available)
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
}

// ============================================================================
// Execution Options
// ============================================================================

/**
 * Task execution options
 */
export interface TaskExecutionOptions {
  /** Maximum steps per task */
  maxSteps?: number;

  /** Maximum retries per step */
  maxRetries?: number;

  /** Delay between retries in ms */
  retryDelay?: number;

  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;

  /** Event callback for streaming updates */
  onEvent?: (event: TaskExecutionEvent) => void | Promise<void>;
}

/**
 * Task execution events - streamed during execution
 */
export type TaskExecutionEvent =
  | { type: 'start'; task: string; maxSteps: number }
  | { type: 'step_start'; step: number }
  | { type: 'thinking'; text: string }
  | { type: 'action'; action: MobileActionEntity; step: number }  // Only emitted after successful execution
  | { type: 'step_complete'; step: number; duration: number }
  | { type: 'complete'; totalSteps: number; duration: number }
  | { type: 'error'; error: string; step?: number; recoverable: boolean };

// ============================================================================
// Legacy Types (for backward compatibility)
// ============================================================================

/**
 * @deprecated Use TaskStepRecord instead
 */
export interface StepResult {
  stepNumber: number;
  action: MobileActionEntity;
  result: ActionResult;
  reasoning?: string;
  screenshotBefore?: string;
  timestamp: Date;
}

/**
 * @deprecated Use TaskExecutionResult instead
 */
export interface TaskResult {
  sessionId: string;
  success: boolean;
  message: string;
  steps: StepResult[];
  durationMs: number;
}

// ============================================================================
// Conversion Utilities
// ============================================================================

/**
 * Convert legacy TaskResult to new TaskExecutionResult format
 */
export function convertToTaskExecutionResult(
  legacy: TaskResult,
  model: string,
  agentType: 'vision' | 'text-vision',
): TaskExecutionResult {
  const stepRecords: TaskStepRecord[] = legacy.steps.map((step) => ({
    stepNumber: step.stepNumber,
    timestamp: step.timestamp.getTime(),
    duration: step.result.duration ?? 0,
    thinking: step.reasoning,
    goal: step.action.action_description,
    actions: [step.action],
    outcome: {
      success: step.result.success,
      error: step.result.error,
    },
    screenshotBefore: step.screenshotBefore,
  }));

  const successfulSteps = legacy.steps.filter((s) => s.result.success).length;
  const failedSteps = legacy.steps.length - successfulSteps;

  // Check if task completed (last action was 'done' with success)
  const lastStep = legacy.steps[legacy.steps.length - 1];
  const completed =
    lastStep?.action.action_data.action_name === 'done' &&
    lastStep?.action.action_data.kwargs?.success === true;

  return {
    success: legacy.success,
    completed,
    trajectory: {
      steps: legacy.steps.length,
      actions: legacy.steps.map((s) => s.action),
      stepRecords,
    },
    metadata: {
      sessionId: legacy.sessionId,
      totalSteps: legacy.steps.length,
      totalDuration: legacy.durationMs,
      model,
      agentType,
      successfulSteps,
      failedSteps,
    },
    summary: legacy.message,
    error: legacy.success ? undefined : legacy.message,
  };
}
