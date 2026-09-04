/**
 * Vision Agent Module
 *
 * Pure vision-based mobile automation using screenshot analysis
 * with coordinate-based actions (no selectors).
 *
 * Components:
 * - VisionAgent: Main orchestrator for vision-based automation
 * - VisionExecutor: Executes coordinate-based actions via ADB
 * - VisionActionGenerator: Factory for AI vision providers
 * - Types: Action types, results, trajectories
 */

// Main agent
export {
  VisionAgent,
  MobileAgent, // Backward compatibility alias (value + type)
  type VisionAgentConfig,
  type MobileAgentConfig, // Backward compatibility alias
  type ExecutionState,
} from './VisionAgent';

// Executor
export {
  VisionExecutor,
  AdbExecutor, // Backward compatibility alias
  ActionExecutor, // Backward compatibility alias
} from './executor';

// Action generator
export { VisionActionGenerator } from './generator';

// Model configuration
export { getDefaultModelConfig } from './modelConfig';

// Types
export type {
  AIModelConfig,
  MobileAgentOutput,
  GeneratedAction,
  ActionResult,
  TaskStep,
  Trajectory,
  ExecutionHistoryEntry,
  GenerateActionOptions,
  BuildTrajectoryOptions,
  PlanNextActionOptions,
  DoneAction,
  TaskCompletionSignal,
} from './types';

export { MobileActionType } from './types';

// Provider base (for extending)
export { BaseVisionProvider } from './providers/base/BaseVisionProvider';
export { GeminiVisionProvider } from './providers/gemini/GeminiVisionProvider';
export { OpenAIVisionProvider } from './providers/openai/OpenAIVisionProvider';
