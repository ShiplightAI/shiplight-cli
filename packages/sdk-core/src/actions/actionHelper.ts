/**
 * ActionHelper - Utility functions for action classification and statement extraction
 *
 * Provides explicit methods for determining action types and extracting
 * AI statements from action entities.
 */

import { ActionEntity } from './types';
import { canActionSelfHeal } from 'shiplight-types';

/**
 * AI action types that use natural language statements.
 * These actions handle their own AI logic and don't need agent.step() wrapper.
 */
const AI_ACTION_TYPES = [
  'ai_action',
  'ai_step',
  'ai_assert',
  'ai_extract',
  'ai_wait_until',
  'verify',
  'assert',
] as const;

/**
 * ActionHelper class for action classification and statement extraction
 */
export class ActionHelper {
  /**
   * Check if an action is an AI-powered action
   * AI actions handle their own logic and don't need agent.step() wrapper
   */
  static isAiAction(actionEntity: ActionEntity): boolean {
    const actionName = actionEntity.action_data?.action_name;
    if (!actionName) return false;

    // verify with kwargs.code is JS mode - treat as non-AI action (needs agent.step wrapper)
    if ((actionName === 'verify' || actionName === 'ai_assert' || actionName === 'assert') &&
        actionEntity.action_data?.kwargs?.code) {
      return false;
    }

    return AI_ACTION_TYPES.includes(actionName as any);
  }

  /**
   * Get the AI statement from an action entity
   * Returns null if the action is not an AI action or has no statement
   *
   * Different AI actions store statements in different fields:
   * - ai_action, ai_step: kwargs.statement
   * - verify, ai_assert: kwargs.statement or action_description
   * - ai_extract: constructed from element_description + variable_name
   * - ai_wait_until: kwargs.condition
   */
  static getAiStatement(actionEntity: ActionEntity): string | null {
    const actionName = actionEntity.action_data?.action_name;
    if (!actionName) return null;

    const kwargs = actionEntity.action_data?.kwargs || {};

    switch (actionName) {
      case 'ai_action':
      case 'ai_step':
        return kwargs.statement || null;

      case 'verify':
      case 'ai_assert':
      case 'assert':
        // Try kwargs.statement first, then fall back to action_description
        return kwargs.statement || actionEntity.action_description || null;

      case 'ai_extract':
        // ai_extract uses element_description and variable_name
        const elementDesc = kwargs.element_description;
        const varName = kwargs.variable_name;
        if (elementDesc && varName) {
          return `Extract ${elementDesc} and save to ${varName}`;
        }
        return null;

      case 'ai_wait_until':
        // ai_wait_until uses condition
        return kwargs.condition || null;

      default:
        return null;
    }
  }

  /**
   * Check if an action can self-heal (recover from locator failures)
   * Some actions like js_code, function, wait don't have locators to heal
   */
  static canSelfHeal(actionEntity: ActionEntity): boolean {
    return canActionSelfHeal(actionEntity);
  }
}
