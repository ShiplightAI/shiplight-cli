/**
 * Device Actions
 *
 * Clipboard, connectivity, and orientation controls.
 */

import { z } from 'zod';
import type { Browser } from 'webdriverio';
import type { IAction, MobileActionEntity, ActionResult } from './types';
import type { MobileAgentServices } from '../mobileAgentServices';

// =============================================================================
// Set Clipboard Action
// =============================================================================

export class SetClipboardAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const text = action_data?.kwargs?.text;

    if (!text) {
      return { success: false, error: 'Text is required for set_clipboard action' };
    }

    try {
      const base64Text = Buffer.from(text).toString('base64');
      await driver.setClipboard(base64Text, 'plaintext');
      return { success: true, message: `Set clipboard to "${text}"` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const text = actionEntity.action_data?.kwargs?.text;
    if (!text) return [`// set_clipboard: missing text`];
    return [`await driver.setClipboard(Buffer.from(${JSON.stringify(text)}).toString('base64'), 'plaintext');`];
  }
}

export const SetClipboardToolSchema = z.object({
  text: z.string().describe('Text to copy to clipboard'),
});

// =============================================================================
// Get Clipboard Action
// =============================================================================

export class GetClipboardAction implements IAction {
  async execute(
    driver: Browser,
    _actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    try {
      const base64Text = await driver.getClipboard('plaintext');
      const text = Buffer.from(base64Text, 'base64').toString('utf8');
      return { success: true, value: text, message: `Clipboard: "${text}"` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(): string[] {
    return [
      `const base64Clipboard = await driver.getClipboard('plaintext');`,
      `const clipboard = Buffer.from(base64Clipboard, 'base64').toString('utf8');`,
    ];
  }
}

export const GetClipboardToolSchema = z.object({});

// =============================================================================
// Toggle WiFi Action
// =============================================================================

export class ToggleWifiAction implements IAction {
  async execute(
    driver: Browser,
    _actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    try {
      await driver.toggleWiFi();
      return { success: true, message: 'Toggled WiFi' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(): string[] {
    return [`await driver.toggleWiFi();`];
  }
}

export const ToggleWifiToolSchema = z.object({});

// =============================================================================
// Toggle Airplane Mode Action
// =============================================================================

export class ToggleAirplaneModeAction implements IAction {
  async execute(
    driver: Browser,
    _actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    try {
      await driver.toggleAirplaneMode();
      return { success: true, message: 'Toggled airplane mode' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(): string[] {
    return [`await driver.toggleAirplaneMode();`];
  }
}

export const ToggleAirplaneModeToolSchema = z.object({});

// =============================================================================
// Set Orientation Action
// =============================================================================

export class SetOrientationAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const orientation = action_data?.kwargs?.orientation;

    if (!orientation) {
      return { success: false, error: 'Orientation is required for set_orientation action' };
    }

    try {
      await driver.setOrientation(orientation.toUpperCase() as 'PORTRAIT' | 'LANDSCAPE');
      return { success: true, message: `Set orientation to ${orientation}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const orientation = actionEntity.action_data?.kwargs?.orientation;
    if (!orientation) return [`// set_orientation: missing orientation`];
    return [`await driver.setOrientation('${orientation.toUpperCase()}');`];
  }
}

export const SetOrientationToolSchema = z.object({
  orientation: z.enum(['portrait', 'landscape']).describe('Device orientation'),
});

// =============================================================================
// Get Orientation Action
// =============================================================================

export class GetOrientationAction implements IAction {
  async execute(
    driver: Browser,
    _actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    try {
      const orientation = await driver.getOrientation();
      return {
        success: true,
        value: orientation.toLowerCase(),
        message: `Orientation: ${orientation}`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(): string[] {
    return [`const orientation = await driver.getOrientation();`];
  }
}

export const GetOrientationToolSchema = z.object({});
