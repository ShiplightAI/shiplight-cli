/**
 * Common types for mobile device automation
 * Approach follows Midscene.js; the definitions here are our own.
 */

import type { z } from 'zod';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
  dpr?: number; // Device pixel ratio
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Device action definition with Zod schema for parameter validation
 */
export interface DeviceAction<TParam = any> {
  name: string;
  description: string;
  paramSchema: z.ZodSchema<TParam>;
  call: (param: TParam) => Promise<void>;
}

/**
 * Result of a device action execution
 */
export interface DeviceActionResult {
  success: boolean;
  error?: string;
}

/**
 * Platform type
 */
export type PlatformType = 'android' | 'ios';

/**
 * Abstract base class for mobile devices
 */
export abstract class Device {
  abstract interfaceType: PlatformType;
  abstract id: string;

  // Core methods
  abstract screenshotBase64(): Promise<string>;
  abstract size(): Promise<Size>;
  abstract actionSpace(): DeviceAction[];

  // Actions
  abstract tap(x: number, y: number): Promise<void>;
  abstract typeText(text: string): Promise<void>;
  abstract swipe(direction: 'up' | 'down' | 'left' | 'right'): Promise<void>;

  /**
   * Precise scroll from one point to another (like drag-and-drop).
   * Uses slower duration than swipe for page-like scrolling feel.
   */
  async scroll(from: Point, to: Point): Promise<void> {
    throw new Error('scroll() not implemented for this device');
  }

  // Optional actions (can be overridden by subclasses)
  async doubleTap(x: number, y: number): Promise<void> {
    throw new Error('doubleTap() not implemented for this device');
  }

  async swipePoints(from: Point, to: Point, duration?: number): Promise<void> {
    throw new Error('swipePoints() not implemented for this device');
  }

  async longPress(x: number, y: number, duration?: number): Promise<void> {
    throw new Error('longPress() not implemented for this device');
  }

  async back(): Promise<void> {
    throw new Error('back() not supported for this device');
  }

  async home(): Promise<void> {
    throw new Error('home() not implemented for this device');
  }

  // Lifecycle
  abstract connect(): Promise<void>;
  abstract destroy(): Promise<void>;

  // Optional description
  describe?(): string {
    return `${this.interfaceType} device: ${this.id}`;
  }
}
