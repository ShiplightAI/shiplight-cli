/**
 * Android Element Service
 * High-level service for extracting and working with UI elements from Android devices.
 */

import type { AndroidDevice } from '../devices/android/device';
import { parseUiHierarchy, ParseOptions } from './parseUiHierarchy';
import { buildElementTreeString, BuildElementTreeOptions } from './buildElementTree';
import {
  MobileElement,
  ElementExtractionResult,
  getElementCenter,
} from './types';

/**
 * Options for element extraction
 */
export interface ElementExtractionOptions extends ParseOptions, BuildElementTreeOptions {}

/**
 * Service for extracting and managing UI elements from Android devices.
 *
 * Usage:
 * ```typescript
 * const device = new AndroidDevice('emulator-5554');
 * await device.connect();
 *
 * const elementService = new AndroidElementService(device);
 * const result = await elementService.getElements();
 *
 * console.log(result.elementTreeString);
 * // [0] Button text="Login" bounds=[100,200][300,250]
 * // [1] TextField text="Email" bounds=[100,300][500,350]
 *
 * // Get center coordinates for element 0
 * const coords = elementService.getElementCoordinates(0);
 * // { x: 200, y: 225 }
 * ```
 */
export class AndroidElementService {
  private device: AndroidDevice;
  private lastElements: MobileElement[] = [];
  private lastExtractionTime: number = 0;

  constructor(device: AndroidDevice) {
    this.device = device;
  }

  /**
   * Extract elements from the current screen.
   *
   * @param options - Extraction and formatting options
   * @returns Extraction result with elements and formatted tree string
   */
  async getElements(options: ElementExtractionOptions = {}): Promise<
    ElementExtractionResult & { elementTreeString: string }
  > {
    const startTime = Date.now();

    // Get UI hierarchy from device
    const xml = await this.device.getUiHierarchy();

    // Parse hierarchy to extract elements
    const parseResult = parseUiHierarchy(xml, options);

    // Store elements for later coordinate lookup
    this.lastElements = parseResult.elements;
    this.lastExtractionTime = Date.now();

    // Build tree string for LLM context
    const elementTreeString = buildElementTreeString(parseResult.elements, options);

    const extractionTimeMs = Date.now() - startTime;

    return {
      elements: parseResult.elements,
      totalNodes: parseResult.totalNodes,
      interactiveCount: parseResult.elements.length,
      extractionTimeMs,
      elementTreeString,
    };
  }

  /**
   * Get the center coordinates for an element by index.
   * Uses the last extracted elements.
   *
   * @param index - Element index from the tree string
   * @returns Center coordinates or null if element not found
   */
  getElementCoordinates(index: number): { x: number; y: number } | null {
    const element = this.lastElements.find(e => e.index === index);
    if (!element) {
      return null;
    }
    return getElementCenter(element.bounds);
  }

  /**
   * Get an element by index from the last extraction.
   *
   * @param index - Element index
   * @returns Element or undefined if not found
   */
  getElement(index: number): MobileElement | undefined {
    return this.lastElements.find(e => e.index === index);
  }

  /**
   * Get all elements from the last extraction.
   */
  getLastElements(): MobileElement[] {
    return this.lastElements;
  }

  /**
   * Check if elements are stale (older than threshold).
   *
   * @param maxAgeMs - Maximum age in milliseconds (default: 5000)
   */
  isStale(maxAgeMs: number = 5000): boolean {
    return Date.now() - this.lastExtractionTime > maxAgeMs;
  }

  /**
   * Clear cached elements.
   */
  clearCache(): void {
    this.lastElements = [];
    this.lastExtractionTime = 0;
  }
}
