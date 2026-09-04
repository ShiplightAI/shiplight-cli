/**
 * Shared utility functions for actions
 */

import { ElementHandle, Frame, Locator, Page } from 'playwright';
import { ActionEntity } from './types';

export const LOCATOR_TIMEOUT = 5000;
export const ACTION_TIMEOUT = 10000;

/**
 * Get action timeout in milliseconds.
 * Priority: per-statement timeout_ms > organization setting action_timeout_ms > ACTION_TIMEOUT
 */
export function getActionTimeoutMs(agentServices?: { getActionSettings(): Record<string, any> }, statementTimeoutMs?: number): number {
  return statementTimeoutMs
    ?? agentServices?.getActionSettings()?.action_timeout_ms
    ?? ACTION_TIMEOUT;
}
export const GOTO_TIMEOUT = 20000;

/**
 * Sanitize a string for use in single-line comments
 * Replaces newlines with spaces to prevent code injection when
 * multi-line strings are used in step descriptions
 */
export function sanitizeForComment(str: string): string {
  return str
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .trim();
}

/**
 * Get locator for an action entity
 * Priority: locator > xpath
 */
export function getLocator(page: Page, actionEntity: ActionEntity): Locator | null {
  const locatorExpression = getPageLocatorExpression(actionEntity);
  if (!locatorExpression) {
    return null;
  }

  const locatorFn = new Function('page', `return ${locatorExpression}`);
  return locatorFn(page);
}

type FrameContext = Page | Frame;

export async function getFrameContext(
  page: Page,
  framePath: string[] = []
): Promise<FrameContext | null> {
  let context: FrameContext = page;

  for (const selector of framePath) {
    const frameLocator: Locator = context.locator(selector);
    const frameElement: ElementHandle<Element> | null = await frameLocator.elementHandle();
    if (!frameElement) {
      return null;
    }

    const childFrame: Frame | null = await frameElement.contentFrame();
    await frameElement.dispose();

    if (!childFrame) {
      return null;
    }
    context = childFrame;
  }

  return context;
}


/**
 * Create a minimal ActionEntity with only fields needed by getLocator()
 * Used for transpilation to generate clean code without unnecessary metadata
 *
 * Includes:
 * - action_data (required for all actions)
 * - locator fields used by getLocator() with priority: locator > xpath
 * - frame_path (for iframe handling)
 *
 * Excludes: url, action_description, feedback, text, tag, class, and other metadata
 */
export function getMinimalActionEntity(actionEntity: ActionEntity): Partial<ActionEntity> {
  const minimal: Partial<ActionEntity> = {
    action_data: actionEntity.action_data,
  };

  // Include locator fields if present (used by getLocator with priority order)
  if (actionEntity.locator) minimal.locator = actionEntity.locator;
  if (actionEntity.xpath) minimal.xpath = actionEntity.xpath;
  if (actionEntity.frame_path) minimal.frame_path = actionEntity.frame_path;

  return minimal;
}

/**
 * Get the frame expression for transpilation
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
  // Priority 1: XPath
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
 * or: page.locator('#issues-tab').first()
 */
export function getPageLocatorExpression(actionEntity: ActionEntity): string | null {
  const frameExpression = getFrameExpression(actionEntity);

  // Priority 1: Use locator field if present (Playwright locator method)
  let locator = actionEntity.locator;
  if (typeof locator === 'string' && locator.trim()) {
    locator = locator.trim();
    // Avoid multi element locator errors
    if (locator.endsWith('first()')) {
      // If it already has .first(), assume it's a complete expression
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
