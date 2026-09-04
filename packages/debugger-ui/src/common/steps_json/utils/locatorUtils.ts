import type { Action } from 'shiplight-types';
import type { ActionEntity } from 'shiplight-types';

/**
 * Actions that never use locators even if elementData is present
 */
export const NON_LOCATOR_ACTIONS = [
  'ai_assert',
  'verify',
  'ai_action',
  'ai_extract',
  'ai_step',
  'ai_wait_until',
  'js_code',
  'function',
  'scroll', // page-level scroll, not element scroll
  'wait',
  'sleep',
  'save_variable'
] as const;

/**
 * Type for non-locator action names
 */
export type NonLocatorAction = typeof NON_LOCATOR_ACTIONS[number];

/**
 * Checks if an action type uses locators
 * @param actionName The name of the action
 * @returns True if the action uses locators, false otherwise
 */
export function isLocatorBasedAction(actionName: string | undefined | null): boolean {
  if (!actionName) {
    return false;
  }
  return !NON_LOCATOR_ACTIONS.includes(actionName as NonLocatorAction);
}

/**
 * Applies the statement's locator override to an action entity if present.
 * This ensures user-picked locators take precedence over generated ones.
 *
 * @param actionEntity The original action entity
 * @param statement The action statement that may contain a locator override
 * @param options Configuration options
 * @returns The action entity with locator potentially overridden
 */
export function applyLocatorOverride(
  actionEntity: ActionEntity,
  statement: Action,
  options?: {
    /** Whether to log the override operation */
    logging?: boolean;
    /** Custom log prefix for debugging */
    logPrefix?: string;
  }
): ActionEntity {
  const { logging = false, logPrefix = '' } = options || {};

  // Check if statement has a valid locator override
  if (statement.locator && typeof statement.locator === 'string' && statement.locator.trim()) {
    if (logging) {
      const prefix = logPrefix ? `[${logPrefix}] ` : '';
      console.log(`${prefix}🔄 Overriding locator for statement ${statement.uid}:`);
      console.log(`${prefix}  Original locator: ${actionEntity.locator || '(none)'}`);
      console.log(`${prefix}  New locator: ${statement.locator}`);
    }

    // Return a new action entity with the overridden locator
    return {
      ...actionEntity,
      locator: statement.locator
    };
  }

  // No override needed, return original
  if (logging) {
    const prefix = logPrefix ? `[${logPrefix}] ` : '';
    console.log(`${prefix}✅ Using original locator for statement ${statement.uid}: ${actionEntity.locator || '(none)'}`);
  }

  return actionEntity;
}

/**
 * Checks if a statement has a valid locator override
 *
 * @param statement The action statement to check
 * @returns True if the statement has a valid locator override
 */
export function hasLocatorOverride(statement: Action): boolean {
  return !!(statement.locator &&
           typeof statement.locator === 'string' &&
           statement.locator.trim());
}

/**
 * Applies statement overrides (locator and description) to an action entity.
 * This is a convenience function that combines locator override and description setting.
 *
 * @param actionEntity The original action entity
 * @param statement The action statement containing potential overrides
 * @param options Configuration options for locator override logging
 * @returns The action entity with overrides applied
 */
export function applyStatementOverrides(
  actionEntity: ActionEntity,
  statement: Action,
  options?: {
    /** Whether to log the override operation */
    logging?: boolean;
    /** Custom log prefix for debugging */
    logPrefix?: string;
  }
): ActionEntity {
  // Apply locator override if present
  const entityWithLocator = applyLocatorOverride(actionEntity, statement, options);
  
  // Always create a new object if description needs updating
  if (statement.description && statement.description !== entityWithLocator.action_description) {
    return {
      ...entityWithLocator,
      action_description: statement.description
    };
  }
  
  return entityWithLocator;
}