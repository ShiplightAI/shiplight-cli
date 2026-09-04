/**
 * Parse Appium Page Source
 *
 * Converts Appium's XML page source to element tree string format
 * compatible with the AI model's expected input.
 */

import type { MobileElement, ElementBounds } from './types';

/**
 * Parse Appium page source XML and convert to element tree string
 *
 * @param pageSource - XML string from Appium's getPageSource()
 * @returns Formatted element tree string for AI context
 */
export function parsePageSourceToTreeString(pageSource: string): string {
  const elements = parsePageSource(pageSource);
  return formatElementsToTreeString(elements);
}

/**
 * Parse Appium page source XML to MobileElement array
 */
export function parsePageSource(pageSource: string): MobileElement[] {
  const elements: MobileElement[] = [];
  let index = 0;

  // Simple XML parsing using regex (works for Appium's format)
  // Match elements with their attributes
  const elementRegex = /<([a-zA-Z0-9_.]+)\s+([^>]*)\/?>|<([a-zA-Z0-9_.]+)\s+([^>]*)>/g;

  let match;
  while ((match = elementRegex.exec(pageSource)) !== null) {
    const tagName = match[1] || match[3];
    const attributes = match[2] || match[4];

    // Skip hierarchy root and non-interactive elements
    if (tagName === 'hierarchy' || tagName === '?xml') {
      continue;
    }

    // Parse attributes
    const attrs = parseAttributes(attributes);

    // Skip elements without useful identifiers or that are not interactive
    const text = attrs['text'] || '';
    const contentDesc = attrs['content-desc'] || '';
    const resourceId = attrs['resource-id'] || '';
    const packageName = attrs['package'] || '';
    const className = tagName;
    const clickable = attrs['clickable'] === 'true';
    const enabled = attrs['enabled'] !== 'false'; // default true
    const focusable = attrs['focusable'] === 'true';
    const scrollable = attrs['scrollable'] === 'true';

    // Parse bounds [left,top][right,bottom]
    const boundsStr = attrs['bounds'] || '';
    const bounds = parseBounds(boundsStr);

    if (!bounds) {
      continue; // Skip elements without valid bounds
    }

    // Skip elements that are too small (likely not visible)
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    if (width < 5 || height < 5) {
      continue;
    }

    // Determine if element is interactive/useful
    const isInteractive = clickable || focusable || scrollable;
    const hasIdentifier = text || contentDesc || resourceId;

    // Only include elements that are either interactive or have identifiers
    if (!isInteractive && !hasIdentifier) {
      continue;
    }

    // Map Android class name to simple display type
    const displayType = mapClassToDisplayType(className, attrs);

    elements.push({
      index,
      className,
      displayType,
      text,
      contentDesc,
      resourceId,
      packageName,
      bounds,
      clickable,
      enabled,
      focusable,
      scrollable,
    });

    index++;
  }

  return elements;
}

/**
 * Parse XML attributes string into key-value object
 */
function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Match attribute="value" or attribute='value'
  const attrRegex = /([a-zA-Z0-9_-]+)=["']([^"']*)["']/g;

  let match;
  while ((match = attrRegex.exec(attrString)) !== null) {
    attrs[match[1]] = match[2];
  }

  return attrs;
}

/**
 * Parse bounds string "[left,top][right,bottom]" to ElementBounds
 */
function parseBounds(boundsStr: string): ElementBounds | null {
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
 * Map Android class name to simple display type
 */
function mapClassToDisplayType(className: string, attrs: Record<string, string>): string {
  // Extract simple name from full class path
  const simpleName = className.split('.').pop() || className;

  // Common mappings
  const mappings: Record<string, string> = {
    'Button': 'Button',
    'ImageButton': 'Button',
    'MaterialButton': 'Button',
    'AppCompatButton': 'Button',
    'TextView': 'Text',
    'AppCompatTextView': 'Text',
    'EditText': 'TextField',
    'AppCompatEditText': 'TextField',
    'TextInputEditText': 'TextField',
    'ImageView': 'Image',
    'AppCompatImageView': 'Image',
    'CheckBox': 'CheckBox',
    'AppCompatCheckBox': 'CheckBox',
    'RadioButton': 'RadioButton',
    'Switch': 'Switch',
    'SwitchCompat': 'Switch',
    'SeekBar': 'Slider',
    'ProgressBar': 'ProgressBar',
    'RecyclerView': 'List',
    'ListView': 'List',
    'ScrollView': 'ScrollView',
    'HorizontalScrollView': 'ScrollView',
    'ViewPager': 'ViewPager',
    'TabLayout': 'TabBar',
    'BottomNavigationView': 'BottomNav',
    'Toolbar': 'Toolbar',
    'ActionBar': 'Toolbar',
    'FrameLayout': 'Container',
    'LinearLayout': 'Container',
    'RelativeLayout': 'Container',
    'ConstraintLayout': 'Container',
    'CardView': 'Card',
    'View': 'View',
  };

  // Check for specific UI patterns based on attributes
  if (attrs['checkable'] === 'true') {
    return attrs['checked'] === 'true' ? 'CheckBox (checked)' : 'CheckBox';
  }

  return mappings[simpleName] || simpleName;
}

/**
 * Format MobileElement array to tree string
 */
function formatElementsToTreeString(elements: MobileElement[]): string {
  const lines: string[] = [];

  for (const element of elements) {
    const parts: string[] = [];

    // Index and type
    parts.push(`[${element.index}]`);
    parts.push(element.displayType);

    // Show text if present
    if (element.text) {
      parts.push(`text="${element.text}"`);
    }

    // Show content-desc if present
    if (element.contentDesc) {
      parts.push(`content-desc="${element.contentDesc}"`);
    }

    // Show resource-id if present
    if (element.resourceId) {
      parts.push(`resource-id="${element.resourceId}"`);
    }

    // Bounds
    const { left, top, right, bottom } = element.bounds;
    parts.push(`bounds=[${left},${top}][${right},${bottom}]`);

    // Add scrollable flag
    if (element.scrollable) {
      parts.push('(scrollable)');
    }

    lines.push(parts.join(' '));
  }

  return lines.join('\n');
}
