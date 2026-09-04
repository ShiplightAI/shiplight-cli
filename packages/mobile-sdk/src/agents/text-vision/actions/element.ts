/**
 * Element Actions
 *
 * Actions that interact with UI elements (require a locator).
 */

import { z } from 'zod';
import type { Browser } from 'webdriverio';
import type { IAction, MobileActionEntity, ActionResult } from './types';
import { findElement, transpileLocator } from './types';
import type { MobileAgentServices } from '../mobileAgentServices';

// =============================================================================
// Tap Action
// =============================================================================

export class TapAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator } = actionEntity;

    if (!locator) {
      return { success: false, error: 'Locator is required for tap action' };
    }

    try {
      const element = await findElement(driver, locator);
      await element.click();
      return { success: true, message: `Tapped on ${locator}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator } = actionEntity;
    if (!locator) {
      return [`// tap: missing locator`];
    }
    return [`await ${transpileLocator(locator)}.click();`];
  }
}

export const TapToolSchema = z.object({
  locator: z.string().describe('Element locator (e.g., "text=Login", "resource-id=com.app:id/button")'),
});

// =============================================================================
// Double Tap Action
// =============================================================================

export class DoubleTapAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator } = actionEntity;

    if (!locator) {
      return { success: false, error: 'Locator is required for double_tap action' };
    }

    try {
      const element = await findElement(driver, locator);
      await element.doubleClick();
      return { success: true, message: `Double tapped on ${locator}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator } = actionEntity;
    if (!locator) {
      return [`// double_tap: missing locator`];
    }
    return [`await ${transpileLocator(locator)}.doubleClick();`];
  }
}

export const DoubleTapToolSchema = z.object({
  locator: z.string().describe('Element locator to double tap'),
});

// =============================================================================
// Long Press Action
// =============================================================================

export class LongPressAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator, action_data } = actionEntity;
    const duration = action_data?.kwargs?.duration_ms ?? 1000;

    if (!locator) {
      return { success: false, error: 'Locator is required for long_press action' };
    }

    try {
      const element = await findElement(driver, locator);

      await driver
        .action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ origin: element })
        .down()
        .pause(duration)
        .up()
        .perform();

      return { success: true, message: `Long pressed on ${locator} for ${duration}ms` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator, action_data } = actionEntity;
    const duration = action_data?.kwargs?.duration_ms ?? 1000;
    if (!locator) {
      return [`// long_press: missing locator`];
    }
    const elemVar = 'element';
    return [
      `const ${elemVar} = ${transpileLocator(locator)};`,
      `await driver.action('pointer', { parameters: { pointerType: 'touch' } })`,
      `  .move({ origin: ${elemVar} })`,
      `  .down()`,
      `  .pause(${duration})`,
      `  .up()`,
      `  .perform();`,
    ];
  }
}

export const LongPressToolSchema = z.object({
  locator: z.string().describe('Element locator to long press'),
  duration_ms: z.number().optional().describe('Press duration in milliseconds (default: 1000)'),
});

// =============================================================================
// Input Text Action
// =============================================================================

export class InputTextAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator, action_data } = actionEntity;
    const text = action_data?.kwargs?.text ?? '';

    if (!locator) {
      return { success: false, error: 'Locator is required for input_text action' };
    }

    try {
      const element = await findElement(driver, locator);

      // Substitute variables in text
      const finalText = agentServices.replaceVariables(text);

      await element.setValue(finalText);
      return { success: true, message: `Typed "${finalText}" into ${locator}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator, action_data } = actionEntity;
    const text = action_data?.kwargs?.text ?? '';
    if (!locator) {
      return [`// input_text: missing locator`];
    }
    return [`await ${transpileLocator(locator)}.setValue(${JSON.stringify(text)});`];
  }
}

export const InputTextToolSchema = z.object({
  locator: z.string().describe('Element locator for input field'),
  text: z.string().describe('Text to type into the input field'),
});

// =============================================================================
// Clear Input Action
// =============================================================================

export class ClearInputAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator } = actionEntity;

    if (!locator) {
      return { success: false, error: 'Locator is required for clear_input action' };
    }

    try {
      const element = await findElement(driver, locator);
      await element.clearValue();
      return { success: true, message: `Cleared ${locator}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator } = actionEntity;
    if (!locator) {
      return [`// clear_input: missing locator`];
    }
    return [`await ${transpileLocator(locator)}.clearValue();`];
  }
}

export const ClearInputToolSchema = z.object({
  locator: z.string().describe('Element locator for input field to clear'),
});
