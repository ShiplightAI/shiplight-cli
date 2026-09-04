/**
 * Gesture Actions
 *
 * Swipe, scroll, pinch, zoom, and drag gestures.
 */

import { z } from 'zod';
import type { Browser } from 'webdriverio';
import type { IAction, MobileActionEntity, ActionResult } from './types';
import { findElement, transpileLocator } from './types';
import type { MobileAgentServices } from '../mobileAgentServices';

// =============================================================================
// Swipe Action
// =============================================================================

export class SwipeAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const direction = action_data?.kwargs?.direction;
    const distancePercent = action_data?.kwargs?.distance_percent ?? 50;

    if (!direction) {
      return { success: false, error: 'Direction is required for swipe action' };
    }

    try {
      const { width, height } = await driver.getWindowSize();

      let startX: number, startY: number, endX: number, endY: number;

      const centerX = width / 2;
      const centerY = height / 2;
      const distanceX = (width * distancePercent) / 100;
      const distanceY = (height * distancePercent) / 100;

      switch (direction) {
        case 'up':
          startX = centerX;
          startY = centerY + distanceY / 2;
          endX = centerX;
          endY = centerY - distanceY / 2;
          break;
        case 'down':
          startX = centerX;
          startY = centerY - distanceY / 2;
          endX = centerX;
          endY = centerY + distanceY / 2;
          break;
        case 'left':
          startX = centerX + distanceX / 2;
          startY = centerY;
          endX = centerX - distanceX / 2;
          endY = centerY;
          break;
        case 'right':
          startX = centerX - distanceX / 2;
          startY = centerY;
          endX = centerX + distanceX / 2;
          endY = centerY;
          break;
        default:
          return { success: false, error: `Invalid swipe direction: ${direction}` };
      }

      await driver
        .action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: Math.round(startX), y: Math.round(startY) })
        .down()
        .pause(100)
        .move({ x: Math.round(endX), y: Math.round(endY), duration: 300 })
        .up()
        .perform();

      return { success: true, message: `Swiped ${direction}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const direction = actionEntity.action_data?.kwargs?.direction;
    const distancePercent = actionEntity.action_data?.kwargs?.distance_percent ?? 50;
    if (!direction) {
      return [`// swipe: missing direction`];
    }
    return [
      `// Swipe ${direction} (${distancePercent}%)`,
      `const { width, height } = await driver.getWindowSize();`,
      `const centerX = width / 2, centerY = height / 2;`,
      `const distance = (${direction === 'up' || direction === 'down' ? 'height' : 'width'} * ${distancePercent}) / 100;`,
      `await driver.action('pointer', { parameters: { pointerType: 'touch' } })`,
      `  .move({ x: centerX${direction === 'left' ? ' + distance / 2' : direction === 'right' ? ' - distance / 2' : ''}, y: centerY${direction === 'up' ? ' + distance / 2' : direction === 'down' ? ' - distance / 2' : ''} })`,
      `  .down().pause(100)`,
      `  .move({ x: centerX${direction === 'left' ? ' - distance / 2' : direction === 'right' ? ' + distance / 2' : ''}, y: centerY${direction === 'up' ? ' - distance / 2' : direction === 'down' ? ' + distance / 2' : ''}, duration: 300 })`,
      `  .up().perform();`,
    ];
  }
}

export const SwipeToolSchema = z.object({
  direction: z.enum(['up', 'down', 'left', 'right']).describe('Swipe direction'),
  distance_percent: z.number().optional().describe('Swipe distance as percentage of screen (default: 50)'),
});

// =============================================================================
// Swipe Coordinates Action
// =============================================================================

export class SwipeCoordinatesAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const { from_x, from_y, to_x, to_y } = action_data?.kwargs ?? {};

    if (from_x === undefined || from_y === undefined || to_x === undefined || to_y === undefined) {
      return { success: false, error: 'All coordinates (from_x, from_y, to_x, to_y) are required' };
    }

    try {
      await driver
        .action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: from_x, y: from_y })
        .down()
        .pause(100)
        .move({ x: to_x, y: to_y, duration: 300 })
        .up()
        .perform();

      return { success: true, message: `Swiped from (${from_x},${from_y}) to (${to_x},${to_y})` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { from_x, from_y, to_x, to_y } = actionEntity.action_data?.kwargs ?? {};
    return [
      `await driver.action('pointer', { parameters: { pointerType: 'touch' } })`,
      `  .move({ x: ${from_x}, y: ${from_y} })`,
      `  .down().pause(100)`,
      `  .move({ x: ${to_x}, y: ${to_y}, duration: 300 })`,
      `  .up().perform();`,
    ];
  }
}

