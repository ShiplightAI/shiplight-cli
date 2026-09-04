/**
 * iOS Device Implementation
 * Approach follows Midscene.js; the implementation here is our own.
 * Uses WebDriverAgent (WDA) for device control
 */

import { z } from 'zod';
import { Device, type DeviceAction, type Point, type Size } from '../common/types';
import { sleep, createBase64Image } from '../common/utils';
import { WDAClient } from './wdaClient';

// Shared instruction for desc parameter
const DESC_INSTRUCTION = 'IMPORTANT: You must provide a desc (description) in imperative form describing WHAT you\'re doing, not HOW.';

export interface IOSDeviceOptions {
  deviceId?: string;
  wdaHost?: string;
  wdaPort?: number;
}

export class IOSDevice extends Device {
  interfaceType: 'ios' = 'ios';
  id: string;

  private wdaClient: WDAClient;
  private options?: IOSDeviceOptions;
  private cachedSize: Size | null = null;

  constructor(options?: IOSDeviceOptions) {
    super();
    this.id = options?.deviceId || 'auto';
    this.options = options;

    this.wdaClient = new WDAClient({
      host: options?.wdaHost || 'localhost',
      port: options?.wdaPort || 8100,
      deviceId: options?.deviceId,
    });
  }

  async connect(): Promise<void> {
    await this.wdaClient.createSession();
  }

  async destroy(): Promise<void> {
    await this.wdaClient.deleteSession();
  }

  async screenshotBase64(): Promise<string> {
    try {
      const base64Data = await this.wdaClient.takeScreenshot();
      return createBase64Image(Buffer.from(base64Data, 'base64'), 'png');
    } catch (error: any) {
      throw new Error(`Failed to take screenshot: ${error.message}`);
    }
  }

  async size(): Promise<Size> {
    if (this.cachedSize) {
      return this.cachedSize;
    }

    try {
      const windowSize = await this.wdaClient.getWindowSize();
      this.cachedSize = {
        width: windowSize.width,
        height: windowSize.height,
        dpr: windowSize.scale,
      };
      return this.cachedSize;
    } catch (error: any) {
      throw new Error(`Failed to get device size: ${error.message}`);
    }
  }

  async tap(x: number, y: number): Promise<void> {
    await this.wdaClient.tap(x, y);
    await sleep(100); // Wait for UI to respond
  }

  async doubleTap(x: number, y: number): Promise<void> {
    // Double-tap: two taps with 100ms delay between them
    await this.wdaClient.tap(x, y);
    await sleep(100);
    await this.wdaClient.tap(x, y);
    await sleep(200); // Wait for selection to complete
  }

  async typeText(text: string): Promise<void> {
    if (!text) return;

    await sleep(200); // Wait for keyboard to be ready
    await this.wdaClient.typeText(text);
    await sleep(300); // Wait for text to appear
  }

  async swipe(direction: 'up' | 'down' | 'left' | 'right'): Promise<void> {
    const size = await this.size();

    const centerX = size.width / 2;
    const centerY = size.height / 2;
    const distance = size.height * 0.3; // Swipe 30% of screen height

    let fromX = centerX;
    let fromY = centerY;
    let toX = centerX;
    let toY = centerY;

    switch (direction) {
      case 'up':
        fromY = centerY + distance;
        toY = centerY - distance;
        break;
      case 'down':
        fromY = centerY - distance;
        toY = centerY + distance;
        break;
      case 'left':
        fromX = centerX + distance;
        toX = centerX - distance;
        break;
      case 'right':
        fromX = centerX - distance;
        toX = centerX + distance;
        break;
    }

    await this.wdaClient.swipe(fromX, fromY, toX, toY, 300);
    await sleep(300); // Wait for swipe animation
  }

  async swipePoints(from: Point, to: Point, duration: number = 500): Promise<void> {
    await this.wdaClient.swipe(from.x, from.y, to.x, to.y, duration);
    await sleep(duration);
  }

  /**
   * Precise scroll from one point to another (like drag-and-drop).
   * Uses slower duration than swipe for page-like scrolling feel.
   */
  async scroll(from: Point, to: Point): Promise<void> {
    // Use longer duration (500ms) for smoother, page-like scrolling
    await this.wdaClient.swipe(from.x, from.y, to.x, to.y, 500);
    await sleep(500);
  }

  async longPress(x: number, y: number, duration: number = 1000): Promise<void> {
    await this.wdaClient.longPress(x, y, duration);
    await sleep(duration + 100);
  }

  async home(): Promise<void> {
    await this.wdaClient.pressHomeButton();
    await sleep(200);
  }

  actionSpace(): DeviceAction[] {
    return [
      {
        name: 'tap',
        description: `Tap at coordinates. ${DESC_INSTRUCTION}`,
        paramSchema: z.object({
          desc: z.string().describe('Goal-oriented description (e.g., "Open settings", "Tap search button")'),
          x: z.number().describe('X coordinate'),
          y: z.number().describe('Y coordinate'),
        }),
        call: async (param) => {
          await this.tap(param.x, param.y);
        },
      },
      {
        name: 'double_tap',
        description: `Double-tap at coordinates to select text. ${DESC_INSTRUCTION}`,
        paramSchema: z.object({
          desc: z.string().describe('Goal-oriented description (e.g., "Double-tap to select all text in input field")'),
          x: z.number().describe('X coordinate'),
          y: z.number().describe('Y coordinate'),
        }),
        call: async (param) => {
          await this.doubleTap(param.x, param.y);
        },
      },
      {
        name: 'input',
        description: `Type text. ${DESC_INSTRUCTION}`,
        paramSchema: z.object({
          desc: z.string().describe('Goal-oriented description (e.g., "Input username", "Enter search query")'),
          text: z.string().describe('Text to input'),
        }),
        call: async (param) => {
          await this.typeText(param.text);
        },
      },
      {
        name: 'swipe',
        description: `Swipe gesture on the screen. Use this for scrolling or navigating between screens. ${DESC_INSTRUCTION}`,
        paramSchema: z.object({
          desc: z.string().describe('Goal-oriented description (e.g., "Swipe up to scroll down", "Swipe left to next screen")'),
          direction: z.enum(['up', 'down', 'left', 'right']).describe('Swipe direction: up/down/left/right'),
        }),
        call: async (param) => {
          await this.swipe(param.direction);
        },
      },
      {
        name: 'long_press',
        description: `Long press at coordinates. ${DESC_INSTRUCTION}`,
        paramSchema: z.object({
          desc: z.string().describe('Goal-oriented description (e.g., "Open context menu", "Select item")'),
          x: z.number(),
          y: z.number(),
          duration: z.number().optional().describe('Press duration in ms (default: 1000)'),
        }),
        call: async (param) => {
          await this.longPress(param.x, param.y, param.duration);
        },
      },
      {
        name: 'home',
        description: `Press the home button. ${DESC_INSTRUCTION}`,
        paramSchema: z.object({
          desc: z.string().describe('Goal-oriented description (e.g., "Go to home screen", "Exit app")'),
        }),
        call: async () => {
          await this.home();
        },
      },
    ];
  }

  describe(): string {
    return `iOS Device: ${this.id}`;
  }
}
