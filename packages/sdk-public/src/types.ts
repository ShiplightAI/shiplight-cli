/**
 * Public types for @shiplightai/sdk
 *
 * Custom action types are imported from sdk-core.
 * This file contains types specific to the public SDK.
 */

// Re-export shared types from sdk-core
export type {
  ActionExecutionContext,
  CustomActionResult,
  ICustomAction,
  // Single source of truth — the agent.login() option shape lives in sdk-core.
  LoginOptions,
} from 'sdk-core';

/**
 * Options for creating an agent.
 */
export interface CreateAgentOptions {
  /** LLM model to use (e.g., 'gemini-2.5-pro', 'gpt-4o') */
  model: string;

  /** Optional model to use for computer-use style operations. Defaults to `model`. */
  computer_use_model?: string;

  /** Initial variables to set in the agent's variable store */
  variables?: Record<string, any>;

  /**
   * Keys to mark as sensitive (values won't be sent to LLM).
   * Use for passwords, API keys, tokens, etc.
   */
  sensitiveKeys?: string[];

  /** Directory for test data files (uploads, fixtures) */
  testDataDir?: string;

  /** Directory for downloads */
  downloadDir?: string;
}

/**
 * Options for the step method.
 */
export interface StepOptions {
  /**
   * Maximum number of AI steps for self-healing when the action fails.
   * - 1: single retry with AI
   * - >1: multi-step recovery with AI
   *
   * Default: 5
   */
  maxSteps?: number;
}

/**
 * Options for the run method.
 */
export interface RunOptions {
  /**
   * Maximum number of steps the agent can take to complete the instruction.
   * - 1: Single action (uses efficient single-step execution)
   * - 2+: Multi-step execution with limit
   * - Default: 15 steps
   */
  maxSteps?: number;
}
