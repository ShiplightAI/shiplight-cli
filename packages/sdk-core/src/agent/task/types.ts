/**
 * Task Agent Types
 *
 * A task agent is an autonomous agent that completes a single task using an LLM loop.
 * It takes a natural language task description and autonomously executes it by:
 * 1. Calling LLM with available tools
 * 2. Executing tool calls
 * 3. Updating context
 * 4. Repeating until task is complete
 */

import { ActionEntity } from '../../actions/types';
import { AgentOptions, StepResult } from '../core/types';
import { ActionGenerationDebugInfo, TokenUsage } from 'shiplight-types';

// ============================================================================
// Task Agent Types
// ============================================================================

// Re-export TaskExecutionContext from core for convenience
export type { TaskExecutionContext } from '../core/types';

/**
 * Task agent execution options
 * Note: Model is obtained from AgentServices.getModel() (via AgentContext), not passed in options
 */
export interface TaskExecutionOptions {
	// LLM Configuration
	temperature?: number;
	maxSteps?: number;

	// Retry Configuration
	maxRetries?: number;

	// Streaming callback
	onEvent?: (event: TaskExecutionEvent) => void | Promise<void>;

	// Abort signal
	abortSignal?: AbortSignal;

	// Additional options (agent-specific)
	[key: string]: any;
}

/**
 * Task agent events - streamed during execution
 */
export type TaskExecutionEvent =
	| { type: 'start'; task: string; maxSteps: number }
	| { type: 'step_start'; step: number }
	| { type: 'thinking'; text: string }
	| { type: 'tool_call'; tool: string; args: any; id: string }
	| { type: 'tool_result'; tool: string; result: any; id: string }
	| { type: 'action'; action_entity: ActionEntity; step: number; screenshot_before?: string; screenshot_after?: string; debugInfo?: ActionGenerationDebugInfo }
	| { type: 'step_complete'; step: number; duration: number }
	| { type: 'complete'; totalSteps: number; duration: number }
	| { type: 'error'; error: string; step?: number; recoverable: boolean };

/**
 * Task agent result
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

/**
 * Task agent trajectory - semantic history with browser actions
 */
export interface TaskExecutionTrajectory {
	/** Number of steps taken */
	steps: number;

	/** All browser actions taken */
	actions: ActionEntity[];

	/** Step-by-step records */
	stepRecords: TaskStepRecord[];

	/** Agent-specific output (flexible) */
	output?: any;
}

/**
 * Single step record with browser action details
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

	// Browser actions executed in this step
	actions: ActionEntity[];

	// What happened in this step
	outcome: {
		success: boolean;
		error?: string;
	};

	/** Debug info from the LLM call for this step */
	debugInfo?: ActionGenerationDebugInfo;
	/** Token usage from this step's LLM call */
	tokenUsages?: TokenUsage[];
}

/**
 * Task agent execution metadata
 */
export interface TaskExecutionMetadata {
	totalSteps: number;
	totalDuration: number;
	model: string;

	// Counters
	successfulSteps: number;
	failedSteps: number;

	// LLM stats (if available)
	totalTokens?: number;
	promptTokens?: number;
	completionTokens?: number;

	/** Aggregated token usages across all steps */
	tokenUsages?: TokenUsage[];
}

// ============================================================================
// Internal Implementation Types
// ============================================================================

/**
 * Structured output from LLM for each step
 * Includes thinking, evaluation, memory, and goal planning
 */
export interface TaskStepOutput {
	// Intelligence fields
	thinking?: string; // Internal reasoning about the situation
	evaluation_previous_goal?: string; // Evaluation of previous step (success/failure/partial)
	memory?: string; // Important facts to remember across steps
	current_goal: string; // Current sub-goal to accomplish in this step

	// Actions to execute (can be single or multiple)
	actions: Array<{
		description: string; // Human-readable description
		action_name: string; // Action name (e.g., "click", "type")
		kwargs: Record<string, any>; // Action parameters
	}>;

	// Completion flag
	completes_instruction: boolean; // Is the entire task complete?
}

/**
 * State tracked across the entire task execution
 */
export interface TaskExecutionState {
	// Step tracking
	currentStep: number;
	maxSteps: number;

	// Memory and context
	memory: string[]; // Accumulated important facts
	lastEvaluation: string | null; // Last evaluation result
	lastGoal: string | null; // Last goal attempted

	// Error tracking
	consecutiveFailures: number;
	maxFailures: number;
	lastFailReason: string | null;

	// History
	stepHistory: TaskStepRecord[];
}

/**
 * Record of a single step execution (internal, legacy - kept for backward compatibility)
 */
export interface InternalTaskStepRecord {
	stepNumber: number;
	thinking?: string;
	evaluation?: string;
	memory?: string;
	goal: string;
	actionEntities: ActionEntity[]; // Can have multiple actions per step
	results: StepResult[]; // One result per action
	timestamp: number;
	duration: number; // milliseconds
}

/**
 * Options specific to task agent (internal, extends AgentOptions)
 */
export interface TaskAgentOptions extends AgentOptions {
	// Execution limits
	maxSteps?: number; // Maximum number of steps (default: 15)
	maxFailures?: number; // Maximum consecutive failures (default: 3)

	// Feature flags
	useThinking?: boolean; // Enable thinking field (default: true)
	useMemory?: boolean; // Enable memory tracking (default: true)
	useEvaluation?: boolean; // Enable evaluation of previous steps (default: true)
	useMultiAction?: boolean; // Allow multiple actions per step (default: true)

	// Callbacks
	onStepStart?: (step: number) => void;
	onStepComplete?: (record: TaskStepRecord) => void;
}

/**
 * Result of the entire task execution (internal - DEPRECATED)
 *
 * @deprecated This type is no longer used. Use TaskExecutionResult instead.
 * Kept for backward compatibility but will be removed in the future.
 */
export interface TaskResult extends StepResult {
	// Task summary
	totalSteps: number;
	successfulSteps: number;
	failedSteps: number;
	totalDuration: number; // milliseconds

	// Final state
	finalMemory: string[];
	finalEvaluation: string | null;

	// History
	stepHistory: TaskStepRecord[];

	// Chat summary for conversation
	chatSummary: string;
}

