/**
 * Agent SDK - Framework-agnostic AI browser automation
 * Depends on playwright (not @playwright/test)
 */

export { WebAgent } from './webAgent';
// Backwards compatibility alias
export { WebAgent as Agent } from './webAgent';
export type { LoginOptions } from './webAgent';
export { createAgentContext, type AgentContextOptions } from './agentContextFactory';
export type {
  WebAgentContext,
  StepExecutionResult as StepResult,
  StepTrackingConfig,
  ActionEntity,
  EvaluationResult,
  ActionResult,
  AgentStepEvent,
  AgentStepResult,
} from './types';
