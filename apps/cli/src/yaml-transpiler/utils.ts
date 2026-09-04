/**
 * Shared utility functions for transpilation
 *
 * String-generation helpers plus shared action classification.
 */

import { canActionSelfHeal, type ActionEntity } from 'shiplight-types';

export const ACTION_TIMEOUT = 5000;

/**
 * Escape special characters in strings for code generation
 */
export function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Sanitize a string for use in single-line comments
 * Replaces newlines with spaces to prevent code injection
 */
export function sanitizeForComment(str: string): string {
  return str
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .trim();
}

/**
 * Get frame expression for transpilation
 */
function getFrameExpression(actionEntity: ActionEntity): string {
  const framePath = actionEntity.frame_path;
  if (!framePath || framePath.length === 0) {
    return 'page';
  }
  return `page.frameLocator('${framePath[0]}')`;
}

/**
 * Get selector string from action entity (prioritizes xpath)
 */
function getSelectorForAction(actionEntity: ActionEntity): string | null {
  const xpath = actionEntity.xpath;
  if (typeof xpath === 'string' && xpath.trim()) {
    if (!xpath.startsWith('xpath=') && !xpath.startsWith('/') && !xpath.startsWith('//')) {
      return `xpath=//${xpath}`;
    }
    return xpath.startsWith('xpath=') ? xpath : `xpath=${xpath}`;
  }
  return null;
}

/**
 * Get Playwright locator expression for transpilation
 * Returns a string like: page.getByRole('link', { name: 'Issues' }).first()
 */
export function getPageLocatorExpression(actionEntity: ActionEntity): string | null {
  const frameExpression = getFrameExpression(actionEntity);

  // Priority 1: Use locator field if present
  let locator = actionEntity.locator;
  if (typeof locator === 'string' && locator.trim()) {
    locator = locator.trim();
    if (locator.endsWith('first()')) {
      return `${frameExpression}.${locator}`;
    } else {
      return `${frameExpression}.${locator}.first()`;
    }
  }

  // Priority 2: Fall back to selector (xpath)
  const selector = getSelectorForAction(actionEntity);
  if (selector) {
    const escapedSelector = JSON.stringify(selector);
    return `${frameExpression}.locator(${escapedSelector}).first()`;
  }

  return null;
}

/**
 * AI action types that handle their own AI logic (no agent.step() wrapper needed)
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
 * Check if an action is an AI-powered action
 */
export function isAiAction(actionEntity: ActionEntity): boolean {
  const actionName = actionEntity.action_data?.action_name;
  if (!actionName) return false;

  // verify with kwargs.code is JS mode - treat as non-AI action
  if (
    (actionName === 'verify' || actionName === 'ai_assert' || actionName === 'assert') &&
    actionEntity.action_data?.kwargs?.code
  ) {
    return false;
  }

  return (AI_ACTION_TYPES as readonly string[]).includes(actionName);
}

/**
 * Check if an action can self-heal
 */
export function canSelfHeal(actionEntity: ActionEntity): boolean {
  return canActionSelfHeal(actionEntity);
}
