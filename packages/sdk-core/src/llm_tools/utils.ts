import { Page } from "playwright";
import { ActionEntityLocatorInfo } from "../actions/types";
import { DOMElementNode } from "../dom/types";
import { pickBestLocator } from "../dom/utils/locator";
import { ToolExecutionContext } from "./types";
import logger from "../utils/logger";

export async function getDomElementByIndex(
  ctx: ToolExecutionContext,
  index: number,
): Promise<DOMElementNode | undefined> {
  if (index < 0) {
    return undefined;
  }
  const { page, domService } = ctx;
  const domState = (ctx as any).domState || (await domService.getClickableElements(page));
  const domElement = domState.selectorMap.get(index);
  return domElement;
}

/**
 * Converts a simple XPath to a CSS selector
 */
function convertSimpleXPathToCssSelector(xpath: string): string {
  // Simple conversion - handles basic xpath like "html/body/div[1]/span"
  const parts = xpath.split('/').filter(p => p);
  if (parts.length === 0) return '*';
  
  // Take the last element and extract tag name and index
  const lastPart = parts[parts.length - 1];
  const match = lastPart.match(/^(\w+)(?:\[(\d+)\])?$/);
  
  if (match) {
    const [, tagName, index] = match;
    if (index) {
      return `${tagName}:nth-of-type(${index})`;
    }
    return tagName;
  }
  
  return lastPart;
}

/**
 * Creates an enhanced CSS selector for a DOM element, handling various edge cases
 * Mirrors the behaviour of the original Python implementation's
 * _enhanced_css_selector_for_element.
 */
function enhancedCssSelectorForElement(
  element: DOMElementNode,
  includeDynamicAttributes: boolean = true
): string {
  try {
    // Get base selector from XPath
    let cssSelector = convertSimpleXPathToCssSelector(element.xpath);

    // Handle class attributes
    if (element.attributes.class && includeDynamicAttributes) {
      const validClassNamePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
      const classes = element.attributes.class.split(/\s+/);
      
      for (const className of classes) {
        if (!className.trim()) continue;
        
        if (validClassNamePattern.test(className)) {
          cssSelector += `.${className}`;
        }
      }
    }

    // Safe attributes that are stable and useful for selection
    const SAFE_ATTRIBUTES = new Set([
      'id',
      'name',
      'type',
      'placeholder',
      'aria-label',
      'aria-labelledby',
      'aria-describedby',
      'role',
      'for',
      'autocomplete',
      'required',
      'readonly',
      'alt',
      'title',
      // 'src',
      // 'href',
      'target',
    ]);

    if (includeDynamicAttributes) {
      const dynamicAttributes = [
        'data-id',
        'data-qa',
        'data-cy',
        'data-testid',
        'data-handlepos',
      ];
      dynamicAttributes.forEach(attr => SAFE_ATTRIBUTES.add(attr));
    }

    // Handle other attributes
    for (const [attribute, value] of Object.entries(element.attributes)) {
      if (attribute === 'class') continue;
      if (!attribute.trim()) continue;
      if (!SAFE_ATTRIBUTES.has(attribute)) continue;

      // Escape special characters in attribute names
      const safeAttribute = attribute.replace(/:/g, '\\:');

      // Handle different value cases
      if (value === '') {
        cssSelector += `[${safeAttribute}]`;
      } else if (/["'<>`\n\r\t]/.test(value)) {
        // Use contains for values with special characters
        let processedValue = value;
        
        // For newline-containing text, only use the part before the newline
        if (value.includes('\n')) {
          processedValue = value.split('\n')[0];
        }
        
        // Collapse whitespace and strip
        processedValue = processedValue.replace(/\s+/g, ' ').trim();
        
        // Escape embedded double-quotes
        const safeValue = processedValue.replace(/"/g, '\\"');
        cssSelector += `[${safeAttribute}*="${safeValue}"]`;
      } else {
        cssSelector += `[${safeAttribute}="${value}"]`;
      }
    }

    return cssSelector;
  } catch (error) {
    // Fallback to a more basic selector if something goes wrong
    const tagName = element.tagName || '*';
    return `${tagName}[highlight_index='${element.highlightIndex}']`;
  }
}

/**
 * Generates a stable CSS selector for an iframe element, using identity attributes
 * (title, id, name, src) rather than dynamic class names.
 */
function stableIframeSelector(iframe: DOMElementNode): string {
  const attrs = iframe.attributes;

  // Priority: title > id > name > src (extension origin) > xpath position
  if (attrs.title) {
    return `iframe[title="${attrs.title.replace(/"/g, '\\"')}"]`;
  }
  if (attrs.id) {
    return `iframe#${attrs.id}`;
  }
  if (attrs.name) {
    return `iframe[name="${attrs.name.replace(/"/g, '\\"')}"]`;
  }
  if (attrs.src) {
    try {
      // For extension iframes use origin prefix match; for others use full src
      const url = new URL(attrs.src);
      if (url.protocol === 'chrome-extension:') {
        return `iframe[src^="${url.origin}"]`;
      }
    } catch {
      // ignore invalid URLs
    }
    return `iframe[src="${attrs.src.replace(/"/g, '\\"')}"]`;
  }

  // Fallback: positional xpath-derived selector without classes
  return enhancedCssSelectorForElement(iframe, false);
}

/**
 * Gets the frame path to an element (list of iframe CSS selectors)
 * Mirrors the behaviour of the original Python implementation's get_frame_path.
 */
export function getFramePath(element: DOMElementNode): string[] {
  // Start with the target element and collect all parents
  const parents: DOMElementNode[] = [];
  let current: DOMElementNode | null = element;

  while (current && current.parent !== null) {
    const parent: DOMElementNode = current.parent;
    parents.push(parent);
    current = parent;
  }

  // Reverse the parents list to process from top to bottom
  parents.reverse();

  // Process all iframe parents in sequence
  const framePath: string[] = [];
  const iframes = parents.filter(item => item.tagName === 'iframe');

  for (const iframe of iframes) {
    const sel = stableIframeSelector(iframe);
    logger.debug('[frame-path] iframe attrs:', JSON.stringify(iframe.attributes), '→', sel);
    framePath.push(sel);
  }

  return framePath;
}

export async function getActionEntityLocatorInfo(
  page: Page,
  domElement: DOMElementNode,
): Promise<ActionEntityLocatorInfo> {
  // Generate the best Playwright locator for this element
  let locator: string | null = null;
  // Get frame path
  const framePath = getFramePath(domElement);

  if (domElement.xpath) {
    locator = await pickBestLocator(page, domElement.xpath, framePath, domElement.shadowHostXPaths ?? []);
  }

  const locatorInfo: ActionEntityLocatorInfo = {
    locator: locator || undefined,
    // Only include xpath as fallback when no Playwright locator is available
    xpath: locator ? undefined : domElement.xpath,
    frame_path: framePath,
  };
  return locatorInfo;
}
