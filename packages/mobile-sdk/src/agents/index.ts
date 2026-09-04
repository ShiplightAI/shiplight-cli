/**
 * Agents Module
 *
 * Provides AI-powered mobile automation agents.
 *
 * Two agent types:
 * - VisionAgent: Pure vision (screenshot only, coordinate-based output)
 * - TextVisionAgent: Text + Vision (element tree + screenshot, selector-based output)
 */

// =============================================================================
// Common Agent Interface
// =============================================================================
export type {
  IMobileAgent,
  GenerateActionStepResult,
  StepTrackingConfig,
  StepExecutionResult,
} from './types';

// =============================================================================
// Vision Agent (pure vision with coordinates)
// =============================================================================

export {
  // Main agent
  VisionAgent,
  MobileAgent, // Backward compatibility alias (value + type)
  type VisionAgentConfig,
  type MobileAgentConfig, // Backward compatibility alias
  type ExecutionState,

  // Executor
  VisionExecutor,
  AdbExecutor, // Backward compatibility alias
  ActionExecutor, // Backward compatibility alias

  // Action generator
  VisionActionGenerator,

  // Model configuration
  getDefaultModelConfig,

  // Types - prefixed to avoid conflicts
  MobileActionType,
  type AIModelConfig,
  type MobileAgentOutput,
  type GeneratedAction,
  type TaskStep,
  type Trajectory,
  type ExecutionHistoryEntry,
  type PlanNextActionOptions,
  type DoneAction,
  type TaskCompletionSignal,

  // Providers
  BaseVisionProvider,
  GeminiVisionProvider,
  OpenAIVisionProvider,
} from './vision';

// Re-export vision types with prefix for disambiguation
export type {
  ActionResult as VisionActionResult,
  GenerateActionOptions as VisionGenerateActionOptions,
  BuildTrajectoryOptions as VisionBuildTrajectoryOptions,
} from './vision';

// =============================================================================
// Text + Vision Agent (element tree + screenshot with selectors)
// =============================================================================

export {
  // Main agent
  TextVisionAgent,
  type TextVisionAgentConfig,

  // Executor
  TextVisionExecutor,
  AppiumExecutor, // Backward compatibility alias
  type AppiumConfig,
  type IExecutor,
  type RetryConfig,
  DEFAULT_RETRY_CONFIG,

  // Provider
  GeminiProProvider,
  type GeminiProConfig,
  type GenerateActionResult,
  type LLMDebugInfo,

  // Task execution types
  type TaskExecutionResult,
  type TaskExecutionTrajectory,
  type TaskStepRecord,
  type TaskExecutionMetadata,
  type TaskExecutionOptions,
  type TaskExecutionEvent,
  type StepResult, // Legacy
  type TaskResult, // Legacy
  convertToTaskExecutionResult,

  // Actions
  ActionHandler,
  type MobileActionEntity,
  type ActionDataEntity,
  type IAction,
  type MobileActionName,
  type LocatorType,
  type ParsedLocator,
  parseLocator,
  toUiAutomator,
  requiresLocator,
  findElement,
  transpileLocator,

  // Services
  MobileAgentServices,
  type EvaluateResult,
} from './text-vision';

// Re-export text-vision types with prefix for disambiguation
export type {
  ActionResult as TextVisionActionResult,
  GenerateActionOptions as TextVisionGenerateActionOptions,
} from './text-vision';

// For backward compatibility, also export without prefix (text-vision is the default)
export type { ActionResult } from './text-vision';
