/**
 * Agent types - re-exports shared types and defines agent-specific types
 */

import type { ActionEntity } from '../actions/types';
import { ActionGenerationDebugInfo } from 'shiplight-types';

// Re-export shared types from core
export type {
  AIActionDetail,
  ConsoleLogEntry,
  DOMSnapshot,
  DownloadStatus,
  PageState,
  ActionInfo,
  StateEntry,
  ActionEntry,
  RedirectEntry,
  StepTransition,      // Legacy alias for ActionEntry
  RedirectTransition,  // Legacy alias for RedirectEntry
  StateTransition,
  StateTransitionsOutput,
  StepExecutionResult,
  StepTrackingConfig,
  TestContextData,
  TokenUsage,
  WebAgentContext,
} from '../core/types';

// Re-export ActionEntity for convenience
export type { ActionEntity };

/**
 * Event types from webagent streaming endpoint
 */
export enum AgentStepEventTypes {
  Started = 'started',
  Action = 'action',
  Completion = 'completion',
  Error = 'error',
  Aborted = 'aborted',
  Keepalive = 'keepalive',
}

/**
 * Event structure from webagent streaming
 */
export interface AgentStepEvent {
  type: AgentStepEventTypes;
  data?: any;
}

/**
 * Agent state information
 */
export interface AgentState {
  feedback: string;
  message: string;
  next_goal: string;
  testContext?: Record<string, any>;
}

/**
 * Agent action with state information
 */
export interface AgentAction {
  agent_state: AgentState;
  action_entity: ActionEntity;
  debugInfo?: ActionGenerationDebugInfo;
}

/**
 * Evaluation result from webagent
 */
export interface EvaluationResult {
  status: 'success' | 'error';
  conclusion: 'true' | 'false' | 'unknown';
  explanation: string;
  model?: string;
  id?: string;
  other_opinions?: Array<{
    conclusion: 'true' | 'false' | 'unknown';
    explanation: string;
    model?: string;
  }>;
  artifacts?: Record<string, string>;
}

/**
 * Action result from webagent
 */
export interface ActionResult {
  status: 'success' | 'failure';
  action?: ActionEntity;
  explanation: string;
  artifacts?: Record<string, any>;
}

/**
 * Final result from agent.step()
 */
export interface AgentStepResult {
  success: boolean;
  details?: string;
  actions?: ActionEntity[];
  debugInfo?: ActionGenerationDebugInfo;
  /** Whether the LLM assessed that the instruction was fully completed */
  completesInstruction?: boolean;
}

/**
 * Thrown by agent.run() when the task could not be completed (success=false).
 * Distinct from a real exception so callers (e.g. interactive sessions) can
 * handle graceful task failure separately from unexpected errors.
 */
export class AgentTaskFailedError extends Error {
  readonly details: string;
  constructor(details: string) {
    super(details);
    this.name = 'AgentTaskFailedError';
    this.details = details;
  }
}
