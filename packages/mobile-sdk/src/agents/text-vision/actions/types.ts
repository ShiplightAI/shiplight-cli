/**
 * Mobile Action Types v2
 *
 * Aligned with web-sdk action patterns.
 */

import type { Browser, ChainablePromiseElement } from 'webdriverio';
import type { MobileAgentServices } from '../mobileAgentServices';

// =============================================================================
// Action Entity (matches web-sdk pattern)
// =============================================================================

/**
 * Action data containing action name and parameters
 */
export interface ActionDataEntity {
  action_name: string;
  kwargs: Record<string, any>;
}

/**
 * Mobile action entity - represents an action to be executed
 * Aligned with web-sdk's ActionEntity
 */
export interface MobileActionEntity {
  /** Locator string (e.g., "resource-id=com.app:id/login", "text=Login") */
  locator?: string;

  /** Action data containing action name and parameters */
  action_data: ActionDataEntity;

  /** Human-readable description of the action */
  action_description: string;
}

/**
 * Result of action execution
 */
export interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
  value?: any;
  duration?: number;
}

/**
 * Base interface for all mobile actions
 * Aligned with web-sdk's IAction pattern
 *
 * Uses MobileAgentServices class to avoid circular dependencies with AI-powered agent methods
 */
export interface IAction {
  /**
   * Execute the action
   * @param driver - WebDriverIO Browser instance (like page in web-sdk)
   * @param actionEntity - Action configuration
   * @param agentServices - Agent services for utility methods (variables, evaluate, etc.)
   */
  execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    agentServices: MobileAgentServices,
  ): Promise<ActionResult>;

  /**
   * Transpile action to WebDriverIO/Appium code
   * @param actionEntity - Action configuration
   * @param stepId - Optional step identifier
   * @returns Array of code lines
   */
  transpile(actionEntity: MobileActionEntity, stepId?: string): string[];
}

// =============================================================================
// Locator Types
// =============================================================================

export type LocatorType = 'resource-id' | 'text' | 'content-desc' | 'xpath' | 'class';

export interface ParsedLocator {
  type: LocatorType;
  value: string;
}

/**
 * Parse a locator string
 * @example "resource-id=com.app:id/button" -> { type: "resource-id", value: "com.app:id/button" }
 */
export function parseLocator(locator: string): ParsedLocator | null {
  const patterns: { prefix: string; type: LocatorType }[] = [
    { prefix: 'resource-id=', type: 'resource-id' },
    { prefix: 'text=', type: 'text' },
    { prefix: 'content-desc=', type: 'content-desc' },
    { prefix: 'xpath=', type: 'xpath' },
    { prefix: 'class=', type: 'class' },
  ];

  for (const { prefix, type } of patterns) {
    if (locator.startsWith(prefix)) {
      return { type, value: locator.slice(prefix.length) };
    }
  }

  return null;
}

/**
 * Convert a parsed locator to UIAutomator2 format
 */
export function toUiAutomator(parsed: ParsedLocator): string {
  switch (parsed.type) {
    case 'resource-id':
      return `new UiSelector().resourceId("${parsed.value}")`;
    case 'text':
      return `new UiSelector().text("${parsed.value}")`;
    case 'content-desc':
      return `new UiSelector().description("${parsed.value}")`;
    case 'class':
      return `new UiSelector().className("${parsed.value}")`;
    case 'xpath':
      return parsed.value; // XPath is used directly
  }
}

/**
 * Find element by locator
 */
export function findElement(driver: Browser, locator: string): ChainablePromiseElement {
  const parsed = parseLocator(locator);
  if (!parsed) {
    throw new Error(
      `Invalid locator format: "${locator}". ` +
      `Valid formats: resource-id=..., text=..., content-desc=..., class=..., xpath=...`
    );
  }

  if (parsed.type === 'xpath') {
    return driver.$(parsed.value);
  }

  const uiSelector = toUiAutomator(parsed);
  return driver.$(`android=${uiSelector}`);
}

/**
 * Transpile a locator to WebDriverIO code
 * @example "resource-id=com.app:id/btn" -> "driver.$('android=new UiSelector().resourceId(\"com.app:id/btn\")')"
 */
export function transpileLocator(locator: string): string {
  const parsed = parseLocator(locator);
  if (!parsed) {
    return `driver.$('${locator}')`; // fallback
  }

  if (parsed.type === 'xpath') {
    return `driver.$(\`${parsed.value}\`)`;
  }

  const uiSelector = toUiAutomator(parsed);
  return `driver.$('android=${uiSelector}')`;
}

// =============================================================================
// Action Names
// =============================================================================

export type MobileActionName =
  // Element actions
  | 'tap'
  | 'double_tap'
  | 'long_press'
  | 'input_text'
  | 'clear_input'
  // Query actions
  | 'get_text'
  | 'get_attribute'
  | 'is_displayed'
  | 'is_enabled'
  | 'is_checked'
  | 'exists'
  // Gesture actions
  | 'swipe'
  | 'swipe_coordinates'
  | 'scroll_to_element'
  | 'drag_and_drop'
  | 'pinch'
  | 'zoom'
  // System actions
  | 'back'
  | 'home'
  | 'enter'
  | 'press_key'
  | 'open_notifications'
  | 'close_notifications'
  // App actions
  | 'open_app'
  | 'close_app'
  | 'install_app'
  | 'uninstall_app'
  | 'is_app_installed'
  // Device actions
  | 'set_clipboard'
  | 'get_clipboard'
  | 'toggle_wifi'
  | 'toggle_airplane_mode'
  | 'set_orientation'
  | 'get_orientation'
  // Screen actions
  | 'screenshot'
  | 'get_page_source'
  | 'get_screen_size'
  | 'tap_coordinates'
  // Agent actions
  | 'wait'
  | 'wait_for_element'
  | 'wait_for_element_gone'
  | 'assert'
  | 'done'
  | 'store_value'
  | 'ai_assert';

/**
 * Check if an action requires a locator
 */
export function requiresLocator(actionName: MobileActionName): boolean {
  const locatorActions: MobileActionName[] = [
    'tap',
    'double_tap',
    'long_press',
    'input_text',
    'clear_input',
    'get_text',
    'get_attribute',
    'is_displayed',
    'is_enabled',
    'is_checked',
    'exists',
    'scroll_to_element',
    'drag_and_drop',
    'wait_for_element',
    'wait_for_element_gone',
    'assert',
  ];
  return locatorActions.includes(actionName);
}
