/**
 * Text-Vision Agent Module
 *
 * Uses screenshot + accessibility tree (element tree) with selector-based
 * actions for reliable mobile automation.
 *
 * Components:
 * - TextVisionAgent: Main orchestrator for text+vision automation
 * - TextVisionExecutor: Executes selector-based actions via Appium
 * - GeminiProProvider: AI provider for generating actions
 * - Actions: Selector-based action implementations
 * - Types: Task execution types and results
 */

// Main agent
export {
  TextVisionAgent,
  type TextVisionAgentConfig,
} from './TextVisionAgent';

// Executor
export {
  TextVisionExecutor,
  AppiumExecutor, // Backward compatibility alias
  type AppiumConfig,
  type IExecutor,
  type RetryConfig,
  DEFAULT_RETRY_CONFIG,
} from './executor';

// Provider
export {
  GeminiProProvider,
  type GeminiProConfig,
  type GenerateActionResult,
  type GenerateActionOptions,
  type LLMDebugInfo,
} from './provider';

// Task execution types
export type {
  TaskExecutionResult,
  TaskExecutionTrajectory,
  TaskStepRecord,
  TaskExecutionMetadata,
  TaskExecutionOptions,
  TaskExecutionEvent,
  StepResult, // Legacy
  TaskResult, // Legacy
} from './types';

export { convertToTaskExecutionResult } from './types';

// Services
export {
  MobileAgentServices,
  type EvaluateResult,
} from './mobileAgentServices';

// Actions - re-export from actions submodule
export * from './actions';
