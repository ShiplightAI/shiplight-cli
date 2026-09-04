/**
 * Query Actions
 *
 * Actions that query element state (require a locator, return values).
 */

import { z } from 'zod';
import type { Browser } from 'webdriverio';
import type { IAction, MobileActionEntity, ActionResult } from './types';
import { findElement, transpileLocator } from './types';
import type { MobileAgentServices } from '../mobileAgentServices';

// =============================================================================
// Get Text Action
// =============================================================================

export class GetTextAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator } = actionEntity;

    if (!locator) {
      return { success: false, error: 'Locator is required for get_text action' };
    }

    try {
      const element = await findElement(driver, locator);
      const text = await element.getText();
      return { success: true, value: text, message: `Got text: "${text}"` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator } = actionEntity;
    if (!locator) return [`// get_text: missing locator`];
    return [`const text = await ${transpileLocator(locator)}.getText();`];
  }
}

export const GetTextToolSchema = z.object({
  locator: z.string().describe('Element locator to get text from'),
});

// =============================================================================
// Get Attribute Action
// =============================================================================

export class GetAttributeAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator, action_data } = actionEntity;
    const attribute = action_data?.kwargs?.attribute;

    if (!locator) {
      return { success: false, error: 'Locator is required for get_attribute action' };
    }

    if (!attribute) {
      return { success: false, error: 'Attribute name is required for get_attribute action' };
    }

    try {
      const element = await findElement(driver, locator);
      const value = await element.getAttribute(attribute);
      return { success: true, value, message: `Got ${attribute}: "${value}"` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator, action_data } = actionEntity;
    const attribute = action_data?.kwargs?.attribute;
    if (!locator || !attribute) return [`// get_attribute: missing locator or attribute`];
    return [`const value = await ${transpileLocator(locator)}.getAttribute(${JSON.stringify(attribute)});`];
  }
}

export const GetAttributeToolSchema = z.object({
  locator: z.string().describe('Element locator'),
  attribute: z.string().describe('Attribute name to get (e.g., "text", "enabled", "checked")'),
});

// =============================================================================
// Is Displayed Action
// =============================================================================

export class IsDisplayedAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator } = actionEntity;

    if (!locator) {
      return { success: false, error: 'Locator is required for is_displayed action' };
    }

    try {
      const element = await findElement(driver, locator);
      const displayed = await element.isDisplayed();
      return { success: true, value: displayed, message: `Element displayed: ${displayed}` };
    } catch (error: any) {
      // Element not found means not displayed
      return { success: true, value: false, message: 'Element not displayed' };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator } = actionEntity;
    if (!locator) return [`// is_displayed: missing locator`];
    return [`const displayed = await ${transpileLocator(locator)}.isDisplayed();`];
  }
}

export const IsDisplayedToolSchema = z.object({
  locator: z.string().describe('Element locator to check visibility'),
});

// =============================================================================
// Is Enabled Action
// =============================================================================

export class IsEnabledAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator } = actionEntity;

    if (!locator) {
      return { success: false, error: 'Locator is required for is_enabled action' };
    }

    try {
      const element = await findElement(driver, locator);
      const enabled = await element.isEnabled();
      return { success: true, value: enabled, message: `Element enabled: ${enabled}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator } = actionEntity;
    if (!locator) return [`// is_enabled: missing locator`];
    return [`const enabled = await ${transpileLocator(locator)}.isEnabled();`];
  }
}

export const IsEnabledToolSchema = z.object({
  locator: z.string().describe('Element locator to check if enabled'),
});

// =============================================================================
// Is Checked Action
// =============================================================================

export class IsCheckedAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator } = actionEntity;

    if (!locator) {
      return { success: false, error: 'Locator is required for is_checked action' };
    }

    try {
      const element = await findElement(driver, locator);
      const checked = await element.getAttribute('checked');
      const isChecked = checked === 'true';
      return { success: true, value: isChecked, message: `Element checked: ${isChecked}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator } = actionEntity;
    if (!locator) return [`// is_checked: missing locator`];
    return [`const checked = await ${transpileLocator(locator)}.getAttribute('checked') === 'true';`];
  }
}

export const IsCheckedToolSchema = z.object({
  locator: z.string().describe('Checkbox/switch locator to check state'),
});

// =============================================================================
// Exists Action
// =============================================================================

export class ExistsAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator } = actionEntity;

    if (!locator) {
      return { success: false, error: 'Locator is required for exists action' };
    }

    try {
      const element = await findElement(driver, locator);
      const exists = await element.isExisting();
      return { success: true, value: exists, message: `Element exists: ${exists}` };
    } catch (error: any) {
      return { success: true, value: false, message: 'Element does not exist' };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator } = actionEntity;
    if (!locator) return [`// exists: missing locator`];
    return [`const exists = await ${transpileLocator(locator)}.isExisting();`];
  }
}

export const ExistsToolSchema = z.object({
  locator: z.string().describe('Element locator to check existence'),
});
