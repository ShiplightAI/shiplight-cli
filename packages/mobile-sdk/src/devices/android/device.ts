/**
 * Android Device Implementation
 * Approach follows Midscene.js; the implementation here is our own.
 */

import { ADB } from 'appium-adb';
import { z } from 'zod';
import { Device, type DeviceAction, type Point, type Size } from '../common/types';
import {
  sleep,
  createBase64Image,
  isValidPNGBuffer,
  CoordinateAdjuster,
  generateId,
} from '../common/utils';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Shared instruction for desc parameter
const DESC_INSTRUCTION = 'IMPORTANT: You must provide a desc (description) in imperative form describing WHAT you\'re doing, not HOW.';

export interface AndroidDeviceOptions {
  adbPath?: string;
  remoteAdbHost?: string;
  remoteAdbPort?: number;
  screenshotResizeScale?: number;
  displayId?: number;
  suppressAdbLogs?: boolean; // Suppress ADB debug logging (default: false)
}

export class AndroidDevice extends Device {
  interfaceType: 'android' = 'android';
  id: string;

  private adb: ADB | null = null;
  private devicePixelRatio = 1;
  private scalingRatio = 1;
  private coordinateAdjuster: CoordinateAdjuster;
  private options?: AndroidDeviceOptions;
  private yadbPushed = false;
  private cachedScreenSize: { width: number; height: number } | null = null;

  constructor(deviceId: string, options?: AndroidDeviceOptions) {
    super();
    this.id = deviceId;
    this.options = options;
    this.coordinateAdjuster = new CoordinateAdjuster(1);

    // Note: suppressAdbLogs option is deprecated - set process.env.DEBUG = '' at the top of your entry file instead
    // The debug package reads this environment variable when modules are first loaded
  }

  /**
   * Suppress ADB debug logs globally
   *
   * DEPRECATED: This method doesn't work reliably because the debug package
   * reads process.env.DEBUG when modules are first loaded.
   *
   * Instead, set the environment variable at the very top of your entry file:
   *
   * Example:
   *   // At the very top of your main.ts file, before ANY imports:
   *   if (!process.env.DEBUG) {
   *     process.env.DEBUG = '';
   *   } else if (process.env.DEBUG === '*') {
   *     process.env.DEBUG = '*,-ADB';
   *   }
   *
   *   // Now import modules
   *   import { AndroidDevice } from 'the internal mobile-device package';
   */
  static suppressAdbLogs(): void {
    console.warn('[AndroidDevice] suppressAdbLogs() is deprecated. Set process.env.DEBUG at the top of your entry file instead.');
  }

  async connect(): Promise<void> {
    await this.getAdb();
    await this.initializeDevicePixelRatio();
  }

  async destroy(): Promise<void> {
    this.adb = null;
  }

  async screenshotBase64(): Promise<string> {
    const adb = await this.getAdb();
    let screenshotBuffer: Buffer;

    try {
      // Primary method: ADB's native screenshot
      screenshotBuffer = await adb.takeScreenshot(null);

      if (!screenshotBuffer || !isValidPNGBuffer(screenshotBuffer)) {
        throw new Error('Invalid screenshot buffer');
      }
    } catch (error) {
      // Fallback: shell screencap command
      const androidPath = `/data/local/tmp/screenshot_${generateId()}.png`;
      const localPath = path.join(os.tmpdir(), `screenshot_${generateId()}.png`);

      try {
        const displayArg = this.options?.displayId ? `-d ${this.options.displayId}` : '';
        await adb.shell(`screencap -p ${displayArg} ${androidPath}`.trim());
        await adb.pull(androidPath, localPath);
        screenshotBuffer = await fs.promises.readFile(localPath);

        // Cleanup
        await adb.shell(`rm ${androidPath}`);
        await fs.promises.unlink(localPath).catch(() => {});
      } catch (fallbackError) {
        throw new Error(`Screenshot failed: ${error}; Fallback also failed: ${fallbackError}`);
      }
    }

    return createBase64Image(screenshotBuffer, 'png');
  }

  async size(): Promise<Size> {
    await this.initializeDevicePixelRatio();
    const screenSize = await this.getScreenSize();

    const scale = this.options?.screenshotResizeScale ?? 1 / this.devicePixelRatio;
    this.scalingRatio = scale;
    this.coordinateAdjuster.setScalingRatio(scale);

    return {
      width: Math.round(screenSize.width * scale),
      height: Math.round(screenSize.height * scale),
      dpr: this.devicePixelRatio,
    };
  }

  async tap(x: number, y: number): Promise<void> {
    const adb = await this.getAdb();
    const adjusted = this.coordinateAdjuster.adjust(x, y);

    // Use swipe with same start/end point for tap (more reliable than input tap)
    await adb.shell(
      `input swipe ${adjusted.x} ${adjusted.y} ${adjusted.x} ${adjusted.y} 150`
    );
    await sleep(100); // Wait for UI to respond
  }

