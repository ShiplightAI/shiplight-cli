/**
 * System Actions
 *
 * System key actions (back, home, enter, etc).
 */

import { z } from 'zod';
import type { Browser } from 'webdriverio';
import type { IAction, MobileActionEntity, ActionResult } from './types';
import type { MobileAgentServices } from '../mobileAgentServices';

// Android key codes
const KEYCODE_BACK = 4;
const KEYCODE_HOME = 3;
const KEYCODE_ENTER = 66;

// =============================================================================
// Back Action
// =============================================================================

export class BackAction implements IAction {
  async execute(
    driver: Browser,
    _actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    try {
      await driver.pressKeyCode(KEYCODE_BACK);
      return { success: true, message: 'Pressed back button' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(): string[] {
    return [`await driver.pressKeyCode(${KEYCODE_BACK}); // BACK`];
  }
}

export const BackToolSchema = z.object({});

// =============================================================================
// Home Action
// =============================================================================

export class HomeAction implements IAction {
  async execute(
    driver: Browser,
    _actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    try {
      await driver.pressKeyCode(KEYCODE_HOME);
      return { success: true, message: 'Pressed home button' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(): string[] {
    return [`await driver.pressKeyCode(${KEYCODE_HOME}); // HOME`];
  }
}

export const HomeToolSchema = z.object({});

// =============================================================================
// Enter Action
// =============================================================================

export class EnterAction implements IAction {
  async execute(
    driver: Browser,
    _actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    try {
      await driver.pressKeyCode(KEYCODE_ENTER);
      return { success: true, message: 'Pressed enter key' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(): string[] {
    return [`await driver.pressKeyCode(${KEYCODE_ENTER}); // ENTER`];
  }
}

export const EnterToolSchema = z.object({});

// =============================================================================
// Press Key Action
// =============================================================================

export class PressKeyAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const keyCode = action_data?.kwargs?.key_code;

    if (keyCode === undefined) {
      return { success: false, error: 'key_code is required for press_key action' };
    }

    try {
      await driver.pressKeyCode(keyCode);
      return { success: true, message: `Pressed key code ${keyCode}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const keyCode = actionEntity.action_data?.kwargs?.key_code;
    if (keyCode === undefined) {
      return [`// press_key: missing key_code`];
    }
    return [`await driver.pressKeyCode(${keyCode});`];
  }
}

export const PressKeyToolSchema = z.object({
  key_code: z.number().describe(`Android key code. Common codes:
- 3: HOME
- 4: BACK
- 24: VOLUME_UP
- 25: VOLUME_DOWN
- 26: POWER
- 66: ENTER
- 82: MENU
- 187: APP_SWITCH`),
});

// =============================================================================
// Open Notifications Action
// =============================================================================

export class OpenNotificationsAction implements IAction {
  async execute(
    driver: Browser,
    _actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    try {
      await driver.openNotifications();
      return { success: true, message: 'Opened notifications' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(): string[] {
    return [`await driver.openNotifications();`];
  }
}

export const OpenNotificationsToolSchema = z.object({});

// =============================================================================
// Close Notifications Action
// =============================================================================

export class CloseNotificationsAction implements IAction {
  async execute(
    driver: Browser,
    _actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    try {
      await driver.pressKeyCode(KEYCODE_BACK);
      return { success: true, message: 'Closed notifications' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(): string[] {
    return [`await driver.pressKeyCode(${KEYCODE_BACK}); // Close notifications`];
  }
}

export const CloseNotificationsToolSchema = z.object({});
