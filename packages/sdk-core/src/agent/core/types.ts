/**
 * Core types for local web agent implementation
 */

import { Page } from 'playwright';
import { ActionEntity } from '../../actions/types';
import { DomService, DOMState } from '../../dom';
import { ActionGenerationDebugInfo, TokenUsage } from 'shiplight-types';
import type { AgentServices } from '../agentServices';

/**
 * Execution context for task/action execution
 * Uses AgentServices instead of IAgent to break circular dependency
 * (runTask should not call agent.run, which would call runTask again)
 */
export interface TaskExecutionContext {
	page: Page;
	agentServices: AgentServices;
	domService: DomService;
	executionHistory?: Array<[string, string]>; // [[task, feedback], ...]
	variables?: Record<string, any>; // All variables including sensitive ones
	sensitiveKeys?: Set<string>; // Keys in variables that are sensitive (for masking)
	domState?: DOMState; // Pre-captured DOM state for multi-action execution (prevents element index staleness)
}

/**
 * Chat message for conversation history
 */
export interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

/**
 * Unified result type for both single-step and multi-step execution
 *
 * Used by: executeStep(), generateActionStep(), runTask()
 * For single-step execution, actionEntities will be an array with one element
 */
export interface StepResult {
	status: 'success' | 'error';
	completed: boolean; // Was the goal accomplished?
	actionEntities: ActionEntity[]; // All actions (single step = [action])
	explanation?: string; // Human-readable explanation of what happened
	error?: string;
	/** Debug info from the LLM call (includes tokenUsages) */
	debugInfo?: ActionGenerationDebugInfo;
	/** Aggregated token usages from all steps (for multi-step execution) */
	tokenUsages?: TokenUsage[];
}

/**
 * Result from assertion evaluation
 */
export interface AssertionResult {
	success: boolean;
	explanation?: string;
	error?: string;
	/** Debug info from the LLM call (includes tokenUsages) */
	debugInfo?: ActionGenerationDebugInfo;
}

/**
 * Generated action from LLM (internal type)
 *
 * status: 'success' = valid action generated
 * status: 'error' = failed to generate action (parse error, invalid response, etc.)
 */
export interface GeneratedAction {
	status: 'success' | 'error';
	actionEntity?: ActionEntity; // undefined when status is 'error'
	reasoning?: string; // LLM's explanation (always populated when available)
	goalAccomplished?: boolean; // LLM's assessment
	error?: string; // Error message when status is 'error'
	/** Debug info from the LLM call (includes tokenUsages) */
	debugInfo?: ActionGenerationDebugInfo;
}

/**
 * Options for agent behavior
 * Note: Model is obtained from AgentServices.getModel() (via AgentContext), not passed in options
 */
export interface AgentOptions {
	maxSteps?: number; // Max steps for runTask (default: 15)
	temperature?: number; // LLM temperature (default: 0)
	timeout?: number; // Timeout in ms for each step
	executionHistory?: Array<[string, string]>; // For Playwright tests: [[task, feedback], ...] - readonly, not modified by runTask
	chatHistory?: ChatMessage[]; // For copilot: conversation history shown in prompt
	variables?: Record<string, any>; // All variables including sensitive ones
	sensitiveKeys?: Set<string>; // Keys in variables that are sensitive (for masking)
	abortSignal?: AbortSignal; // Signal to abort task execution
	usePureVision?: boolean; // Whether to use pure vision mode (default: false)
	useCleanScreenshotForAssertion?: boolean; // Whether to use clean screenshot for assertion (default: false)
}

/**
 * Event types for streaming updates during runStep
 */
export type AgentEvent =
	| { type: 'step_start'; step: number; maxSteps: number }
	| { type: 'action_generated'; action: ActionEntity; reasoning?: string }
	| { type: 'action_executing'; action: ActionEntity }
	| { type: 'action_completed'; result: StepResult }
	| { type: 'step_completed'; step: number; result: StepResult }
	| { type: 'goal_completed'; totalSteps: number }
	| { type: 'max_steps_reached'; totalSteps: number }
	| { type: 'error'; error: string; step?: number };