  async doubleTap(x: number, y: number): Promise<void> {
    const adb = await this.getAdb();
    const adjusted = this.coordinateAdjuster.adjust(x, y);

    // Double-tap: two taps with 100ms delay between them
    // This works reliably when the field is already focused
    await adb.shell(
      `input tap ${adjusted.x} ${adjusted.y} && sleep 0.1 && input tap ${adjusted.x} ${adjusted.y}`
    );
    await sleep(200); // Wait for selection to complete
  }

  async typeText(text: string): Promise<void> {
    const adb = await this.getAdb();

    // Check if text contains CJK characters
    const hasCJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);

    if (hasCJK) {
      // Use YADB for CJK text input
      await this.ensureYadb();
      await adb.shell(
        `app_process -Djava.class.path=/data/local/tmp/yadb /data/local/tmp com.ysbing.yadb.Main -keyboard "${text}"`
      );
    } else {
      // Use native ADB input for ASCII text
      await adb.inputText(text);
    }

    await sleep(200); // Wait for text to be entered
  }

  async swipe(direction: 'up' | 'down' | 'left' | 'right'): Promise<void> {
    const adb = await this.getAdb();
    // Use native screen size instead of scaled size for swipe calculations
    const screenSize = await this.getScreenSize();

    const centerX = screenSize.width / 2;
    const centerY = screenSize.height / 2;
    const distance = screenSize.height * 0.3; // Swipe 30% of screen height (stay within safe bounds)

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

    // Coordinates are already in native space, no need to adjust
    await adb.shell(`input swipe ${Math.round(fromX)} ${Math.round(fromY)} ${Math.round(toX)} ${Math.round(toY)} 300`);
    await sleep(300); // Wait for swipe animation
  }

  async swipePoints(from: Point, to: Point, duration: number = 300): Promise<void> {
    const adb = await this.getAdb();
    const adjustedFrom = this.coordinateAdjuster.adjust(from.x, from.y);
    const adjustedTo = this.coordinateAdjuster.adjust(to.x, to.y);

    await adb.shell(
      `input swipe ${adjustedFrom.x} ${adjustedFrom.y} ${adjustedTo.x} ${adjustedTo.y} ${duration}`
    );
    await sleep(duration);
  }

  /**
   * Precise scroll from one point to another (like drag-and-drop).
   * Uses slower duration than swipe for page-like scrolling feel.
   */
  async scroll(from: Point, to: Point): Promise<void> {
    const adb = await this.getAdb();
    const adjustedFrom = this.coordinateAdjuster.adjust(from.x, from.y);
    const adjustedTo = this.coordinateAdjuster.adjust(to.x, to.y);

    // Use longer duration (500ms) for smoother, page-like scrolling
    await adb.shell(
      `input swipe ${adjustedFrom.x} ${adjustedFrom.y} ${adjustedTo.x} ${adjustedTo.y} 500`
    );
    await sleep(500);
  }

  async longPress(x: number, y: number, duration: number = 1000): Promise<void> {
    const adb = await this.getAdb();
    const adjusted = this.coordinateAdjuster.adjust(x, y);

    // Long press is a swipe with same start/end but longer duration
    await adb.shell(
      `input swipe ${adjusted.x} ${adjusted.y} ${adjusted.x} ${adjusted.y} ${duration}`
    );
    await sleep(duration + 100);
  }

  async back(): Promise<void> {
    const adb = await this.getAdb();
    await adb.shell('input keyevent 4'); // KEYCODE_BACK
    await sleep(200);
  }

  async home(): Promise<void> {
    const adb = await this.getAdb();
    await adb.shell('input keyevent 3'); // KEYCODE_HOME
    await sleep(200);
  }

  async pressKeyCode(keyCode: number): Promise<void> {
    const adb = await this.getAdb();
    await adb.shell(`input keyevent ${keyCode}`);
    await sleep(200);
  }

  /**
   * Get the UI hierarchy XML from the device using uiautomator dump.
   * This returns the accessibility tree which can be parsed to find interactive elements.
   *
   * @param maxRetries - Number of retry attempts if device is not idle (default: 3)
   * @returns XML string containing the UI hierarchy
   * @throws Error if unable to dump hierarchy after retries
   */
  async getUiHierarchy(maxRetries: number = 3): Promise<string> {
    const adb = await this.getAdb();
    const dumpPath = '/data/local/tmp/ui_dump.xml';

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Dump UI hierarchy to file on device
        const dumpResult = await adb.shell(`uiautomator dump ${dumpPath}`);

        // Check if dump was successful (note: "hierchary" is the actual typo in Android)
        if (dumpResult.includes('UI hierchary dumped') || dumpResult.includes('UI hierarchy dumped')) {
          // Read the XML file
          const xml = await adb.shell(`cat ${dumpPath}`);

          // Clean up the temp file
          await adb.shell(`rm ${dumpPath}`).catch(() => {});

          // Return XML starting from the <?xml declaration
          const xmlStart = xml.indexOf('<?xml');
          if (xmlStart === -1) {
            throw new Error('Invalid XML response - no <?xml declaration found');
          }

          return xml.substring(xmlStart);
        } else if (dumpResult.includes('could not get idle state')) {
          // Device UI is not idle (animations running, etc.)
          lastError = new Error('Device UI not idle - animations may be running');
          if (attempt < maxRetries) {
            await sleep(1000); // Wait before retry
            continue;
          }
        } else {
          throw new Error(`Unexpected uiautomator dump result: ${dumpResult}`);
        }
      } catch (error: any) {
        lastError = error;
        if (attempt < maxRetries) {
          await sleep(500); // Brief wait before retry
        }
      }
    }

    throw lastError || new Error(`Failed to dump UI hierarchy after ${maxRetries} attempts`);
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
        name: 'back',
        description: `Press the back button. ${DESC_INSTRUCTION}`,
        paramSchema: z.object({
          desc: z.string().describe('Goal-oriented description (e.g., "Go back", "Return to previous screen")'),
        }),
        call: async () => {
          await this.back();
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
      {
        name: 'press_key',
        description: `Press a system key using Android keycode. Use this for system-level actions that are hard to replicate with gestures. ${DESC_INSTRUCTION}

Available keycodes:
- 3: KEYCODE_HOME - Go to home screen
- 4: KEYCODE_BACK - Go back (prefer using 'back' action instead)
- 82: KEYCODE_MENU - Open menu
- 83: KEYCODE_NOTIFICATION - Open notifications panel
- 187: KEYCODE_APP_SWITCH - Open recent apps/task switcher
- 24: KEYCODE_VOLUME_UP - Volume up
- 25: KEYCODE_VOLUME_DOWN - Volume down
- 26: KEYCODE_POWER - Power button (use with caution)
- 84: KEYCODE_SEARCH - Open search
- 85: KEYCODE_MEDIA_PLAY_PAUSE - Play/pause media
- 126: KEYCODE_MEDIA_PLAY - Play media
- 127: KEYCODE_MEDIA_PAUSE - Pause media`,
        paramSchema: z.object({
          desc: z.string().describe('Goal-oriented description (e.g., "Open recent apps", "Open notifications", "Open quick settings")'),
          keyCode: z.number().describe('Android keycode number (e.g., 187 for app switcher, 83 for notifications)'),
        }),
        call: async (param) => {
          await this.pressKeyCode(param.keyCode);
        },
      },
    ];
  }

  // Private helper methods

  private async getAdb(): Promise<ADB> {
    if (this.adb) {
      return this.adb;
    }

    this.adb = await new ADB({
      udid: this.id,
      adbExecTimeout: 60000,
      executable: this.options?.adbPath
        ? { path: this.options.adbPath, defaultArgs: [] }
        : undefined,
      remoteAdbHost: this.options?.remoteAdbHost,
      remoteAdbPort: this.options?.remoteAdbPort,
    });

    return this.adb;
  }

  private async initializeDevicePixelRatio(): Promise<void> {
    const adb = await this.getAdb();

    try {
      const dpiOutput = await adb.shell('wm density');
      const match = dpiOutput.match(/Physical density: (\d+)/);
      if (match) {
        const dpi = parseInt(match[1], 10);
        this.devicePixelRatio = dpi / 160; // Android baseline is 160 DPI
      }
    } catch (error) {
      console.warn('Failed to get device DPI, using default 1.0:', error);
      this.devicePixelRatio = 1;
    }
  }

  private async getScreenSize(): Promise<{ width: number; height: number }> {
    if (this.cachedScreenSize) {
      return this.cachedScreenSize;
    }

    const adb = await this.getAdb();

    try {
      const sizeOutput = await adb.shell('wm size');
      const match = sizeOutput.match(/Physical size: (\d+)x(\d+)/);
      if (match) {
        this.cachedScreenSize = {
          width: parseInt(match[1], 10),
          height: parseInt(match[2], 10),
        };
        return this.cachedScreenSize;
      }
    } catch (error) {
      throw new Error(`Failed to get screen size: ${error}`);
    }

    throw new Error('Could not parse screen size from wm size output');
  }

  private async ensureYadb(): Promise<void> {
    if (this.yadbPushed) {
      return;
    }

    const adb = await this.getAdb();

    try {
      // Check if yadb already exists
      const lsOutput = await adb.shell('ls /data/local/tmp/yadb');
      if (lsOutput.includes('yadb')) {
        this.yadbPushed = true;
        return;
      }
    } catch {
      // yadb doesn't exist, need to push it
    }

    // In production, you would push the yadb binary here
    // For now, we'll just mark it as pushed since we handle CJK differently
    // if needed in our simplified version
    console.warn('YADB not found on device. CJK input may not work correctly.');
    this.yadbPushed = true;
  }

  describe(): string {
    return `Android Device: ${this.id}`;
  }
}
