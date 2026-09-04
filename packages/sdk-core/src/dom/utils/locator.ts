/**
 * Locator Generation Utilities
 *
 * Provides utilities for generating Playwright locators for DOM elements.
 * Originally from the v1 Python backend's dom_utils, which is not part of
 * this repository.
 */

import { ElementHandle, Frame, Page } from 'playwright';
import logger from '../../utils/logger';
import { getFrameContext, LOCATOR_TIMEOUT } from '../../actions/utils';

/**
 * Pick the best Playwright locator for a given element using Playwright's built-in locator generator.
 *
 * This function uses Playwright's internal `playwright.generateLocator()` function which is
 * available when PWDEBUG=console is set in the environment.
 *
 * @param page - Playwright page instance
 * @param xpath - XPath of the element to generate locator for
 * @returns Best Playwright locator string, or null if generation fails
 *
 * @example
 * ```typescript
 * const locator = await pickBestLocator(page, '//div[@id="submit-button"]');
 * // Returns: 'getByRole("button", { name: "Submit" })'
 * ```
 */
export async function pickBestLocator(
  page: Page,
  xpath: string,
  frame_path: string[] = [],
  shadowHostXPaths: string[] = []
): Promise<string | null> {
  try {
    const frameContext: Page | Frame | null = await getFrameContext(page, frame_path);
    if (!frameContext) {
      logger.warn(`Could not find frame context for xpath: ${xpath}`);
      return null;
    }

    let elementHandle: ElementHandle<Element> | null = null;

    if (shadowHostXPaths.length > 0) {
      const hostXPath = shadowHostXPaths[0];
      if (!hostXPath) {
        logger.warn(`Missing shadow host xpath for element: ${xpath}`);
        return null;
      }

      const host = frameContext.locator(`xpath=${normalizeXPathForLocator(hostXPath)}`);
      const innerCssSelector = simpleXPathToCss(xpath);
      const target = innerCssSelector
        ? host.locator(`css=${innerCssSelector}`)
        : host.locator(`xpath=${normalizeXPathForLocator(xpath)}`);
      elementHandle = await target.elementHandle({ timeout: LOCATOR_TIMEOUT });
      if (!elementHandle) {
        logger.warn(`Could not find shadow DOM element with xpath: ${xpath}`);
        return null;
      }
    } else {
      elementHandle = await frameContext.locator(`xpath=${xpath}`).elementHandle({ timeout: LOCATOR_TIMEOUT });

      if (!elementHandle) {
        logger.warn(`Could not find element with xpath: ${xpath}`);
        return null;
      }
    }

    const bestLocator = await frameContext.evaluate(
      (el: Element) => {
        // @ts-ignore - playwright global is injected by Playwright when PWDEBUG=console
        if (typeof playwright !== 'undefined' && playwright.generateLocator) {
          // @ts-ignore
          return playwright.generateLocator(el);
        }
        return null;
      },
      elementHandle
    );

    await elementHandle.dispose();

    if (bestLocator) {
      logger.debug(`Generated locator for ${xpath}: ${bestLocator}`);
      return bestLocator as string;
    }

    logger.debug('playwright.generateLocator is not available (PWDEBUG=console not set), using xpath fallback');
    return null;
  } catch (error) {
    logger.error(`Error in pickBestLocator: ${error}`);
    return null;
  }
}

export async function pickBestLocatorForElement(page: Page, elementHandle: ElementHandle<HTMLElement>): Promise<string | null> {
  try {
    const ownerFrame = await elementHandle.ownerFrame();
    const evaluationContext: Page | Frame = ownerFrame ?? page;

    // First, get the element handle using xpath
    // Use Playwright's built-in locator generator
    // This requires PWDEBUG=console to be set in the environment
    const bestLocator = await evaluationContext.evaluate(
      (el: Element) => {
        // @ts-ignore - playwright global is injected by Playwright when PWDEBUG=console
        if (typeof playwright !== 'undefined' && playwright.generateLocator) {
          // @ts-ignore
          return playwright.generateLocator(el);
        }
        return null;
      },
      elementHandle
    );

    // Clean up element handle
    await elementHandle.dispose();

    if (bestLocator) {
      logger.debug(`Generated locator: ${bestLocator}`);
      return bestLocator as string;
    }

    logger.debug('playwright.generateLocator is not available (PWDEBUG=console not set), using xpath fallback');
    return null;
  } catch (error) {
    logger.error(`Error in pickBestLocator: ${error}`);
    return null;
  }
}

/**
 * Generate locators for multiple elements in batch
 *
 * @param page - Playwright page instance
 * @param xpaths - Array of XPaths to generate locators for
 * @returns Map of xpath -> locator string
 */
export async function pickBestLocators(
  page: Page,
  xpaths: string[]
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();

  // Process in parallel for better performance
  await Promise.all(
    xpaths.map(async (xpath) => {
      const locator = await pickBestLocator(page, xpath);
      results.set(xpath, locator);
    })
  );

  return results;
}

/**
 * Check if Playwright locator generator is available
 *
 * @param page - Playwright page instance
 * @returns true if playwright.generateLocator is available
 */
export async function isLocatorGeneratorAvailable(page: Page): Promise<boolean> {
  try {
    const available = await page.evaluate(() => {
      // @ts-ignore
      return typeof playwright !== 'undefined' && typeof playwright.generateLocator === 'function';
    });
    return available;
  } catch {
    return false;
  }
}

/**
 * Fallback locator generation when playwright.generateLocator is not available
 *
 * Generates a simple locator based on xpath
 *
 * @param xpath - XPath of the element
 * @returns Fallback locator string
 */
export function getFallbackLocator(xpath: string): string {
  return `xpath=${xpath}`;
}

function normalizeXPathForLocator(xpath: string): string {
  const trimmed = xpath.trim();
  if (trimmed.startsWith('/') || trimmed.startsWith('(') || trimmed.startsWith('.')) {
    return trimmed;
  }
  return `//${trimmed}`;
}

/**
 * Converts a simple absolute XPath (tag[n]/tag[n]/…) to a CSS selector.
 * Only handles tag names with optional numeric positional predicates.
 * Returns null for any XPath that uses attribute predicates, axes (//), or
 * other non-trivial syntax — callers should fall back to an XPath-based locator.
 */
function simpleXPathToCss(xpath: string): string | null {
  const trimmed = xpath.trim().replace(/^\/+/, '');
  if (!trimmed) return null;

  const segments = trimmed.split('/').filter(Boolean);
  const cssSegments: string[] = [];
  for (const segment of segments) {
    const match = segment.match(/^([a-zA-Z][\w-]*)(?:\[(\d+)\])?$/);
    if (!match) return null;

    const tag = match[1].toLowerCase();
    const nth = match[2] ? `:nth-of-type(${match[2]})` : '';
    cssSegments.push(`${tag}${nth}`);
  }

  return cssSegments.join(' > ');
}
