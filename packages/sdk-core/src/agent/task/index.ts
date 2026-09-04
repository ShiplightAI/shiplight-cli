/**
 * Intelligent Task Agent
 *
 * Export all task agent components
 */

// Task executor (functional approach)
export { runTaskLoop } from './executor';

// Public API types
export type {
	TaskExecutionContext,
	TaskExecutionOptions,
	TaskExecutionResult,
	TaskExecutionTrajectory,
	TaskExecutionMetadata,
	TaskExecutionEvent,
	TaskStepRecord,
	TaskExecutionState,
} from './types';

// Internal types (for advanced use cases)
export type {
	TaskStepOutput,
	InternalTaskStepRecord,
	TaskResult,
	TaskAgentOptions,
} from './types';

// Utilities
export { TaskMessageManager } from './messageManager';
export {
	formatTaskContext,
	formatFinalStepWarning,
	getBrowserTaskJSONPrompt,
} from './prompts';
