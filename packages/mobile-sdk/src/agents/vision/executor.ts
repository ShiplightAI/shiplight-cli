/**
 * Vision Executor - Executes AI-generated actions on mobile devices via ADB
 *
 * This executor handles coordinate-based actions for the VisionAgent.
 * It wraps the Device interface and provides action execution with element context support.
 *
 * For selector-based execution (TextVisionAgent), use the executor in text-vision module.
 */

import type { Device } from '../../devices/common/types';
import type { GeneratedAction, ActionResult } from './types';
import { MobileActionType } from './types';
import type { MobileElement } from '../../elements/types';
import { getElementCenter } from '../../elements/types';

export class VisionExecutor {
  private elementContext: MobileElement[] | null = null;

  constructor(private device: Device) {}

  /**
   * Set element context for element-based actions (tap_element, etc.)
   * This should be called after extracting elements from the screen.
   */
  setElementContext(elements: MobileElement[]): void {
    this.elementContext = elements;
  }

  /**
   * Clear the element context
   */
  clearElementContext(): void {
    this.elementContext = null;
  }

  /**
   * Get current element context
   */
  getElementContext(): MobileElement[] | null {
    return this.elementContext;
  }

  /**
   * Execute multiple actions sequentially
   * Returns the combined result - success only if all actions succeed
   */
  async executeMultiple(actions: GeneratedAction[]): Promise<ActionResult> {
    const startTime = Date.now();
    const results: ActionResult[] = [];

    console.log(`[VisionExecutor] Executing ${actions.length} actions sequentially...`);

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      console.log(`[VisionExecutor] [${i + 1}/${actions.length}] Executing ${action.type}`);

      const result = await this.execute(action);
      results.push(result);

      if (!result.success) {
        // Stop execution if any action fails
        console.error(`[VisionExecutor] Action ${i + 1} failed, stopping execution`);
        return {
          success: false,
          message: `Action ${i + 1} (${action.type}) failed: ${result.message}`,
          duration: Date.now() - startTime,
        };
      }
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[VisionExecutor] All ${actions.length} actions completed successfully in ${totalDuration}ms`);

    return {
      success: true,
      message: `Successfully executed ${actions.length} action(s)`,
      duration: totalDuration,
    };
  }

  /**
   * Execute a generated action on the device
   */
  async execute(action: GeneratedAction): Promise<ActionResult> {
    const startTime = Date.now();

    try {
      console.log(`[VisionExecutor] Executing ${action.type}:`, action.parameters);

      switch (action.type) {
        case MobileActionType.TAP:
          await this.executeTap(action.parameters as { x: number; y: number });
          break;

        case MobileActionType.TAP_ELEMENT:
          await this.executeTapElement(action.parameters as { element_index: number });
          break;

        case MobileActionType.DOUBLE_TAP:
          await this.executeDoubleTap(action.parameters as { x: number; y: number });
          break;

        case MobileActionType.INPUT:
          await this.executeInput(action.parameters as { text: string });
          break;

        case MobileActionType.SWIPE:
          await this.executeSwipe(action.parameters as { direction: 'up' | 'down' | 'left' | 'right'; distance?: number });
          break;

        case MobileActionType.SCROLL:
          await this.executeScroll(action.parameters as { from: { x: number; y: number }; to: { x: number; y: number } });
          break;

        case MobileActionType.SWIPE_POINTS:
          await this.executeSwipePoints(action.parameters as { from: { x: number; y: number }; to: { x: number; y: number }; duration?: number });
          break;

        case MobileActionType.LONG_PRESS:
          await this.executeLongPress(action.parameters as { x: number; y: number; duration?: number });
          break;

        case MobileActionType.BACK:
          await this.device.back();
          break;

        case MobileActionType.HOME:
          await this.device.home();
          break;

        // Agent-level actions (not device actions)
        case MobileActionType.WAIT:
          await this.executeWait(action.parameters as { seconds: number });
          break;

        case MobileActionType.GENERATE_VERIFICATION:
          await this.executeGenerateVerification(action.parameters as { condition: string });
          break;

        case MobileActionType.SCREENSHOT:
          await this.executeScreenshot();
          break;

        case MobileActionType.DONE:
          // Done action signals task completion - no action needed
          console.log(`[VisionExecutor] Task complete: ${action.parameters.text}`);
          console.log(`[VisionExecutor] Success: ${action.parameters.success}`);
          break;

        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }

      const duration = Date.now() - startTime;
      console.log(`[VisionExecutor] Action completed in ${duration}ms`);

      // Wait a bit for UI to update
      await this.sleep(500);

      // Special message for generate_verification to indicate it was recorded
      let message = `Successfully executed ${action.type}`;
      if (action.type === MobileActionType.GENERATE_VERIFICATION) {
        message = 'Successfully generated verification statement';
      }

      return {
        success: true,
        message,
        duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`[VisionExecutor] Action failed:`, error.message);

      return {
        success: false,
        message: `Failed to execute ${action.type}: ${error.message}`,
        duration,
      };
    }
  }

  private async executeTap(params: { x: number; y: number }): Promise<void> {
    if (typeof params.x !== 'number' || typeof params.y !== 'number') {
      throw new Error(`Invalid tap parameters: ${JSON.stringify(params)}`);
    }

    await this.device.tap(params.x, params.y);
  }

  /**
   * Execute tap on element by index.
   * Requires element context to be set via setElementContext().
   */
  private async executeTapElement(params: { element_index: number }): Promise<void> {
    const { element_index } = params;

    if (typeof element_index !== 'number') {
      throw new Error(`Invalid tap_element parameters: element_index must be a number, got ${JSON.stringify(params)}`);
    }

    if (!this.elementContext) {
      throw new Error('Cannot execute tap_element: element context not set. Call setElementContext() first.');
    }

    const element = this.elementContext.find(e => e.index === element_index);
    if (!element) {
      throw new Error(`Element with index ${element_index} not found. Available indices: ${this.elementContext.map(e => e.index).join(', ')}`);
    }

    const center = getElementCenter(element.bounds);
    const label = element.text || element.contentDesc || element.resourceId || '(no label)';

    console.log(`[VisionExecutor] Resolved element [${element_index}] "${label}" to (${center.x}, ${center.y})`);

    await this.device.tap(center.x, center.y);
  }

  private async executeDoubleTap(params: { x: number; y: number }): Promise<void> {
    if (typeof params.x !== 'number' || typeof params.y !== 'number') {
      throw new Error(`Invalid double_tap parameters: ${JSON.stringify(params)}`);
    }

    await this.device.doubleTap(params.x, params.y);
  }

  private async executeInput(params: { text: string }): Promise<void> {
    if (!params.text || typeof params.text !== 'string') {
      throw new Error(`Invalid input parameters: ${JSON.stringify(params)}`);
    }

    await this.device.typeText(params.text);
  }

  private async executeSwipe(params: { direction: 'up' | 'down' | 'left' | 'right'; distance?: number }): Promise<void> {
    const validDirections = ['up', 'down', 'left', 'right'];
    if (!validDirections.includes(params.direction)) {
      throw new Error(`Invalid swipe direction: ${params.direction}`);
    }

    // Note: distance parameter can be used for future enhancements
    // Currently device.swipe() handles standard swipe gestures
    await this.device.swipe(params.direction);
  }

  private async executeScroll(params: { from: { x: number; y: number }; to: { x: number; y: number } }): Promise<void> {
    if (typeof params.from?.x !== 'number' || typeof params.from?.y !== 'number') {
      throw new Error(`Invalid scroll from coordinates: ${JSON.stringify(params.from)}`);
    }
    if (typeof params.to?.x !== 'number' || typeof params.to?.y !== 'number') {
      throw new Error(`Invalid scroll to coordinates: ${JSON.stringify(params.to)}`);
    }

    // Scroll uses precise coordinates with slower duration for page-like scrolling
    await this.device.scroll(params.from, params.to);
  }

  private async executeSwipePoints(params: { from: { x: number; y: number }; to: { x: number; y: number }; duration?: number }): Promise<void> {
    if (typeof params.from?.x !== 'number' || typeof params.from?.y !== 'number') {
      throw new Error(`Invalid swipe_points from coordinates: ${JSON.stringify(params.from)}`);
    }
    if (typeof params.to?.x !== 'number' || typeof params.to?.y !== 'number') {
      throw new Error(`Invalid swipe_points to coordinates: ${JSON.stringify(params.to)}`);
    }

    await this.device.swipePoints(params.from, params.to, params.duration || 300);
  }

  private async executeLongPress(params: { x: number; y: number; duration?: number }): Promise<void> {
    if (typeof params.x !== 'number' || typeof params.y !== 'number') {
      throw new Error(`Invalid long_press parameters: ${JSON.stringify(params)}`);
    }

    await this.device.longPress(params.x, params.y, params.duration);
  }

  // Agent-level action executors

  private async executeWait(params: { seconds: number }): Promise<void> {
    if (typeof params.seconds !== 'number' || params.seconds < 0) {
      throw new Error(`Invalid wait parameters: ${JSON.stringify(params)}`);
    }

    const maxWait = 30;
    const seconds = Math.min(params.seconds, maxWait);

    console.log(`[VisionExecutor] Waiting for ${seconds} seconds...`);
    await this.sleep(seconds * 1000);
  }

  private async executeGenerateVerification(params: { condition: string }): Promise<void> {
    if (!params.condition || typeof params.condition !== 'string') {
      throw new Error(`Invalid generate_verification parameters: ${JSON.stringify(params)}`);
    }

    // This is a no-op at execution time - the verification statement is just recorded in the trajectory
    // and will be converted to a test flow step later
    console.log(`[VisionExecutor] Generated verification statement: "${params.condition}"`);
    console.log('[VisionExecutor] (This will be added to the test flow for later execution)');
  }

  private async executeScreenshot(): Promise<void> {
    console.log('[VisionExecutor] Screenshot requested - handled automatically by agent loop');
    console.log('[VisionExecutor] (Screenshots are taken after every action)');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * @deprecated Use VisionExecutor instead. AdbExecutor is an alias for backward compatibility.
 */
export const AdbExecutor = VisionExecutor;

/**
 * @deprecated Use VisionExecutor instead. ActionExecutor is an alias for backward compatibility.
 */
export const ActionExecutor = VisionExecutor;
