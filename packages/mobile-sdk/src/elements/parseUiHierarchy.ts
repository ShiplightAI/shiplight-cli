/**
 * UI Hierarchy XML Parser
 * Parses uiautomator dump XML and extracts interactive elements.
 */

import {
  MobileElement,
  ElementBounds,
  isValidBounds,
  simplifyClassName,
} from './types';

/**
 * Options for parsing the UI hierarchy
 */
export interface ParseOptions {
  /** Include non-interactive elements (default: false) */
  includeNonInteractive?: boolean;

  /** Filter to specific package name */
  packageFilter?: string;
}

/**
 * Result of parsing the UI hierarchy XML
 */
export interface ParseResult {
  /** Extracted elements with assigned indices */
  elements: MobileElement[];

  /** Total number of nodes in the hierarchy */
  totalNodes: number;
}

/**
 * Parse bounds string from uiautomator format: "[left,top][right,bottom]"
 * Example: "[67,1416][217,1585]"
 */
export function parseBounds(boundsStr: string): ElementBounds | null {
  const match = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) {
    return null;
  }

  return {
    left: parseInt(match[1], 10),
    top: parseInt(match[2], 10),
    right: parseInt(match[3], 10),
    bottom: parseInt(match[4], 10),
  };
}

/**
 * Extract attribute value from a node string using regex.
 * This is a simple parser that doesn't require an XML library.
 */
function getAttr(nodeStr: string, attrName: string): string {
  const regex = new RegExp(`${attrName}="([^"]*)"`, 'i');
  const match = nodeStr.match(regex);
  return match ? match[1] : '';
}

/**
 * Check if an element should be considered interactive
 */
function isInteractive(
  clickable: boolean,
  scrollable: boolean,
  focusable: boolean,
  className: string,
  text: string,
  contentDesc: string
): boolean {
  // Explicitly clickable or scrollable
  if (clickable || scrollable) {
    return true;
  }

  // EditText is always interactive (for text input)
  if (className.includes('EditText')) {
    return true;
  }

  // Focusable elements with text/description are often interactive
  if (focusable && (text || contentDesc)) {
    return true;
  }

  return false;
}

/**
 * Parse uiautomator dump XML and extract elements.
 *
 * @param xml - Raw XML string from uiautomator dump
 * @param options - Parsing options
 * @returns Parsed elements and metadata
 */
export function parseUiHierarchy(xml: string, options: ParseOptions = {}): ParseResult {
  const { includeNonInteractive = false, packageFilter } = options;

  const elements: MobileElement[] = [];

  // Find all <node ... /> or <node ...>...</node> elements using regex
  // This is simpler than using a full XML parser and works for uiautomator output
  const nodeRegex = /<node\s+[^>]+\/?>/g;
  const matches = xml.match(nodeRegex) || [];

  let elementIndex = 0;

  for (const nodeStr of matches) {
    // Extract attributes
    const className = getAttr(nodeStr, 'class');
    const text = getAttr(nodeStr, 'text');
    const resourceId = getAttr(nodeStr, 'resource-id');
    const contentDesc = getAttr(nodeStr, 'content-desc');
    const boundsStr = getAttr(nodeStr, 'bounds');
    const packageName = getAttr(nodeStr, 'package');
    const clickable = getAttr(nodeStr, 'clickable') === 'true';
    const scrollable = getAttr(nodeStr, 'scrollable') === 'true';
    const enabled = getAttr(nodeStr, 'enabled') === 'true';
    const focusable = getAttr(nodeStr, 'focusable') === 'true';

    // Parse bounds
    const bounds = parseBounds(boundsStr);
    if (!bounds || !isValidBounds(bounds)) {
      continue;
    }

    // Apply package filter if specified
    if (packageFilter && packageName !== packageFilter) {
      continue;
    }

    // Skip non-interactive elements unless requested
    const interactive = isInteractive(clickable, scrollable, focusable, className, text, contentDesc);
    if (!interactive && !includeNonInteractive) {
      continue;
    }

    // Skip elements without any identifying information
    if (!text && !contentDesc && !resourceId && !clickable) {
      continue;
    }

    const element: MobileElement = {
      index: elementIndex++,
      className,
      displayType: simplifyClassName(className),
      text,
      resourceId,
      contentDesc,
      bounds,
      clickable,
      scrollable,
      enabled,
      focusable,
      packageName,
    };

    elements.push(element);
  }

  return {
    elements,
    totalNodes: matches.length,
  };
}