export const SwipeCoordinatesToolSchema = z.object({
  from_x: z.number().describe('Starting X coordinate'),
  from_y: z.number().describe('Starting Y coordinate'),
  to_x: z.number().describe('Ending X coordinate'),
  to_y: z.number().describe('Ending Y coordinate'),
});

// =============================================================================
// Scroll To Element Action
// =============================================================================

export class ScrollToElementAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator, action_data } = actionEntity;
    const direction = action_data?.kwargs?.direction ?? 'down';
    const maxScrolls = action_data?.kwargs?.max_scrolls ?? 10;

    if (!locator) {
      return { success: false, error: 'Locator is required for scroll_to_element action' };
    }

    try {
      for (let i = 0; i < maxScrolls; i++) {
        // Check if element exists and is displayed
        try {
          const element = await findElement(driver, locator);
          const displayed = await element.isDisplayed();
          if (displayed) {
            return { success: true, message: `Found ${locator} after ${i} scrolls` };
          }
        } catch {
          // Element not found, continue scrolling
        }

        // Perform scroll (swipe in opposite direction)
        const swipeAction = new SwipeAction();
        await swipeAction.execute(
          driver,
          {
            action_data: { action_name: 'swipe', kwargs: { direction, distance_percent: 30 } },
            action_description: `Scroll ${direction}`,
          },
          agentServices,
        );

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      return { success: false, error: `Element ${locator} not found after ${maxScrolls} scrolls` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator, action_data } = actionEntity;
    const direction = action_data?.kwargs?.direction ?? 'down';
    const maxScrolls = action_data?.kwargs?.max_scrolls ?? 10;
    if (!locator) {
      return [`// scroll_to_element: missing locator`];
    }
    return [
      `// Scroll to find element (max ${maxScrolls} scrolls)`,
      `await ${transpileLocator(locator)}.scrollIntoView({ direction: '${direction}', maxScrolls: ${maxScrolls} });`,
    ];
  }
}

export const ScrollToElementToolSchema = z.object({
  locator: z.string().describe('Element locator to scroll to'),
  direction: z.enum(['up', 'down']).optional().describe('Scroll direction (default: down)'),
  max_scrolls: z.number().optional().describe('Maximum scroll attempts (default: 10)'),
});

// =============================================================================
// Drag and Drop Action
// =============================================================================

export class DragAndDropAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const { from_locator, to_locator } = action_data?.kwargs ?? {};

    if (!from_locator || !to_locator) {
      return { success: false, error: 'Both from_locator and to_locator are required' };
    }

    try {
      const fromElement = await findElement(driver, from_locator);
      const toElement = await findElement(driver, to_locator);

      const fromLocation = await fromElement.getLocation();
      const toLocation = await toElement.getLocation();

      await driver
        .action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: fromLocation.x, y: fromLocation.y })
        .down()
        .pause(500)
        .move({ x: toLocation.x, y: toLocation.y, duration: 500 })
        .up()
        .perform();

      return { success: true, message: `Dragged from ${from_locator} to ${to_locator}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { from_locator, to_locator } = actionEntity.action_data?.kwargs ?? {};
    if (!from_locator || !to_locator) {
      return [`// drag_and_drop: missing locators`];
    }
    return [
      `const fromElem = ${transpileLocator(from_locator)};`,
      `const toElem = ${transpileLocator(to_locator)};`,
      `await fromElem.dragAndDrop(toElem);`,
    ];
  }
}

export const DragAndDropToolSchema = z.object({
  from_locator: z.string().describe('Source element locator'),
  to_locator: z.string().describe('Target element locator'),
});

// =============================================================================
// Pinch Action
// =============================================================================

