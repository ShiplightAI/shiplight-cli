/**
 * Screen Actions
 *
 * Screenshot, page source, and screen information.
 */

import { z } from 'zod';
import type { Browser } from 'webdriverio';
import type { IAction, MobileActionEntity, ActionResult } from './types';
import type { MobileAgentServices } from '../mobileAgentServices';

// =============================================================================
// Screenshot Action
// =============================================================================

export class ScreenshotAction implements IAction {
  async execute(
    driver: Browser,
    _actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    try {
      const base64Screenshot = await driver.takeScreenshot();
      return {
        success: true,
        value: base64Screenshot,
        message: 'Screenshot captured',
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(): string[] {
    return [`const screenshot = await driver.takeScreenshot();`];
  }
}

export const ScreenshotToolSchema = z.object({});

// =============================================================================
// Get Page Source Action
// =============================================================================

export class GetPageSourceAction implements IAction {
  async execute(
    driver: Browser,
    _actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    try {
      const pageSource = await driver.getPageSource();
      return {
        success: true,
        value: pageSource,
        message: 'Got page source',
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(): string[] {
    return [`const pageSource = await driver.getPageSource();`];
  }
}

export const GetPageSourceToolSchema = z.object({});

// =============================================================================
// Get Screen Size Action
// =============================================================================

export class GetScreenSizeAction implements IAction {
  async execute(
    driver: Browser,
    _actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    try {
      const { width, height } = await driver.getWindowSize();
      return {
        success: true,
        value: { width, height },
        message: `Screen size: ${width}x${height}`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(): string[] {
    return [`const { width, height } = await driver.getWindowSize();`];
  }
}

export const GetScreenSizeToolSchema = z.object({});

// =============================================================================
// Tap Coordinates Action
// =============================================================================

export class TapCoordinatesAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const x = action_data?.kwargs?.x;
    const y = action_data?.kwargs?.y;

    if (x === undefined || y === undefined) {
      return { success: false, error: 'Both x and y coordinates are required' };
    }

    try {
      await driver
        .action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x, y })
        .down()
        .up()
        .perform();

      return { success: true, message: `Tapped at (${x}, ${y})` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const x = actionEntity.action_data?.kwargs?.x;
    const y = actionEntity.action_data?.kwargs?.y;
    if (x === undefined || y === undefined) {
      return [`// tap_coordinates: missing x or y`];
    }
    return [
      `await driver.action('pointer', { parameters: { pointerType: 'touch' } })`,
      `  .move({ x: ${x}, y: ${y} })`,
      `  .down().up().perform();`,
    ];
  }
}

export const TapCoordinatesToolSchema = z.object({
  x: z.number().describe('X coordinate to tap'),
  y: z.number().describe('Y coordinate to tap'),
});
