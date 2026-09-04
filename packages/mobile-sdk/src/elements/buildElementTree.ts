/**
 * Element Tree Builder
 * Formats extracted elements into a string representation for LLM context.
 */

import { MobileElement } from './types';

/**
 * Options for building the element tree string
 */
export interface BuildElementTreeOptions {
  /** Include bounds in the output (default: true) */
  includeBounds?: boolean;

  /** Include resource ID when no text/contentDesc is available (default: true) */
  includeResourceId?: boolean;

  /** Maximum number of elements to include (default: no limit) */
  maxElements?: number;
}

/**
 * Build a string representation of elements for LLM context.
 *
 * Output format:
 * [0] Button text="Login" resource-id="com.app:id/btn_login" bounds=[100,200][300,250]
 * [1] TextField text="Email" resource-id="com.app:id/input_email" bounds=[100,300][500,350]
 * [2] Image content-desc="Profile" resource-id="com.app:id/icon_profile" bounds=[50,50][100,100]
 * [3] Button text="Submit" bounds=[100,400][300,450] (scrollable)
 * [4] TextField class="android.widget.EditText" bounds=[100,500][500,550]
 *
 * All available attributes (text, content-desc, resource-id) are shown for selector support.
 * For elements with no other identifiers, class name is shown to enable class= locators.
 *
 * @param elements - Array of MobileElement to format
 * @param options - Formatting options
 * @returns Formatted string with one element per line
 */
export function buildElementTreeString(
  elements: MobileElement[],
  options: BuildElementTreeOptions = {}
): string {
  const {
    includeBounds = true,
    includeResourceId = true,
    maxElements,
  } = options;

  const elementsToFormat = maxElements
    ? elements.slice(0, maxElements)
    : elements;

  const lines: string[] = [];

  for (const element of elementsToFormat) {
    const parts: string[] = [];

    // Index and type
    parts.push(`[${element.index}]`);
    parts.push(element.displayType);

    // Show text if present
    if (element.text) {
      parts.push(`text="${element.text}"`);
    }

    // Show content-desc if present (especially important for icons/images)
    if (element.contentDesc) {
      parts.push(`content-desc="${element.contentDesc}"`);
    }

    // Always show resource-id if present (most stable selector)
    if (includeResourceId && element.resourceId) {
      parts.push(`resource-id="${element.resourceId}"`);
    }

    // Show class name if no other identifiers (allows class= locator for elements like TextFields)
    if (!element.text && !element.contentDesc && !element.resourceId && element.className) {
      parts.push(`class="${element.className}"`);
    }

    // Bounds
    if (includeBounds) {
      const { left, top, right, bottom } = element.bounds;
      parts.push(`bounds=[${left},${top}][${right},${bottom}]`);
    }

    // Flags
    const flags: string[] = [];
    if (element.scrollable) flags.push('scrollable');
    if (!element.enabled) flags.push('disabled');

    if (flags.length > 0) {
      parts.push(`(${flags.join(', ')})`);
    }

    lines.push(parts.join(' '));
  }

  return lines.join('\n');
}

/**
 * Find an element by index
 */
export function findElementByIndex(
  elements: MobileElement[],
  index: number
): MobileElement | undefined {
  return elements.find(e => e.index === index);
}

/**
 * Find elements by text (partial match, case-insensitive)
 */
export function findElementsByText(
  elements: MobileElement[],
  text: string
): MobileElement[] {
  const lowerText = text.toLowerCase();
  return elements.filter(e =>
    e.text.toLowerCase().includes(lowerText) ||
    e.contentDesc.toLowerCase().includes(lowerText)
  );
}

/**
 * Find element by resource ID (partial match)
 */
export function findElementByResourceId(
  elements: MobileElement[],
  resourceId: string
): MobileElement | undefined {
  const lowerId = resourceId.toLowerCase();
  return elements.find(e => e.resourceId.toLowerCase().includes(lowerId));
}
