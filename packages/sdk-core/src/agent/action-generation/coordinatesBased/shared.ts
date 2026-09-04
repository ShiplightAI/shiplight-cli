/**
 * Shared utilities for coordinates-based (pure vision) action generation.
 */

import { ElementHandle, Page } from "playwright";
import { ActionDataEntity, ActionEntity, ActionEntityLocatorInfo } from "../../../actions/types";
import { pickBestLocatorForElement } from "../../../dom/utils/locator";
import { agentLogger } from "../../../utils/agentLogger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MappedAction {
  action_data: ActionDataEntity | null;
  locatorInfo: ActionEntityLocatorInfo;
}

/** Common input passed to each CUA provider after shared setup. */
export interface CuaContext {
  statement: string;
  page: Page;
  screenshotB64: string;
  viewportWidth: number;
  viewportHeight: number;
  /** The resolved model ID (no provider: prefix). */
  modelId: string;
}

// ---------------------------------------------------------------------------
// Screenshot
// ---------------------------------------------------------------------------

/**
 * Take a screenshot, resize it to match the logical viewport (handles Retina
 * display DPR scaling), and return the result as a base64-encoded PNG string.
 */
export async function prepareScreenshot(
  page: Page,
  viewportWidth: number,
  viewportHeight: number,
): Promise<string> {
  // Remove any existing element highlights so they don't appear in the screenshot
  await page.evaluate(() => {
    document.getElementById("playwright-highlight-container")?.remove();
    if ((window as any)._highlightCleanupFunctions) {
      ((window as any)._highlightCleanupFunctions as (() => void)[]).forEach((fn) => fn());
      (window as any)._highlightCleanupFunctions = [];
    }
  });

  const screenshot = await page.screenshot({ type: "png", fullPage: false });

  const { default: sharp } = await import("sharp");
  const image = sharp(screenshot);
  const { width: actualWidth = 0, height: actualHeight = 0 } = await image.metadata();

  agentLogger.log(
    `Screenshot actual: ${actualWidth}x${actualHeight}, viewport: ${viewportWidth}x${viewportHeight}`,
  );

  // Always normalize to logical viewport size to keep coordinate math consistent
  // regardless of device pixel ratio (e.g. Retina 2x)
  const needsResize = actualWidth !== viewportWidth || actualHeight !== viewportHeight;
  const buffer = needsResize
    ? await image.resize(viewportWidth, viewportHeight).png().toBuffer()
    : screenshot;

  return buffer.toString("base64");
}

// ---------------------------------------------------------------------------
// Element utilities
// ---------------------------------------------------------------------------

/**
 * Given an absolute viewport coordinate, find the DOM element at that point
 * and return coordinates relative to its center (for element-anchored actions).
 */
export async function convertToElementAnchoredCoordinates(
  page: Page,
  x: number,
  y: number,
): Promise<{ relative_x: number; relative_y: number; element: ElementHandle | null }> {
  const handle = await page.evaluateHandle(
    (coords: { x: number; y: number }) => document.elementFromPoint(coords.x, coords.y),
    { x, y },
  );

  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    throw new Error(`No element found at (${x}, ${y})`);
  }

  const box = await element.boundingBox();
  if (!box) {
    await handle.dispose();
    throw new Error(`Element at (${x}, ${y}) has no bounding box`);
  }

  return {
    relative_x: x - (box.x + box.width / 2),
    relative_y: y - (box.y + box.height / 2),
    element,
  };
}

/**
 * Generate the best stable locator for an element, with xpath as fallback.
 *
 * Playwright's `generateLocator` returns null for elements it can't synthesize
 * a stable selector for (purely structural nodes, elements with no role/name/
 * test id, etc.). In that case the action would be unusable at replay time, so
 * we always compute an absolute xpath up front and pass it alongside the
 * locator. The action executors prefer `locator > xpath` via `getLocator()`.
 */
export async function getElementLocatorInfo(
  page: Page,
  element: ElementHandle | null,
): Promise<ActionEntityLocatorInfo> {
  if (!element) {
    return { xpath: undefined, locator: undefined, frame_path: [] };
  }

  // Compute xpath BEFORE pickBestLocatorForElement, which disposes the handle.
  const xpath = await element.evaluate((el: Element) => {
    const segments: string[] = [];
    let current: Element | null = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      segments.unshift(`${current.tagName.toLowerCase()}[${index}]`);
      current = current.parentElement;
    }
    return segments.length ? `/${segments.join('/')}` : null;
  }).catch(() => null);

  const locator = await pickBestLocatorForElement(page, element as ElementHandle<HTMLElement>);
  return {
    xpath: xpath ?? undefined,
    locator: locator ?? undefined,
    frame_path: [],
  };
}

// ---------------------------------------------------------------------------
// Action entity builder
// ---------------------------------------------------------------------------

export function buildActionEntity(
  statement: string,
  action_data: ActionDataEntity,
  locatorInfo: ActionEntityLocatorInfo,
): ActionEntity {
  return {
    action_description: statement,
    action_data,
    locator: locatorInfo.locator ?? undefined,
    xpath: locatorInfo.xpath ?? undefined,
    frame_path: locatorInfo.frame_path,
  };
}
