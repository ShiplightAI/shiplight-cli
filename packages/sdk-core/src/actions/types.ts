/**
 * Action types and interfaces for the action system
 */

import { Page } from 'playwright';
import type { AgentServices } from '../agent/agentServices';
import type { ActionGenerationDebugInfo } from 'shiplight-types';

/**
 * ActionEntity structure from webagent service
 */
export interface ActionDataEntity {
  action_name: string;
  kwargs: { [key: string]: any };
}

export interface ActionEntityLocatorInfo {
  locator?: string;
  xpath?: string;
  frame_path?: string[];
}

export interface ActionEntity extends ActionEntityLocatorInfo {
  action_data?: ActionDataEntity;
  action_description: string;
  feedback?: string;
}

/**
 * AgentStepResult - result from AI step execution
 */
export interface AgentStepResult {
  success: boolean;
  details?: string;
  actions?: ActionEntity[];
  debugInfo?: ActionGenerationDebugInfo;
}

/**
 * Agent interface with AI-powered methods
 * AI methods can create circular dependencies (e.g., agent.run → runTask → actions → agent.run)
 */
export interface IAgent {
  // AI-powered methods (can trigger recursive task execution)
  assert: (page: Page, statement: string, stepId?: string) => Promise<boolean>;
  evaluate: (page: Page, statement: string, stepId?: string) => Promise<boolean>;
  execute: (page: Page, statement: string, stepId?: string, usePureVision?: boolean) => Promise<AgentStepResult>;
  generate: (page: Page, statement: string, stepId?: string, usePureVision?: boolean) => Promise<AgentStepResult>;
  run: (page: Page, statement: string, stepId?: string) => Promise<AgentStepResult>;
  extract: (page: Page, elementDescription: string, variableName: string, stepId?: string) => Promise<void>;
}

/**
 * Base interface for all actions
 * Uses AgentServices class to avoid circular dependencies with AI-powered agent methods
 */
export interface IAction {
  /**
   * Execute the action directly on the page
   * @param page - Playwright page instance
   * @param actionEntity - Action configuration
   * @param agentServices - Agent services for utility methods (locators, variables, etc.)
   */
  execute(
    page: Page,
    actionEntity: ActionEntity,
    agentServices: AgentServices,
  ): Promise<void>;

  /**
   * Transpile to minimal code that calls agent.execAction().
   * Each action implements this to include only the fields its execute() needs.
   *
   * @param actionEntity - Action configuration
   * @param stepId - Optional step identifier (needed for AI actions)
   *
   * @example
   * ```typescript
   * // For click action:
   * await agent.execAction("click", page, {
   *   locator: "getByRole('button', { name: 'Code' })",
   * });
   * ```
   */
  transpile(actionEntity: ActionEntity, stepId?: string): string[];
}