export class PinchAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const scale = action_data?.kwargs?.scale ?? 0.5;

    try {
      const { width, height } = await driver.getWindowSize();
      const centerX = Math.round(width / 2);
      const centerY = Math.round(height / 2);
      const distance = Math.round(Math.min(width, height) * 0.3 * scale);

      const finger1 = driver
        .action('pointer', { id: 'finger1', parameters: { pointerType: 'touch' } })
        .move({ x: centerX - distance, y: centerY })
        .down()
        .move({ x: centerX - Math.round(distance / 2), y: centerY, duration: 300 })
        .up();

      const finger2 = driver
        .action('pointer', { id: 'finger2', parameters: { pointerType: 'touch' } })
        .move({ x: centerX + distance, y: centerY })
        .down()
        .move({ x: centerX + Math.round(distance / 2), y: centerY, duration: 300 })
        .up();

      await driver.actions([finger1, finger2]);

      return { success: true, message: `Pinched with scale ${scale}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const scale = actionEntity.action_data?.kwargs?.scale ?? 0.5;
    return [`// Pinch gesture with scale ${scale} (requires multi-touch)`];
  }
}

export const PinchToolSchema = z.object({
  scale: z.number().optional().describe('Pinch scale factor (default: 0.5)'),
});

// =============================================================================
// Zoom Action
// =============================================================================

export class ZoomAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const scale = action_data?.kwargs?.scale ?? 2;

    try {
      const { width, height } = await driver.getWindowSize();
      const centerX = Math.round(width / 2);
      const centerY = Math.round(height / 2);
      const distance = Math.round(Math.min(width, height) * 0.15);

      const finger1 = driver
        .action('pointer', { id: 'finger1', parameters: { pointerType: 'touch' } })
        .move({ x: centerX - distance, y: centerY })
        .down()
        .move({ x: centerX - Math.round(distance * scale), y: centerY, duration: 300 })
        .up();

      const finger2 = driver
        .action('pointer', { id: 'finger2', parameters: { pointerType: 'touch' } })
        .move({ x: centerX + distance, y: centerY })
        .down()
        .move({ x: centerX + Math.round(distance * scale), y: centerY, duration: 300 })
        .up();

      await driver.actions([finger1, finger2]);

      return { success: true, message: `Zoomed with scale ${scale}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const scale = actionEntity.action_data?.kwargs?.scale ?? 2;
    return [`// Zoom gesture with scale ${scale} (requires multi-touch)`];
  }
}

export const ZoomToolSchema = z.object({
  scale: z.number().optional().describe('Zoom scale factor (default: 2)'),
});

// =============================================================================
// Scroll Action (Precise coordinate-based scrolling)
// =============================================================================

export class ScrollAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const { from_x, from_y, to_x, to_y } = action_data?.kwargs ?? {};

    if (from_x === undefined || from_y === undefined || to_x === undefined || to_y === undefined) {
      return { success: false, error: 'All coordinates (from_x, from_y, to_x, to_y) are required' };
    }

    try {
      // Use longer duration (500ms) for smoother, page-like scrolling
      await driver
        .action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: from_x, y: from_y })
        .down()
        .pause(100)
        .move({ x: to_x, y: to_y, duration: 500 })
        .up()
        .perform();

      return { success: true, message: `Scrolled from (${from_x},${from_y}) to (${to_x},${to_y})` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { from_x, from_y, to_x, to_y } = actionEntity.action_data?.kwargs ?? {};
    return [
      `// Scroll (precise, page-like)`,
      `await driver.action('pointer', { parameters: { pointerType: 'touch' } })`,
      `  .move({ x: ${from_x}, y: ${from_y} })`,
      `  .down().pause(100)`,
      `  .move({ x: ${to_x}, y: ${to_y}, duration: 500 })`,
      `  .up().perform();`,
    ];
  }
}

export const ScrollToolSchema = z.object({
  from_x: z.number().describe('Starting X coordinate'),
  from_y: z.number().describe('Starting Y coordinate'),
  to_x: z.number().describe('Ending X coordinate'),
  to_y: z.number().describe('Ending Y coordinate'),
});
