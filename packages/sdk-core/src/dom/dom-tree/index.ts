/**
 * DOM-Tree Traversal Module
 *
 * Uses DOM traversal with interactivity detection to find clickable/interactive elements.
 * This is the TypeScript version that compiles to the same output as index.js.
 */

// Extend Window interface for custom functions
declare global {
  interface Window {
    getEventListenersForNode?: (element: Element) => Array<{ type: string }>;
    _highlightCleanupFunctions?: Array<() => void>;
  }
  // Chrome DevTools function (only available in DevTools console)
  function getEventListeners(element: Element): Record<string, Array<{ type: string }>>;
}

// ============================================================================
// Type Definitions
// ============================================================================

export interface DOMTreeArgs {
  doHighlightElements: boolean;
  focusHighlightIndex: number;
  viewportExpansion: number;
  debugMode: boolean;
  interactiveClassNames: string[];
  alwaysHighlightFileInput: boolean;
  /** IoU threshold for considering two rects as "same" (0-1). Default: 0.85 */
  sameRectIoUThreshold?: number;
  /** Action intent for filtering elements. Default: 'all' */
  actionIntent?: 'click' | 'input' | 'scroll' | 'all';
  /**
   * Grayscale image for dynamic label positioning.
   * 2D number array where grayscaleImage[y][x] is pixel intensity 0-255.
   * Generated from screenshot of the clean page (before any boxes are drawn).
   * Labels are placed by checking uniformity at placement time using dynamic convolution.
   * The image is modified as boxes and labels are placed to block future placements.
   */
  grayscaleImage?: number[][] | null;
  /**
   * Tolerance for uniformity check in label placement.
   * A region is uniform if max(pixelValues) - min(pixelValues) <= tolerance.
   * Default: 32 (out of 255). Higher values allow placement on less uniform backgrounds.
   */
  uniformityTolerance?: number;
  /**
   * When true, captures before/after grayscale image snapshots for each labeled element.
   * Useful for debugging label placement issues.
   */
  captureDebugSnapshots?: boolean;
  /**
   * Callback invoked for each snapshot when captureDebugSnapshots is true.
   * Allows streaming snapshots to avoid memory buildup.
   */
  onSnapshot?: (snapshot: { elementIndex: number; type: 'before' | 'after'; data: number[][] }) => void;
  /**
   * Callback for streaming debug logs to external receiver.
   */
  onLog?: (message: string) => void;
  /**
   * Execution phase for two-phase rendering:
   * - 'boxes': Draw all bounding boxes, return element data (no labels)
   * - 'labels': Place labels using provided grayscale and element data
   * - undefined: Legacy single-pass mode (draw boxes and labels together)
   */
  phase?: 'boxes' | 'labels';
  /**
   * Element data from boxes phase, used in labels phase.
   * Contains positions and styling info needed to place labels.
   */
  elementData?: ElementRenderData[];
}

/**
 * Data returned from boxes phase, used in labels phase.
 */
export interface ElementRenderData {
  index: number;
  xpath: string;
  rect: { x: number; y: number; width: number; height: number };
  color: string;
}

export interface DOMTreeNode {
  tagName?: string;
  type?: string;
  text?: string;
  attributes?: Record<string, string | null>;
  xpath?: string;
  children?: string[];
  isVisible?: boolean;
  isTopElement?: boolean;
  isInteractive?: boolean;
  isInViewport?: boolean;
  highlightIndex?: number;
  shadowRoot?: boolean;
  isScrollable?: boolean;
  markAsClickable?: boolean;
}

export interface TreeEntry {
  type: 'parent' | 'element';
  highlightIndex?: number;  // Only for type === 'element'
  label: string;  // Description/selector for display
}

export interface LabelSnapshot {
  elementIndex: number;
  beforeImage: number[][];  // Grayscale state before label placed
  afterImage: number[][];   // Grayscale state after label placed
}

export interface DOMTreeResult {
  rootId: string | null;
  map: Record<string, DOMTreeNode>;
  debugLogs?: string[];
  treeEntries?: TreeEntry[];
  /** Number of elements that received a highlight index */
  highlightCount?: number;
  /** Final grayscale image after all boxes and labels have been marked (for debugging) */
  finalGrayscaleImage?: number[][];
  // Note: labelSnapshots are now streamed via onSnapshot callback instead of returned
  /** Element data from boxes phase, for use in subsequent labels phase */
  elementData?: ElementRenderData[];
}

interface OverlayData {
  element: HTMLDivElement;
  initialRect: DOMRect | TransformedRect;
}

interface TransformedRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

interface LabelBoundingBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

interface DOMCache {
  boundingRects: WeakMap<Element, DOMRect>;
  clientRects: WeakMap<Element, DOMRectList>;
  computedStyles: WeakMap<Element, CSSStyleDeclaration>;
  nodeEventListeners: WeakMap<Element, string[]>;
  clearCache: () => void;
}

// ============================================================================
// Main Function
// ============================================================================

export const buildDOMTree = (
  args: DOMTreeArgs = {
    doHighlightElements: true,
    focusHighlightIndex: -1,
    viewportExpansion: 0,
    debugMode: false,
    interactiveClassNames: [],
    alwaysHighlightFileInput: false,
    sameRectIoUThreshold: 0.85,
  }
): DOMTreeResult => {
  // Default threshold if not provided
  const sameRectIoUThreshold = args.sameRectIoUThreshold ?? 0.85;
  const EVENT_LISTENER_MAPPING: Record<string, string> = {
    'onclick': 'click',
    'onmousedown': 'mousedown',
    'onmouseup': 'mouseup',
    'ondblclick': 'dblclick',
    'onmouseenter': 'mouseenter',
    'onmouseleave': 'mouseleave',
    'onmousemove': 'mousemove',
    'onmouseout': 'mouseout',
    'onmouseover': 'mouseover',
    'onmousewheel': 'mousewheel',
    'onscroll': 'scroll',
    'onselect': 'select',
    'onchange': 'change',
    'onfocus': 'focus',
    'onblur': 'blur',
    'onkeydown': 'keydown',
    'onkeyup': 'keyup',
    'onkeypress': 'keypress',
    'oninput': 'input',
  };

  const INTERACTION_EVENTS = ['click', 'mousedown', 'mouseup', 'dblclick', 'input', 'mouseenter', 'mouseleave'];

  const {
    doHighlightElements,
    focusHighlightIndex,
    viewportExpansion,
    debugMode,
    interactiveClassNames,
    alwaysHighlightFileInput,
    grayscaleImage,
    uniformityTolerance = 32,
    captureDebugSnapshots = false,
    onSnapshot,
    onLog,
    phase,
    elementData: inputElementData,
  } = args;

  // Helper to stream logs if callback provided
  const streamLog = (msg: string) => {
    if (onLog) onLog(msg);
  };

  streamLog(`[dom-tree] Starting phase=${phase || 'legacy'}, grayscaleImage=${!!grayscaleImage}, captureDebugSnapshots=${captureDebugSnapshots}`);

  const buttonClassNames = ['button', 'dropdown-toggle'];
  const cursorPointerClassNames = ['cursor-pointer', 'tw-cursor-pointer', 'clickable'];
  const heuristicClassPattern = /\b(btn|const clickable|menu|item|entry|link)\b/i;
  const containerSelectors = 'button,a,[role="button"],.menu,.dropdown,.list,.toolbar';

  let highlightIndex = 0; // Reset highlight index

  /**
   * Helper function to check if element has any of the specified class names.
   */
  function hasAnyClassName(element: Element, classNames: string[]): boolean {
    if (!element.classList || !classNames || classNames.length === 0) return false;
    return classNames.some(className => element.classList.contains(className));
  }

  // Add caching mechanisms at the top level
  const DOM_CACHE: DOMCache = {
    boundingRects: new WeakMap(),
    clientRects: new WeakMap(),
    computedStyles: new WeakMap(),
    nodeEventListeners: new WeakMap(),
    clearCache: () => {
      DOM_CACHE.boundingRects = new WeakMap();
      DOM_CACHE.clientRects = new WeakMap();
      DOM_CACHE.computedStyles = new WeakMap();
      DOM_CACHE.nodeEventListeners = new WeakMap();
    }
  };

  /**
   * Gets the cached bounding rect for an element.
   */
  function getCachedBoundingRect(element: Element | null): DOMRect | null {
    if (!element) return null;

    if (DOM_CACHE.boundingRects.has(element)) {
      return DOM_CACHE.boundingRects.get(element)!;
    }

    const rect = element.getBoundingClientRect();

    if (rect) {
      DOM_CACHE.boundingRects.set(element, rect);
    }
    return rect;
  }

  /**
   * Gets the cached computed style for an element.
   */
  function getCachedComputedStyle(element: Element | null): CSSStyleDeclaration | null {
    if (!element) return null;

    if (DOM_CACHE.computedStyles.has(element)) {
      return DOM_CACHE.computedStyles.get(element)!;
    }

    const style = window.getComputedStyle(element);

    if (style) {
      DOM_CACHE.computedStyles.set(element, style);
    }
    return style;
  }

  /**
   * Gets the cached client rects for an element.
   */
  function getCachedClientRects(element: Element | null): DOMRectList | null {
    if (!element) return null;

    if (DOM_CACHE.clientRects.has(element)) {
      return DOM_CACHE.clientRects.get(element)!;
    }

    const rects = element.getClientRects();

    if (rects) {
      DOM_CACHE.clientRects.set(element, rects);
    }
    return rects;
  }

  /**
   * Gets the event listeners for a node.
   */
  function getNodeEventListeners(element: Element): string[] {
    const set = new Set<string>();
    try {
      if (typeof getEventListeners === 'function') {
        const listeners = getEventListeners(element);
        for (const eventType in listeners) {
          if (listeners[eventType] && listeners[eventType].length > 0) {
            set.add(eventType);
          }
        }
      }

      const getEventListenersForNode = (element?.ownerDocument?.defaultView as Window | null)?.getEventListenersForNode || window.getEventListenersForNode;
      if (typeof getEventListenersForNode === 'function') {
        const listeners = getEventListenersForNode(element);
        for (const listener of listeners) {
          if (listener.type) {
            set.add(listener.type);
          }
        }
      }

      for (const attr in EVENT_LISTENER_MAPPING) {
        if (element.hasAttribute(attr) || typeof (element as any)[attr] === 'function') {
          set.add(EVENT_LISTENER_MAPPING[attr]);
        }
      }
    } catch (error) {
      // Silently ignore errors
    }

    const listenedEvents = Array.from(set);
    return listenedEvents;
  }

  function getCachedNodeEventListeners(element: Element | null): string[] | null {
    if (!element) return null;
    if (DOM_CACHE.nodeEventListeners.has(element)) {
      return DOM_CACHE.nodeEventListeners.get(element)!;
    }
    const listenedEvents = getNodeEventListeners(element);
    if (listenedEvents) {
      DOM_CACHE.nodeEventListeners.set(element, listenedEvents);
    }
    return listenedEvents;
  }

  // ============================================================================
  // Action Intent Predicates
  // ============================================================================

  const CLICKABLE_TAGS = new Set(['a', 'button', 'summary', 'label', 'option', 'optgroup']);
  const CLICKABLE_ROLES = new Set([
    'button', 'link', 'menuitem', 'menuitemradio', 'menuitemcheckbox',
    'radio', 'checkbox', 'tab', 'switch', 'option', 'treeitem'
  ]);
  const CLICK_EVENTS = ['click', 'mousedown', 'mouseup', 'dblclick'];

  const TEXT_INPUT_TYPES = new Set([
    'text', 'email', 'password', 'search', 'tel', 'url', 'number',
    'date', 'datetime-local', 'month', 'week', 'time'
  ]);
  const INPUT_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox']);

  /**
   * Checks if an element matches the 'click' intent.
   * Includes: buttons, links, elements with click handlers, clickable roles
   */
  function isClickIntentElement(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    if (CLICKABLE_TAGS.has(tagName)) return true;

    const role = element.getAttribute('role');
    if (role && CLICKABLE_ROLES.has(role)) return true;

    // Check for click event listeners
    const listeners = getCachedNodeEventListeners(element);
    if (listeners?.some(e => CLICK_EVENTS.includes(e))) return true;

    // Dropdown/popup triggers
    if (element.getAttribute('aria-haspopup') ||
        element.getAttribute('data-toggle') === 'dropdown') return true;

    return false;
  }

  /**
   * Checks if an element matches the 'input' intent.
   * Includes: text inputs, textareas, contenteditable elements
   */
  function isInputIntentElement(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'textarea') return true;

    if (tagName === 'input') {
      const type = (element as HTMLInputElement).type?.toLowerCase() || 'text';
      return TEXT_INPUT_TYPES.has(type);
    }

    if ((element as HTMLElement).isContentEditable ||
        element.getAttribute('contenteditable') === 'true') return true;

    const role = element.getAttribute('role');
    return role ? INPUT_ROLES.has(role) : false;
  }

  /**
   * Checks if an element matches the 'scroll' intent.
   * Delegates to existing isElementScrollable function.
   */
  function isScrollIntentElement(element: Element): boolean {
    // Note: isElementScrollable is defined later but hoisted due to function declaration
    return isElementScrollable(element as HTMLElement);
  }

  /**
   * Checks if an element matches the specified action intent.
   */
  function matchesActionIntent(element: Element, intent: 'click' | 'input' | 'scroll' | 'all'): boolean {
    if (intent === 'all') return true;
    if (intent === 'click') return isClickIntentElement(element);
    if (intent === 'input') return isInputIntentElement(element);
    if (intent === 'scroll') return isScrollIntentElement(element);
    return true;
  }

  /**
   * Hash map of DOM nodes indexed by their highlight index.
   */
  const DOM_HASH_MAP: Record<string, DOMTreeNode> = {};

  const ID = { current: 0 };

  const HIGHLIGHT_CONTAINER_ID = "playwright-highlight-container";

  // Add a WeakMap cache for XPath strings
  const xpathCache = new WeakMap<Element, string>();

  const debugLogs: string[] = [];
  const debugLog = (msg: string) => {
    debugLogs.push(msg);
  };

  // ============================================================================
  // Grayscale Image Label Placement (Dynamic Convolution)
  // ============================================================================

  /**
   * 1D sliding window min/max using monotonic deque (Lemire algorithm).
   * O(n) time complexity - each element is pushed and popped at most once.
   *
   * @param arr - Array of values
   * @param k - Window size
   * @returns Object with maxResults and minResults arrays
   */
  function slidingWindowMinMax(arr: number[], k: number): { maxResults: number[]; minResults: number[] } {
    if (k <= 0 || arr.length === 0 || k > arr.length) {
      return { maxResults: [], minResults: [] };
    }

    const maxDeque: number[] = []; // Indices, values in descending order
    const minDeque: number[] = []; // Indices, values in ascending order
    const maxResults: number[] = [];
    const minResults: number[] = [];

    for (let i = 0; i < arr.length; i++) {
      const val = arr[i];

      // Update max deque - remove smaller elements from back
      while (maxDeque.length > 0 && arr[maxDeque[maxDeque.length - 1]] <= val) {
        maxDeque.pop();
      }
      maxDeque.push(i);
      // Remove front if outside window
      if (maxDeque[0] <= i - k) maxDeque.shift();

      // Update min deque - remove larger elements from back
      while (minDeque.length > 0 && arr[minDeque[minDeque.length - 1]] >= val) {
        minDeque.pop();
      }
      minDeque.push(i);
      // Remove front if outside window
      if (minDeque[0] <= i - k) minDeque.shift();

      // Record result once window is full
      if (i >= k - 1) {
        maxResults.push(arr[maxDeque[0]]);
        minResults.push(arr[minDeque[0]]);
      }
    }

    return { maxResults, minResults };
  }

  /**
   * Compute 2D min/max over sliding windows within a bounded region.
   * Uses two-pass decomposition: horizontal pass then vertical pass.
   *
   * @param image - Full grayscale image (2D array where image[y][x] is intensity 0-255)
   * @param regionX - Starting X of the region to scan
   * @param regionY - Starting Y of the region to scan
   * @param regionWidth - Width of the region to scan
   * @param regionHeight - Height of the region to scan
   * @param labelWidth - Width of the label (kernel width)
   * @param labelHeight - Height of the label (kernel height)
   * @returns Object with windowMax and windowMin 2D arrays
   */
  function compute2DMinMaxInRegion(
    image: number[][],
    regionX: number,
    regionY: number,
    regionWidth: number,
    regionHeight: number,
    labelWidth: number,
    labelHeight: number
  ): { windowMax: number[][]; windowMin: number[][] } {
    // Handle edge cases
    if (regionWidth < labelWidth || regionHeight < labelHeight) {
      return { windowMax: [], windowMin: [] };
    }

    const imageHeight = image.length;
    const imageWidth = image[0]?.length || 0;

    // Step 1: Horizontal pass - compute row-wise min/max for each row in region
    const rowMax: number[][] = [];
    const rowMin: number[][] = [];

    for (let dy = 0; dy < regionHeight; dy++) {
      const y = regionY + dy;
      if (y < 0 || y >= imageHeight) {
        // Out of bounds - use empty arrays
        rowMax[dy] = [];
        rowMin[dy] = [];
        continue;
      }

      // Extract the row slice from the region
      const rowSlice: number[] = [];
      for (let dx = 0; dx < regionWidth; dx++) {
        const x = regionX + dx;
        // Use 0 for out of bounds pixels (they'll fail uniformity check)
        rowSlice.push(x >= 0 && x < imageWidth ? (image[y][x] ?? 0) : 0);
      }

      const { maxResults, minResults } = slidingWindowMinMax(rowSlice, labelWidth);
      rowMax[dy] = maxResults;
      rowMin[dy] = minResults;
    }

    // Step 2: Vertical pass - compute column-wise min/max on intermediate buffers
    const resultWidth = regionWidth - labelWidth + 1;
    const resultHeight = regionHeight - labelHeight + 1;

    if (resultWidth <= 0 || resultHeight <= 0) {
      return { windowMax: [], windowMin: [] };
    }

    const windowMax: number[][] = [];
    const windowMin: number[][] = [];

    for (let x = 0; x < resultWidth; x++) {
      // Extract column from intermediate buffers
      const colMax: number[] = [];
      const colMin: number[] = [];
      for (let y = 0; y < regionHeight; y++) {
        colMax.push(rowMax[y]?.[x] ?? 0);
        colMin.push(rowMin[y]?.[x] ?? 255);
      }

      const { maxResults: colMaxResults } = slidingWindowMinMax(colMax, labelHeight);
      const { minResults: colMinResults } = slidingWindowMinMax(colMin, labelHeight);

      for (let y = 0; y < resultHeight; y++) {
        if (!windowMax[y]) windowMax[y] = [];
        if (!windowMin[y]) windowMin[y] = [];
        windowMax[y][x] = colMaxResults[y] ?? 0;
        windowMin[y][x] = colMinResults[y] ?? 255;
      }
    }

    return { windowMax, windowMin };
  }

  /**
   * Draw a border on the grayscale image.
   * Used to mark element bounding boxes after they've been processed.
   *
   * @param image - Grayscale image (modified in place)
   * @param x - Left edge of the border
   * @param y - Top edge of the border
   * @param width - Width of the bordered region
   * @param height - Height of the bordered region
   * @param borderWidth - Width of the border in pixels (default 2)
   * @param borderColor - Gray value for the border (default 128)
   */
  function drawBorderOnImage(
    image: number[][],
    x: number,
    y: number,
    width: number,
    height: number,
    borderWidth = 2,
    borderColor = 128
  ): void {
    const imageHeight = image.length;
    const imageWidth = image[0]?.length || 0;

    const x1 = Math.floor(x);
    const y1 = Math.floor(y);
    const x2 = Math.floor(x + width);
    const y2 = Math.floor(y + height);

    // Top edge
    for (let dy = 0; dy < borderWidth; dy++) {
      const py = y1 + dy;
      if (py >= 0 && py < imageHeight) {
        for (let px = x1; px < x2; px++) {
          if (px >= 0 && px < imageWidth) {
            image[py][px] = borderColor;
          }
        }
      }
    }

    // Bottom edge
    for (let dy = 0; dy < borderWidth; dy++) {
      const py = y2 - 1 - dy;
      if (py >= 0 && py < imageHeight) {
        for (let px = x1; px < x2; px++) {
          if (px >= 0 && px < imageWidth) {
            image[py][px] = borderColor;
          }
        }
      }
    }

    // Left edge (excluding corners)
    for (let py = y1 + borderWidth; py < y2 - borderWidth; py++) {
      if (py >= 0 && py < imageHeight) {
        for (let dx = 0; dx < borderWidth; dx++) {
          const px = x1 + dx;
          if (px >= 0 && px < imageWidth) {
            image[py][px] = borderColor;
          }
        }
      }
    }

    // Right edge (excluding corners)
    for (let py = y1 + borderWidth; py < y2 - borderWidth; py++) {
      if (py >= 0 && py < imageHeight) {
        for (let dx = 0; dx < borderWidth; dx++) {
          const px = x2 - 1 - dx;
          if (px >= 0 && px < imageWidth) {
            image[py][px] = borderColor;
          }
        }
      }
    }
  }

  /**
   * Mark a region as occupied with a striped pattern (0, 255, 0, 255...).
   * This guarantees max - min = 255 > tolerance, blocking any future label placement.
   *
   * Called after an element is done processing (bbox + label placed).
   *
   * @param image - Grayscale image (modified in place)
   * @param x1 - Left edge of element bbox
   * @param y1 - Top edge of element bbox
   * @param x2 - Right edge of element bbox
   * @param y2 - Bottom edge of element bbox
   * @param labelX - Label top-left X
   * @param labelY - Label top-left Y
   * @param labelW - Label width
   * @param labelH - Label height
   */
  function markRegionAsOccupied(
    image: number[][],
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    labelX: number,
    labelY: number,
    labelW: number,
    labelH: number
  ): void {
    const imageHeight = image.length;
    const imageWidth = image[0]?.length || 0;

    // Compute combined region (element + label)
    const minX = Math.floor(Math.min(x1, labelX));
    const minY = Math.floor(Math.min(y1, labelY));
    const maxX = Math.floor(Math.max(x2, labelX + labelW));
    const maxY = Math.floor(Math.max(y2, labelY + labelH));

    // Fill with interleaving 0, 255 pattern to guarantee non-uniformity
    for (let py = minY; py < maxY; py++) {
      if (py >= 0 && py < imageHeight) {
        for (let px = minX; px < maxX; px++) {
          if (px >= 0 && px < imageWidth) {
            image[py][px] = ((px + py) % 2 === 0) ? 0 : 255;
          }
        }
      }
    }
  }

  /**
   * Find a valid label position using dynamic convolution on grayscale image.
   *
   * Algorithm:
   * 1. Define candidate region based on element bbox and label dimensions
   * 2. Compute 2D min/max over the region using sliding window
   * 3. Find first position where max - min <= tolerance (uniform region)
   * 4. Return that position or fallback
   *
   * @param elementRect - The element's bounding rect
   * @param labelW - Label width in pixels
   * @param labelH - Label height in pixels
   * @returns Position { x, y } for label top-left corner and whether grayscale was used
   */
  function findLabelPosition(
    elementRect: { x: number; y: number; width: number; height: number },
    labelW: number,
    labelH: number
  ): { x: number; y: number; usedGrayscale: boolean } {
    // If no grayscale image available, return fallback
    if (!grayscaleImage || grayscaleImage.length === 0) {
      return {
        x: Math.max(0, elementRect.x),
        y: Math.max(0, elementRect.y),
        usedGrayscale: false,
      };
    }

    const imageHeight = grayscaleImage.length;
    const imageWidth = grayscaleImage[0]?.length || 0;

    if (imageWidth === 0) {
      return {
        x: Math.max(0, elementRect.x),
        y: Math.max(0, elementRect.y),
        usedGrayscale: false,
      };
    }

    const { x: X, y: Y, width: N, height: M } = elementRect;
    const x1 = Math.floor(X);
    const y1 = Math.floor(Y);
    const x2 = Math.floor(X + N);
    const y2 = Math.floor(Y + M);

    // Define candidate region:
    // Label can be placed from (x1 - labelW, y1 - labelH) to (x2, y2)
    // This ensures label can touch any edge of the element
    // +1 on right/bottom to allow labels adjacent to (not overlapping) the border
    const regionX = Math.max(0, x1 - labelW);
    const regionY = Math.max(0, y1 - labelH);
    const regionX2 = Math.min(imageWidth, x2 + labelW);
    const regionY2 = Math.min(imageHeight, y2 + labelH);
    const regionWidth = regionX2 - regionX;
    const regionHeight = regionY2 - regionY;

    // Compute 2D min/max for the candidate region
    const { windowMax, windowMin } = compute2DMinMaxInRegion(
      grayscaleImage,
      regionX,
      regionY,
      regionWidth,
      regionHeight,
      labelW,
      labelH
    );

    if (windowMax.length === 0 || windowMin.length === 0) {
      // Region too small for label, use fallback
      const fallbackX = Math.max(0, Math.min(imageWidth - labelW, x2 - labelW));
      const fallbackY = Math.max(0, y1 - labelH);
      return { x: fallbackX, y: fallbackY, usedGrayscale: true };
    }

    // Search for a uniform position (max - min <= tolerance)
    // Prefer positions near element center
    const resultHeight = windowMax.length;
    const resultWidth = windowMax[0]?.length || 0;

    // Calculate center of candidate region (in result coordinates)
    const centerResultX = Math.floor(resultWidth / 2);
    const centerResultY = Math.floor(resultHeight / 2);

    // BFS from center to find nearest uniform position
    const visited = new Set<string>();
    const queue: Array<{ rx: number; ry: number }> = [{ rx: centerResultX, ry: centerResultY }];

    while (queue.length > 0) {
      const pos = queue.shift()!;
      const key = `${pos.rx},${pos.ry}`;

      if (visited.has(key)) continue;
      visited.add(key);

      // Skip if already visited too many positions (performance limit)
      if (visited.size > 5000) break;

      // Check bounds
      if (pos.rx < 0 || pos.rx >= resultWidth || pos.ry < 0 || pos.ry >= resultHeight) continue;

      // Convert result coordinates to absolute image coordinates
      const absX = regionX + pos.rx;
      const absY = regionY + pos.ry;

      // Check uniformity: max - min <= tolerance
      const maxVal = windowMax[pos.ry]?.[pos.rx] ?? 255;
      const minVal = windowMin[pos.ry]?.[pos.rx] ?? 0;
      const diff = maxVal - minVal;

      if (diff <= uniformityTolerance) {
        // Uniform position found!
        return { x: absX, y: absY, usedGrayscale: true };
      }

      // Position not uniform, keep searching
      queue.push({ rx: pos.rx - 1, ry: pos.ry });
      queue.push({ rx: pos.rx + 1, ry: pos.ry });
      queue.push({ rx: pos.rx, ry: pos.ry - 1 });
      queue.push({ rx: pos.rx, ry: pos.ry + 1 });
    }

    // No uniform position found - fallback to outside element (top-right)
    const fallbackX = Math.max(0, Math.min(imageWidth - labelW, x2 - labelW));
    const fallbackY = Math.max(0, y1 - labelH);
    return { x: fallbackX, y: fallbackY, usedGrayscale: true };
  }

  /**
   * Mark both the element and label region as occupied after processing.
   * This prevents future labels from overlapping with already-labeled elements.
   *
   * In post-order traversal, children are labeled first. By marking the combined
   * region as occupied, we ensure parent labels don't cross child element areas.
   */
  function markElementAndLabelAsOccupied(
    elementRect: { x: number; y: number; width: number; height: number },
    labelX: number,
    labelY: number,
    labelW: number,
    labelH: number
  ): void {
    if (!grayscaleImage) return;

    const { x, y, width, height } = elementRect;
    markRegionAsOccupied(
      grayscaleImage,
      Math.floor(x),
      Math.floor(y),
      Math.floor(x + width),
      Math.floor(y + height),
      Math.floor(labelX),
      Math.floor(labelY),
      labelW,
      labelH
    );
  }

  // Data structure for deferred highlighting with tree-based flow detection
  interface ElementToHighlight {
    element: HTMLElement;
    index: number;
    parentIframe: HTMLIFrameElement | null;
  }
  const elementsToHighlight: ElementToHighlight[] = [];

  /**
   * Reorder elements for post-order traversal (children before parents).
   * This ensures child elements get their labels placed before their parent containers.
   *
   * Builds a tree based on actual DOM ancestry between highlighted elements,
   * not the layout parent grouping used for flow detection.
   */
  function getPostOrderElements(elements: ElementToHighlight[]): ElementToHighlight[] {
    if (elements.length === 0) return [];

    // Build set of highlighted elements for quick lookup
    const highlightedSet = new Set<HTMLElement>();
    for (const info of elements) {
      highlightedSet.add(info.element);
    }

    // For each element, find its nearest highlighted ancestor (if any)
    // This builds a tree of highlighted elements based on DOM ancestry
    const childrenOfHighlighted = new Map<HTMLElement | null, HTMLElement[]>();

    for (const info of elements) {
      let highlightedParent: HTMLElement | null = null;
      let current: Element | null = info.element.parentElement;

      // Walk up the DOM to find nearest highlighted ancestor
      while (current && current !== document.body) {
        if (highlightedSet.has(current as HTMLElement)) {
          highlightedParent = current as HTMLElement;
          break;
        }
        current = current.parentElement;
      }

      // Group elements by their highlighted parent
      if (!childrenOfHighlighted.has(highlightedParent)) {
        childrenOfHighlighted.set(highlightedParent, []);
      }
      childrenOfHighlighted.get(highlightedParent)!.push(info.element);
    }

    // Build element -> ElementToHighlight lookup
    const elementToInfo = new Map<HTMLElement, ElementToHighlight>();
    for (const info of elements) {
      elementToInfo.set(info.element, info);
    }

    // Recursive post-order collection
    const result: ElementToHighlight[] = [];
    const visited = new Set<HTMLElement>();

    function visit(element: HTMLElement) {
      if (visited.has(element)) return;
      visited.add(element);

      // First, visit all highlighted children (post-order: children before parent)
      const children = childrenOfHighlighted.get(element) || [];
      for (const child of children) {
        visit(child);
      }

      // Then add this element
      const info = elementToInfo.get(element);
      if (info) result.push(info);
    }

    // Start from roots (elements with no highlighted parent)
    const roots = childrenOfHighlighted.get(null) || [];
    for (const root of roots) {
      visit(root);
    }

    return result;
  }

  /**
   * Element info stored after box creation for later label creation.
   */
  interface ElementRenderInfo {
    element: HTMLElement;
    index: number;
    parentIframe: HTMLIFrameElement | null;
    elementRect: { x: number; y: number; width: number; height: number };
    color: string;
    container: HTMLElement;
  }

  /**
   * Process elements in recursive tree order:
   * - Pre-order: Create bounding boxes and mark in hot map
   * - Post-order: Create labels and mark in hot map
   *
   * This ensures children's boxes are visible before parent places its label,
   * and children's labels are placed before parent's label.
   */
  // Collected element data during boxes phase, for return
  const collectedElementData: ElementRenderData[] = [];

  function processElementTreeRecursively(
    elements: ElementToHighlight[]
  ): void {
    if (elements.length === 0) return;

    // Build tree structure based on DOM ancestry (same as getPostOrderElements)
    const highlightedSet = new Set<HTMLElement>();
    for (const info of elements) {
      highlightedSet.add(info.element);
    }

    const childrenOfHighlighted = new Map<HTMLElement | null, HTMLElement[]>();
    for (const info of elements) {
      let highlightedParent: HTMLElement | null = null;
      let current: Element | null = info.element.parentElement;

      while (current && current !== document.body) {
        if (highlightedSet.has(current as HTMLElement)) {
          highlightedParent = current as HTMLElement;
          break;
        }
        current = current.parentElement;
      }

      if (!childrenOfHighlighted.has(highlightedParent)) {
        childrenOfHighlighted.set(highlightedParent, []);
      }
      childrenOfHighlighted.get(highlightedParent)!.push(info.element);
    }

    // Build element -> ElementToHighlight lookup
    const elementToInfo = new Map<HTMLElement, ElementToHighlight>();
    for (const info of elements) {
      elementToInfo.set(info.element, info);
    }

    // Get or create highlight container
    let container = document.getElementById(HIGHLIGHT_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = HIGHLIGHT_CONTAINER_ID;
      container.style.position = "fixed";
      container.style.pointerEvents = "none";
      container.style.top = "0";
      container.style.left = "0";
      container.style.width = "100%";
      container.style.height = "100%";
      container.style.zIndex = "2147483647";
      container.style.backgroundColor = 'transparent';
      document.body.appendChild(container);
    }

    // Store element info after box creation for later label creation
    const renderInfoMap = new Map<HTMLElement, ElementRenderInfo>();

    // Recursive function that processes elements in correct order
    function processElement(element: HTMLElement): void {
      const info = elementToInfo.get(element);
      if (!info) return;

      // === PRE-ORDER: Create bounding box ===
      const renderInfo = createBoundingBoxForElement(
        info.element,
        info.index,
        info.parentIframe,
        container!
      );

      if (renderInfo) {
        renderInfoMap.set(element, renderInfo);

        // In boxes phase, collect element data for return (no grayscale drawing needed)
        if (phase === 'boxes') {
          collectedElementData.push({
            index: renderInfo.index,
            xpath: getXPathTree(info.element),
            rect: { ...renderInfo.elementRect },
            color: renderInfo.color,
          });
        }

        // In legacy mode (no phase), draw border on grayscale image
        // This ensures child labels don't get placed crossing this element's border
        if (!phase && grayscaleImage) {
          drawBorderOnImage(
            grayscaleImage,
            renderInfo.elementRect.x,
            renderInfo.elementRect.y,
            renderInfo.elementRect.width,
            renderInfo.elementRect.height,
            2,  // borderWidth
            128 // borderColor (mid-gray to break uniformity)
          );
        }
      }

      // === RECURSE: Process children ===
      const children = childrenOfHighlighted.get(element) || [];
      for (const child of children) {
        processElement(child);
      }

      // === POST-ORDER: Create label (skip in boxes phase) ===
      if (renderInfo && phase !== 'boxes') {
        createLabelForElement(renderInfo);
      }
    }

    // Process roots (elements with no highlighted parent)
    const roots = childrenOfHighlighted.get(null) || [];
    for (const root of roots) {
      processElement(root);
    }
  }

  /**
   * Process labels phase using pre-collected element data.
   * Called when phase === 'labels' with inputElementData.
   */
  function processLabelsPhase(): void {
    if (!inputElementData || inputElementData.length === 0) return;

    streamLog(`[dom-tree] Labels phase: processing ${inputElementData.length} elements`);

    // Get or create highlight container (should already exist from boxes phase)
    let container = document.getElementById(HIGHLIGHT_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = HIGHLIGHT_CONTAINER_ID;
      container.style.position = "fixed";
      container.style.pointerEvents = "none";
      container.style.top = "0";
      container.style.left = "0";
      container.style.width = "100%";
      container.style.height = "100%";
      container.style.zIndex = "2147483647";
      container.style.backgroundColor = 'transparent';
      document.body.appendChild(container);
    }

    // Sort by index to maintain correct order
    const sortedData = [...inputElementData].sort((a, b) => a.index - b.index);

    // Create labels for each element
    for (const data of sortedData) {
      const renderInfo: ElementRenderInfo = {
        element: null as any, // Not needed for label creation
        index: data.index,
        parentIframe: null,
        elementRect: data.rect,
        color: data.color,
        container,
      };
      createLabelForElement(renderInfo);
    }
  }

  /**
   * Create bounding box overlays for an element and append to container.
   * Returns element render info for later label creation.
   */
  function createBoundingBoxForElement(
    element: HTMLElement,
    index: number,
    parentIframe: HTMLIFrameElement | null,
    container: HTMLElement
  ): ElementRenderInfo | null {
    if (!element) return null;

    // Get element client rects
    let rects: DOMRectList | TransformedRect[] = element.getClientRects();
    if (!rects || rects.length === 0) return null;

    // Transform rects if inside an iframe
    if (parentIframe) {
      const transformedRects: TransformedRect[] = [];
      const iframeRect = parentIframe.getBoundingClientRect();
      const iframeStyle = window.getComputedStyle(parentIframe);
      const borderLeft = parseFloat(iframeStyle.borderLeftWidth) || 0;
      const borderTop = parseFloat(iframeStyle.borderTopWidth) || 0;
      const paddingLeft = parseFloat(iframeStyle.paddingLeft) || 0;
      const paddingTop = parseFloat(iframeStyle.paddingTop) || 0;
      const contentOffsetX = borderLeft + paddingLeft;
      const contentOffsetY = borderTop + paddingTop;

      let scaleX = 1, scaleY = 1;
      const transform = iframeStyle.transform;
      if (transform && transform !== 'none') {
        const scaleMatch = transform.match(/scale\(([^)]+)\)/);
        if (scaleMatch) {
          const scaleValues = scaleMatch[1].split(',').map(v => parseFloat(v.trim()));
          scaleX = scaleValues[0] || 1;
          scaleY = scaleValues[1] || scaleX;
        } else {
          const matrixMatch = transform.match(/matrix\(([^)]+)\)/);
          if (matrixMatch) {
            const values = matrixMatch[1].split(',').map(v => parseFloat(v.trim()));
            if (values.length >= 6) {
              scaleX = values[0];
              scaleY = values[3];
            }
          }
        }
      }

      let scrollLeft = 0, scrollTop = 0;
      try {
        const iframeDoc = parentIframe.contentDocument || parentIframe.contentWindow?.document;
        if (iframeDoc) {
          scrollLeft = iframeDoc.documentElement?.scrollLeft || iframeDoc.body?.scrollLeft || 0;
          scrollTop = iframeDoc.documentElement?.scrollTop || iframeDoc.body?.scrollTop || 0;
        }
      } catch (e) {
        console.warn("Cannot access iframe scroll position:", e);
      }

      for (const rect of rects) {
        const scaledWidth = rect.width * scaleX;
        const scaledHeight = rect.height * scaleY;
        const scaledTop = rect.top * scaleY;
        const scaledLeft = rect.left * scaleX;
        const scaledScrollTop = scrollTop * scaleY;
        const scaledScrollLeft = scrollLeft * scaleX;

        transformedRects.push({
          top: scaledTop + iframeRect.top + contentOffsetY - scaledScrollTop,
          left: scaledLeft + iframeRect.left + contentOffsetX - scaledScrollLeft,
          bottom: scaledTop + scaledHeight + iframeRect.top + contentOffsetY - scaledScrollTop,
          right: scaledLeft + scaledWidth + iframeRect.left + contentOffsetX - scaledScrollLeft,
          width: scaledWidth,
          height: scaledHeight,
          x: scaledLeft + iframeRect.left + contentOffsetX - scaledScrollLeft,
          y: scaledTop + iframeRect.top + contentOffsetY - scaledScrollTop
        });
      }
      rects = transformedRects;
    }

    // Generate color based on index
    const colors = [
      "#E53935", "#1E88E5", "#7B1FA2", "#00897B", "#F4511E",
      "#3949AB", "#C2185B", "#00796B", "#5E35B1", "#D81B60",
      "#039BE5", "#388E3C"
    ];
    const color = colors[index % colors.length];

    // Create bounding box overlays
    for (const rect of rects) {
      if (rect.width === 0 || rect.height === 0) continue;

      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.border = `1px solid ${color}`;
      overlay.style.backgroundColor = "none";
      overlay.style.pointerEvents = "none";
      overlay.style.boxSizing = "border-box";
      overlay.setAttribute("data-element-index", String(index));
      overlay.style.top = `${rect.top}px`;
      overlay.style.left = `${rect.left}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;

      container.appendChild(overlay);
    }

    // Return element info for label creation
    const firstRect = rects[0];
    return {
      element,
      index,
      parentIframe,
      elementRect: {
        x: firstRect.left,
        y: firstRect.top,
        width: firstRect.width,
        height: firstRect.height
      },
      color,
      container
    };
  }

  /**
   * Create and position label for an element and append to container.
   */
  function createLabelForElement(renderInfo: ElementRenderInfo): void {
    const { index, elementRect, color, container } = renderInfo;

    // Capture BEFORE snapshot if debug mode enabled (stream via callback)
    streamLog(`[dom-tree] Element ${index}: captureDebugSnapshots=${captureDebugSnapshots}, hasGrayscale=${!!grayscaleImage}, hasOnSnapshot=${!!onSnapshot}`);
    if (captureDebugSnapshots && grayscaleImage && onSnapshot) {
      streamLog(`[dom-tree] Calling onSnapshot for element ${index} (before)`);
      onSnapshot({ elementIndex: index, type: 'before', data: grayscaleImage.map(row => [...row]) });
    }

    // Calculate label dimensions based on digit count
    const digits = index.toString().length;
    const labelWidth = (digits * 8) + 8;
    const labelHeight = 16;

    // Find label position using grayscale image or fallback to heuristics
    let labelTop = 0;
    let labelLeft = 0;

    const grayscaleResult = findLabelPosition(elementRect, labelWidth, labelHeight);

    if (grayscaleResult.usedGrayscale) {
      labelTop = grayscaleResult.y;
      labelLeft = grayscaleResult.x;
    } else {
      // Fallback to heuristic positioning (assume vertical flow)
      const isNarrow = elementRect.width <= 32;
      const centerX = elementRect.x + elementRect.width / 2;

      let positions: Array<{ top: number; anchorX: number; hAlign: 'left' | 'right' | 'center'; name: string }>;

      if (isNarrow) {
        positions = [
          { top: elementRect.y + (elementRect.height - labelHeight) / 2, anchorX: elementRect.x, hAlign: 'right', name: 'left' },
          { top: elementRect.y + (elementRect.height - labelHeight) / 2, anchorX: elementRect.x + elementRect.width, hAlign: 'left', name: 'right' },
          { top: elementRect.y - labelHeight, anchorX: centerX, hAlign: 'center', name: 'top' },
          { top: elementRect.y + elementRect.height, anchorX: centerX, hAlign: 'center', name: 'bottom' },
        ];
      } else {
        positions = [
          { top: elementRect.y + (elementRect.height - labelHeight) / 2, anchorX: elementRect.x, hAlign: 'right', name: 'left' },
          { top: elementRect.y + (elementRect.height - labelHeight) / 2, anchorX: elementRect.x + elementRect.width, hAlign: 'left', name: 'right' },
          { top: elementRect.y - labelHeight, anchorX: elementRect.x + elementRect.width, hAlign: 'right', name: 'top-right' },
          { top: elementRect.y - labelHeight, anchorX: elementRect.x, hAlign: 'left', name: 'top-left' },
        ];
      }

      // Use first position as default
      const pos = positions[0];
      labelTop = Math.max(0, Math.min(pos.top, window.innerHeight - labelHeight));
      if (pos.hAlign === 'right') {
        labelLeft = pos.anchorX - labelWidth;
      } else if (pos.hAlign === 'center') {
        labelLeft = pos.anchorX - labelWidth / 2;
      } else {
        labelLeft = pos.anchorX;
      }
      labelLeft = Math.max(0, Math.min(labelLeft, window.innerWidth - labelWidth));
    }

    // Always mark the label position on grayscale image to prevent future overlaps
    markElementAndLabelAsOccupied(elementRect, labelLeft, labelTop, labelWidth, labelHeight);

    // Capture AFTER snapshot if debug mode enabled (stream via callback)
    if (captureDebugSnapshots && grayscaleImage && onSnapshot) {
      streamLog(`[dom-tree] Calling onSnapshot for element ${index} (after)`);
      onSnapshot({ elementIndex: index, type: 'after', data: grayscaleImage.map(row => [...row]) });
    }

    // Create label element with explicit dimensions matching theoretical calculation
    const label = document.createElement("div");
    label.className = "playwright-highlight-label";
    label.style.position = "fixed";
    label.style.background = color;
    label.style.color = "white";
    label.style.padding = "1px 4px";
    label.style.fontSize = "12px";
    label.style.width = `${labelWidth}px`;
    label.style.height = `${labelHeight}px`;
    label.style.boxSizing = "border-box";
    label.style.textAlign = "center";
    label.style.lineHeight = `${labelHeight - 2}px`;
    label.textContent = String(index);
    label.setAttribute("data-element-index", String(index));
    label.style.top = `${labelTop}px`;
    label.style.left = `${labelLeft}px`;

    container.appendChild(label);
  }

  /**
   * Build tree entries for debug output showing element hierarchy.
   *
   * The tree collapses single-child chains: if A contains only B, which contains only C (highlighted),
   * then A, B, C collapse into just C.
   *
   * Parents are only included if they have more than one highlighted descendant.
   */
  function buildTreeEntries(): TreeEntry[] {
    const treeEntries: TreeEntry[] = [];

    if (elementsToHighlight.length === 0) return treeEntries;

    // For each highlighted element, find all ancestors and count highlighted descendants
    const ancestorCounts = new Map<Element, number>();

    for (const { element } of elementsToHighlight) {
      let current: Element | null = element.parentElement;
      while (current && current !== document.body) {
        ancestorCounts.set(current, (ancestorCounts.get(current) || 0) + 1);
        current = current.parentElement;
      }
    }

    // Build tree structure: map each element to its layout parent
    const childrenMap = new Map<Element | null, HTMLElement[]>(); // parent -> children

    for (const { element } of elementsToHighlight) {
      let layoutParent: Element | null = null;
      let current: Element | null = element.parentElement;

      while (current && current !== document.body) {
        const count = ancestorCounts.get(current) || 0;
        if (count > 1) {
          layoutParent = current;
          break;
        }
        current = current.parentElement;
      }

      // Group children by parent
      if (!childrenMap.has(layoutParent)) {
        childrenMap.set(layoutParent, []);
      }
      childrenMap.get(layoutParent)!.push(element);
    }

    // Output tree structure to debug logs and build tree entries
    const elementToIndex = new Map<HTMLElement, number>();
    for (const { element, index } of elementsToHighlight) {
      elementToIndex.set(element, index);
    }

    const describeElement = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const cls = el.className && typeof el.className === 'string'
        ? '.' + el.className.split(' ').slice(0, 2).join('.')
        : '';
      return `<${tag}${id}${cls.slice(0, 30)}>`;
    };

    debugLog(`[Tree] Detected elements tree:`);

    // Get unique layout parents and sort by DOM order
    const parents = Array.from(childrenMap.keys());

    for (const parent of parents) {
      const children = childrenMap.get(parent) || [];
      const parentDesc = parent ? describeElement(parent) : '(root)';

      debugLog(`[Tree] ${parentDesc}`);

      // Add parent entry to tree
      treeEntries.push({
        type: 'parent',
        label: parentDesc,
      });

      for (const child of children) {
        const idx = elementToIndex.get(child) ?? -1;
        debugLog(`[Tree]   [${idx}] ${describeElement(child)}`);

        // Add element entry to tree
        treeEntries.push({
          type: 'element',
          highlightIndex: idx,
          label: describeElement(child),
        });
      }
    }

    return treeEntries;
  }

  /**
   * Gets the position of an element in its parent.
   */
  function getElementPosition(currentElement: Element): number {
    if (!currentElement.parentElement) {
      return 0; // No parent means no siblings
    }

    const tagName = currentElement.nodeName.toLowerCase();

    const siblings = Array.from(currentElement.parentElement.children)
      .filter((sib) => sib.nodeName.toLowerCase() === tagName);

    if (siblings.length === 1) {
      return 0; // Only element of its type
    }

    const index = siblings.indexOf(currentElement) + 1; // 1-based index
    return index;
  }


  function getXPathTree(element: Element, stopAtBoundary: boolean = true): string {
    if (xpathCache.has(element)) return xpathCache.get(element)!;

    const segments: string[] = [];
    let currentElement: Node | null = element;

    while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
      // Stop if we hit a shadow root or iframe
      if (
        stopAtBoundary &&
        (currentElement.parentNode instanceof ShadowRoot ||
          currentElement.parentNode instanceof HTMLIFrameElement)
      ) {
        break;
      }

      const position = getElementPosition(currentElement as Element);
      const tagName = currentElement.nodeName.toLowerCase();
      const xpathIndex = position > 0 ? `[${position}]` : "";
      segments.unshift(`${tagName}${xpathIndex}`);

      currentElement = currentElement.parentNode;
    }

    const result = segments.join("/");
    xpathCache.set(element, result);
    return result;
  }

  /**
   * Checks if a text node is visible.
   */
  function isTextNodeVisible(textNode: Text): boolean {
    try {
      // Special case: when viewportExpansion is -1, consider all text nodes as visible
      if (viewportExpansion === -1) {
        // Still check parent visibility for basic filtering
        const parentElement = textNode.parentElement;
        if (!parentElement) return false;

        try {
          return parentElement.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          });
        } catch (e) {
          // Fallback if checkVisibility is not supported
          const style = window.getComputedStyle(parentElement);
          return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0';
        }
      }

      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rects = range.getClientRects(); // Use getClientRects for Range

      if (!rects || rects.length === 0) {
        return false;
      }

      let isAnyRectVisible = false;
      let isAnyRectInViewport = false;

      for (const rect of rects) {
        // Check size
        if (rect.width > 0 && rect.height > 0) {
          isAnyRectVisible = true;

          // Viewport check for this rect
          if (!(
            rect.bottom < -viewportExpansion ||
            rect.top > window.innerHeight + viewportExpansion ||
            rect.right < -viewportExpansion ||
            rect.left > window.innerWidth + viewportExpansion
          )) {
            isAnyRectInViewport = true;
            break; // Found a visible rect in viewport, no need to check others
          }
        }
      }

      if (!isAnyRectVisible || !isAnyRectInViewport) {
        return false;
      }

      // Check parent visibility
      const parentElement = textNode.parentElement;
      if (!parentElement) return false;

      try {
        return parentElement.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        });
      } catch (e) {
        // Fallback if checkVisibility is not supported
        const style = window.getComputedStyle(parentElement);
        return style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0';
      }
    } catch (e) {
      console.warn('Error checking text node visibility:', e);
      return false;
    }
  }

  /**
   * Checks if an element is accepted.
   */
  function isElementAccepted(element: Element): boolean {
    if (!element || !element.tagName) return false;

    // Always accept body and common container elements
    const alwaysAccept = new Set([
      "body", "div", "main", "article", "section", "nav", "header", "footer"
    ]);
    const tagName = element.tagName.toLowerCase();

    if (alwaysAccept.has(tagName)) return true;

    const leafElementDenyList = new Set([
      "svg",
      "script",
      "style",
      "link",
      "meta",
      "noscript",
      "template",
    ]);

    return !leafElementDenyList.has(tagName);
  }

  /**
   * Checks if an element is visible.
   */
  function isElementVisible(element: HTMLElement): boolean {
    if (alwaysHighlightFileInput && element.tagName.toLowerCase() === "input" && (element as HTMLInputElement).type === "file") return true;

    // SVG elements need special handling for visibility
    if (element.tagName.toLowerCase() === "svg") {
      const rect = getCachedBoundingRect(element);
      const style = getCachedComputedStyle(element);
      return (
        rect !== null &&
        rect.width > 0 &&
        rect.height > 0 &&
        style?.visibility !== "hidden" &&
        style?.display !== "none"
      );
    }

    const style = getCachedComputedStyle(element);
    return (
      element.offsetWidth > 0 &&
      element.offsetHeight > 0 &&
      style?.visibility !== "hidden" &&
      style?.display !== "none"
    );
  }

  /**
   * Checks if an element is clickable (responds to click events).
   */
  function shouldMarkAsClickable(element: Element): boolean {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const tagName = element.tagName.toLowerCase();

    // Primarily clickable elements
    const primaryClickableElements = new Set([
      "a",          // Links
      "button",     // Buttons
      "summary",    // Summary element (clickable part of details)
      "label",      // Form labels (often clickable)
      "option",     // Select options
      "optgroup",   // Option groups
    ]);

    if (primaryClickableElements.has(tagName)) {
      return false;
    }

    const role = element.getAttribute("role");

    // Clickable roles
    const clickableRoles = new Set([
      'button',           // Directly clickable element
      'link',            // Clickable link
      'menuitem',        // Clickable menu item
      'menuitemradio',   // Radio-style menu item (selectable)
      'menuitemcheckbox', // Checkbox-style menu item (toggleable)
      'radio',           // Radio button (selectable)
      'checkbox',        // Checkbox (toggleable)
      'tab',             // Tab (clickable to switch content)
      'switch',          // Toggle switch (clickable to change state)
      'option',          // Selectable option in a list
    ]);

    if (role && clickableRoles.has(role)) {
      return true;
    }

    // Check for dropdown indicators
    if (hasAnyClassName(element, buttonClassNames)) {
      return true; // Return true for dropdown elements
    }

    if (
      element.getAttribute('data-toggle') === 'dropdown' ||
      element.getAttribute('aria-haspopup')
    ) {
      return true;
    }

    const clickEvents = ['click', 'mousedown', 'mouseup', 'dblclick'];
    const listenedEvents = getCachedNodeEventListeners(element);
    if (listenedEvents && listenedEvents.length > 0) {
      for (const eventType of clickEvents) {
        if (listenedEvents.includes(eventType)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Checks if an element is interactive.
   *
   * lots of comments, and uncommented code - to show the logic of what we already tried
   *
   * One of the things we tried at the beginning was also to use event listeners, and other fancy class, style stuff -> what actually worked best was just combining most things with computed cursor style :)
   */
  function isInteractiveElement(element: Element): boolean {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    // Cache the tagName and style lookups
    const tagName = element.tagName.toLowerCase();
    const style = getCachedComputedStyle(element);

    // Define interactive cursors
    const interactiveCursors = new Set([
      'pointer',    // Link/clickable elements
      'move',       // Movable elements
      'text',       // Text selection
      'grab',       // Grabbable elements
      'grabbing',   // Currently grabbing
      'cell',       // Table cell selection
      'copy',       // Copy operation
      'alias',      // Alias creation
      'all-scroll', // Scrollable content
      'col-resize', // Column resize
      'context-menu', // Context menu available
      'crosshair',  // Precise selection
      'e-resize',   // East resize
      'ew-resize',  // East-west resize
      'help',       // Help available
      'n-resize',   // North resize
      'ne-resize',  // Northeast resize
      'nesw-resize', // Northeast-southwest resize
      'ns-resize',  // North-south resize
      'nw-resize',  // Northwest resize
      'nwse-resize', // Northwest-southeast resize
      'row-resize', // Row resize
      's-resize',   // South resize
      'se-resize',  // Southeast resize
      'sw-resize',  // Southwest resize
      'vertical-text', // Vertical text selection
      'w-resize',   // West resize
      'zoom-in',    // Zoom in
      'zoom-out'    // Zoom out
    ]);

    // Define non-interactive cursors
    const nonInteractiveCursors = new Set([
      'not-allowed', // Action not allowed
      'no-drop',     // Drop not allowed
      'wait',        // Processing
      'progress',    // In progress
      'initial',     // Initial value
      'inherit'      // Inherited value
      //? Let's just include all potentially clickable elements that are not specifically blocked
      // 'none',        // No cursor
      // 'default',     // Default cursor
      // 'auto',        // Browser default
    ]);

    /**
     * Checks if an element has an interactive pointer.
     */
    function doesElementHaveInteractivePointer(element: Element): boolean {
      if (element.tagName.toLowerCase() === "html") return false;

      if (style?.cursor && interactiveCursors.has(style.cursor)) return true;

      return false;
    }
    // Disabled for now, since it adds too many false positives
    // let isInteractiveCursor = doesElementHaveInteractivePointer(element);

    // // Genius fix for almost all interactive elements
    // if (isInteractiveCursor) {
    //   return true;
    // }

    const interactiveElements = new Set([
      "a",          // Links
      "button",     // Buttons
      "input",      // All input types (text, checkbox, radio, etc.)
      "select",     // Dropdown menus
      "textarea",   // Text areas
      "summary",    // Summary element (clickable part of details)
      "label",      // Form labels (often clickable)
      "option",     // Select options
      "optgroup",   // Option groups
      "fieldset",   // Form fieldsets (can be interactive with legend)
      "legend",     // Fieldset legends
    ]);

    // Define explicit disable attributes and properties
    const explicitDisableTags = new Set([
      'disabled',           // Standard disabled attribute
      // 'aria-disabled',      // ARIA disabled state
      // 'readonly',          // Read-only state
      // 'aria-readonly',     // ARIA read-only state
      // 'aria-hidden',       // Hidden from accessibility
      // 'hidden',            // Hidden attribute
      // 'inert',             // Inert attribute
      // 'aria-inert',        // ARIA inert state
      // 'tabindex="-1"',     // Removed from tab order
      // 'aria-hidden="true"' // Hidden from screen readers
    ]);

    // Check for non-interactive cursor
    if (style?.cursor && nonInteractiveCursors.has(style.cursor)) {
      return false;
    }

    // handle inputs, select, checkbox, radio, textarea, button and make sure they are not cursor style disabled/not-allowed
    if (interactiveElements.has(tagName)) {
      // Check for explicit disable attributes
      for (const disableTag of explicitDisableTags) {
        if (element.hasAttribute(disableTag) ||
          element.getAttribute(disableTag) === 'true' ||
          element.getAttribute(disableTag) === '') {
          return false;
        }
      }

      // Check for disabled property on form elements
      if ((element as HTMLInputElement).disabled) {
        return false;
      }

      // Don't mark as non-interactive yet
      // Check for readonly property on form elements
      if ((element as HTMLInputElement).readOnly) {
        // return false;
      }

      // Check for inert property
      if ((element as HTMLElement).inert) {
        return false;
      }

      return true;
    }

    const role = element.getAttribute("role");
    const ariaRole = element.getAttribute("aria-role");

    // Check for contenteditable attribute
    if (element.getAttribute("contenteditable") === "true" || (element as HTMLElement).isContentEditable) {
      return true;
    }

    // Added enhancement to capture dropdown interactive elements
    if (hasAnyClassName(element, buttonClassNames) ||
        hasAnyClassName(element, interactiveClassNames) ||
        hasAnyClassName(element, cursorPointerClassNames) ||
      element.getAttribute('data-index') ||
      element.getAttribute('data-toggle') === 'dropdown' ||
        element.getAttribute('aria-haspopup')) {
      return true;
    }


    const interactiveRoles = new Set([
      'button',           // Directly clickable element
      'link',            // Clickable link
      'menuitem',        // Clickable menu item
      'menuitemradio',   // Radio-style menu item (selectable)
      'menuitemcheckbox', // Checkbox-style menu item (toggleable)
      'radio',           // Radio button (selectable)
      'checkbox',        // Checkbox (toggleable)
      'tab',             // Tab (clickable to switch content)
      'switch',          // Toggle switch (clickable to change state)
      'slider',          // Slider control (draggable)
      'spinbutton',      // Number input with up/down controls
      'combobox',        // Dropdown with text input
      'searchbox',       // Search input field
      'textbox',         // Text input field
      'listbox',         // Selectable list
      'option',          // Selectable option in a list
      'scrollbar'        // Scrollable control
    ]);


    // Basic role/attribute checks
    const hasInteractiveRole =
      (role && interactiveRoles.has(role)) ||
      (ariaRole && interactiveRoles.has(ariaRole));

    if (hasInteractiveRole) return true;

    const listenedEvents = getCachedNodeEventListeners(element);
    if (listenedEvents && listenedEvents.length > 0) {
      for (const eventType of INTERACTION_EVENTS) {
        if (listenedEvents.includes(eventType)) {
          return true;
        }
      }
    }

    return false
  }


  /**
   * Checks if an element is the topmost element at its position.
   */
  function isTopElement(element: Element): boolean {
    // Special case: when viewportExpansion is -1, consider all elements as "top" elements
    if (viewportExpansion === -1) {
      return true;
    }

    const rects = getCachedClientRects(element);

    if (!rects || rects.length === 0) {
      return false; // No geometry, cannot be top
    }

    let isAnyRectInViewport = false;
    for (const rect of rects) {
      // Use the same logic as isInExpandedViewport check
      if (rect.width > 0 && rect.height > 0 && !( // Only check non-empty rects
        rect.bottom < -viewportExpansion ||
        rect.top > window.innerHeight + viewportExpansion ||
        rect.right < -viewportExpansion ||
        rect.left > window.innerWidth + viewportExpansion
      )) {
        isAnyRectInViewport = true;
        break;
      }
    }

    if (!isAnyRectInViewport) {
      return false; // All rects are outside the viewport area
    }


    // Find the correct document context and root element
    let doc = element.ownerDocument;

    // If we're in an iframe, elements are considered top by default
    if (doc !== window.document) {
      return true;
    }

    // For shadow DOM, we need to check within its own root context
    const shadowRoot = element.getRootNode();
    if (shadowRoot instanceof ShadowRoot) {
      const centerX = rects[Math.floor(rects.length / 2)].left + rects[Math.floor(rects.length / 2)].width / 2;
      const centerY = rects[Math.floor(rects.length / 2)].top + rects[Math.floor(rects.length / 2)].height / 2;

      try {
        const topEl = shadowRoot.elementFromPoint(centerX, centerY);
        if (!topEl) return false;

        let current: Element | null = topEl;
        while (current && current !== (shadowRoot as unknown as Element)) {
          if (current === element) return true;
          current = current.parentElement;
        }
        return false;
      } catch (e) {
        return true;
      }
    }

    // For elements in viewport, check if they're topmost
    const centerX = rects[Math.floor(rects.length / 2)].left + rects[Math.floor(rects.length / 2)].width / 2;
    const centerY = rects[Math.floor(rects.length / 2)].top + rects[Math.floor(rects.length / 2)].height / 2;

    try {
      const topEl = document.elementFromPoint(centerX, centerY);
      if (!topEl) return false;

      let current: Element | null = topEl;
      while (current && current !== document.documentElement) {
        if (current === element) return true;
        current = current.parentElement;
      }
      return false;
    } catch (e) {
      return true;
    }
  }

  /**
   * Checks if an element is within the expanded viewport.
   */
  function isInExpandedViewport(element: Element, viewportExpansion: number): boolean {
    if (viewportExpansion === -1) {
      return true;
    }

    const rects = element.getClientRects();

    if (!rects || rects.length === 0) {
      // Fallback to getBoundingClientRect if getClientRects is empty,
      // useful for elements like <svg> that might not have client rects but have a bounding box.
      const boundingRect = getCachedBoundingRect(element);
      if (!boundingRect || boundingRect.width === 0 || boundingRect.height === 0) {
        return false;
      }
      return !(
        boundingRect.bottom < -viewportExpansion ||
        boundingRect.top > window.innerHeight + viewportExpansion ||
        boundingRect.right < -viewportExpansion ||
        boundingRect.left > window.innerWidth + viewportExpansion
      );
    }

    // Check if *any* client rect is within the viewport
    for (const rect of rects) {
      if (rect.width === 0 || rect.height === 0) continue; // Skip empty rects

      if (!(
        rect.bottom < -viewportExpansion ||
        rect.top > window.innerHeight + viewportExpansion ||
        rect.right < -viewportExpansion ||
        rect.left > window.innerWidth + viewportExpansion
      )) {
        return true; // Found at least one rect in the viewport
      }
    }

    return false; // No rects were found in the viewport
  }

  // /**
  //  * Gets the effective scroll of an element.
  //  *
  //  * @param {HTMLElement} element - The element to get the effective scroll for.
  //  * @returns {Object} The effective scroll of the element.
  //  */
  // function getEffectiveScroll(element) {
  //   let currentEl = element;
  //   let scrollX = 0;
  //   let scrollY = 0;

  //   while (currentEl && currentEl !== document.documentElement) {
  //     if (currentEl.scrollLeft || currentEl.scrollTop) {
  //       scrollX += currentEl.scrollLeft;
  //       scrollY += currentEl.scrollTop;
  //     }
  //     currentEl = currentEl.parentElement;
  //   }

  //   scrollX += window.scrollX;
  //   scrollY += window.scrollY;

  //   return { scrollX, scrollY };
  // }

  /**
   * Checks if an element is an interactive candidate.
   */
  function isInteractiveCandidate(element: Element): boolean {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    const tagName = element.tagName.toLowerCase();

    // Fast-path for common interactive elements
    const interactiveElements = new Set([
      "a", "button", "input", "select", "textarea", "summary", "label"
    ]);

    if (interactiveElements.has(tagName)) return true;

    // Quick attribute checks without getting full lists
    const hasQuickInteractiveAttr = element.hasAttribute("onclick") ||
      element.hasAttribute("role") ||
      element.hasAttribute("tabindex") ||
      element.hasAttribute("aria-") ||
      element.hasAttribute("data-action") ||
      element.getAttribute("contenteditable") === "true";

    return hasQuickInteractiveAttr;
  }

  // --- Define constants for distinct interaction check ---
  const DISTINCT_INTERACTIVE_TAGS = new Set([
    'a', 'button', 'input', 'select', 'textarea', 'summary', 'label', 'option'
  ]);
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'menuitem', 'menuitemradio', 'menuitemcheckbox',
    'radio', 'checkbox', 'tab', 'switch', 'slider', 'spinbutton',
    'combobox', 'searchbox', 'textbox', 'listbox', 'option', 'scrollbar'
  ]);


  /**
   * Heuristically determines if an element should be considered as independently interactive,
   * even if it's nested inside another interactive container.
   *
   * This function helps detect deeply nested actionable elements (e.g., menu items within a button)
   * that may not be picked up by strict interactivity checks.
   */
  function isHeuristicallyInteractive(element: Element): boolean {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    // Skip non-visible elements early for performance
    if (!isElementVisible(element as HTMLElement)) return false;

    // Check for common attributes that often indicate interactivity
    const hasInteractiveAttributes =
      element.hasAttribute('role') ||
      element.hasAttribute('tabindex') ||
      element.hasAttribute('onclick') ||
      typeof (element as HTMLElement).onclick === 'function';

    // Check for semantic class names suggesting interactivity
    const hasInteractiveClass = heuristicClassPattern.test(element.className || '');

    // Determine whether the element is inside a known interactive container
    const isInKnownContainer = Boolean(
      element.closest(containerSelectors)
    );

    // Ensure the element has at least one visible child (to avoid marking empty wrappers)
    const hasVisibleChildren = [...element.children].some(child => isElementVisible(child as HTMLElement));

    // Avoid highlighting elements whose parent is <body> (top-level wrappers)
    const isParentBody = element.parentElement && element.parentElement.isSameNode(document.body);

    return (
      (isInteractiveElement(element) || hasInteractiveAttributes || hasInteractiveClass) &&
      hasVisibleChildren &&
      isInKnownContainer &&
      !isParentBody
    );
  }


  /**
   * Checks if an element likely represents a distinct interaction
   * separate from its parent (if the parent is also interactive).
   */
  function isElementDistinctInteraction(element: Element, nodeData: DOMTreeNode): boolean {
    if (nodeData.isScrollable) {
      return true;
    }

    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const tagName = element.tagName.toLowerCase();
    const role = element.getAttribute('role');

    // Check if it's an iframe - always distinct boundary
    if (tagName === 'iframe') {
      return true;
    }

    // Check tag name
    if (DISTINCT_INTERACTIVE_TAGS.has(tagName)) {
      return true;
    }
    // Check interactive roles
    if (role && INTERACTIVE_ROLES.has(role)) {
      return true;
    }
    // Check contenteditable
    if ((element as HTMLElement).isContentEditable || element.getAttribute('contenteditable') === 'true') {
      return true;
    }
    // Check for common testing/automation attributes
    if (element.hasAttribute('data-testid') || element.hasAttribute('data-cy') || element.hasAttribute('data-test')) {
      return true;
    }
    // Check for explicit onclick handler (attribute or property)
    if (element.hasAttribute('onclick') || typeof (element as HTMLElement).onclick === 'function') {
      return true;
    }

    if (element.hasAttribute('aria-haspopup')) {
      return true;
    }

    if (hasAnyClassName(element, interactiveClassNames)) {
      return true;
    }

    // Check for cursor-pointer class names that indicate clickability
    if (hasAnyClassName(element, cursorPointerClassNames)) {
      return true;
    }

    // return false

    // Check for other common interaction event listeners
    try {
      const getEventListenersForNode = (element?.ownerDocument?.defaultView as Window | null)?.getEventListenersForNode || window.getEventListenersForNode;
      if (typeof getEventListenersForNode === 'function') {
        const listeners = getEventListenersForNode(element);
        const interactionEvents = ['click', 'mousedown', 'mouseup', 'dblclick', 'input', 'mouseenter', 'mouseleave', 'keydown', 'keyup', 'submit', 'change', 'focus', 'blur'];
        for (const eventType of interactionEvents) {
          for (const listener of listeners) {
            if (listener.type === eventType) {
              return true; // Found a common interaction listener
            }
          }
        }
      }
      // Fallback: Check common event attributes if getEventListeners is not available (getEventListenersForNode doesn't work in page.evaluate context)
      const commonEventAttrs = ['onmousedown', 'onmouseup', 'onkeydown', 'onkeyup', 'onsubmit', 'onmouseenter', 'onmouseleave', 'onchange', 'oninput', 'onfocus', 'onblur'];
      if (commonEventAttrs.some(attr => element.hasAttribute(attr))) {
        return true;
      }
    } catch (e) {
      // console.warn(`Could not check event listeners for ${element.tagName}:`, e);
      // If checking listeners fails, rely on other checks
    }



    // if the element is not strictly interactive but appears clickable based on heuristic signals
    if (isHeuristicallyInteractive(element)) {
      return true;
    }

    // Default to false: if it's interactive but doesn't match above,
    // assume it triggers the same action as the parent.
    return false;
  }
  // --- End distinct interaction check ---

  /**
   * Calculates Intersection over Union (IoU) for two rectangles.
   * Returns a value between 0 (no overlap) and 1 (identical).
   */
  function calculateIoU(rect1: DOMRect, rect2: DOMRect): number {
    // Calculate intersection
    const xOverlap = Math.max(0, Math.min(rect1.right, rect2.right) - Math.max(rect1.left, rect2.left));
    const yOverlap = Math.max(0, Math.min(rect1.bottom, rect2.bottom) - Math.max(rect1.top, rect2.top));
    const intersectionArea = xOverlap * yOverlap;

    // Calculate union
    const area1 = rect1.width * rect1.height;
    const area2 = rect2.width * rect2.height;
    const unionArea = area1 + area2 - intersectionArea;

    // Avoid division by zero
    if (unionArea === 0) return 0;

    return intersectionArea / unionArea;
  }

  /**
   * Checks if two rects are effectively the same using IoU threshold.
   */
  function areRectsEqual(rect1: DOMRect, rect2: DOMRect): boolean {
    return calculateIoU(rect1, rect2) >= sameRectIoUThreshold;
  }

  /**
   * Checks if an element can actually receive pointer events.
   * Returns false if the element is hidden, disabled, or has pointer-events: none.
   */
  function canReceivePointerEvents(element: HTMLElement): boolean {
    const style = getCachedComputedStyle(element);

    // Check CSS properties that prevent events
    if (style?.pointerEvents === 'none') return false;
    if (style?.visibility === 'hidden') return false;
    if (style?.display === 'none') return false;

    // Check disabled attribute for form elements
    if ((element as HTMLInputElement | HTMLButtonElement).disabled) return false;

    return true;
  }

  /**
   * Checks if an element has an interactive descendant with the same bounding rect.
   * If so, the descendant should be highlighted instead of this element (innermost wins).
   */
  function hasInteractiveDescendantWithSameRect(element: HTMLElement, rect: DOMRect): boolean {
    for (const child of element.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (!canReceivePointerEvents(child)) continue;

      const childRect = child.getBoundingClientRect();
      if (!areRectsEqual(rect, childRect)) continue;

      // Child has same rect - check if it's interactive
      if (isInteractiveElement(child) || isElementScrollable(child)) {
        return true;
      }

      // Child has same rect but isn't interactive - check its descendants
      if (hasInteractiveDescendantWithSameRect(child, rect)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Handles the logic for deciding whether to highlight an element and performing the highlight.
   */
  function handleHighlighting(nodeData: DOMTreeNode, node: HTMLElement, parentIframe: HTMLIFrameElement | null, parentHighlightedRect: DOMRect | null): { highlighted: boolean; rect: DOMRect | null } {
    if (!nodeData.isInteractive) return { highlighted: false, rect: null }; // Not interactive, definitely don't highlight

    // Apply action intent filter - skip elements that don't match the specified intent
    const actionIntent = args.actionIntent || 'all';
    if (actionIntent !== 'all' && !matchesActionIntent(node, actionIntent)) {
      return { highlighted: false, rect: null };
    }

    // Check if element can actually receive pointer events
    if (!canReceivePointerEvents(node)) {
      return { highlighted: false, rect: null };
    }

    const currentRect = node.getBoundingClientRect();

    // Check if there's an interactive descendant with the same rect
    // If so, skip this element - let the innermost element be highlighted
    if (hasInteractiveDescendantWithSameRect(node, currentRect)) {
      return { highlighted: false, rect: null };
    }

    let shouldHighlight = false;
    if (!parentHighlightedRect) {
      // Parent wasn't highlighted, this interactive node can be highlighted.
      shouldHighlight = true;
    } else {
      // Parent *was* highlighted. Only highlight this node if it represents a distinct interaction.
      if (areRectsEqual(currentRect, parentHighlightedRect)) {
        // Same rect as parent - this is the innermost element, should be highlighted
        // (parent should have been skipped by hasInteractiveDescendantWithSameRect)
        shouldHighlight = true;
      } else if (isElementDistinctInteraction(node, nodeData)) {
        shouldHighlight = true;
      } else {
        // console.log(`Skipping highlight for ${nodeData.tagName} (parent highlighted)`);
        shouldHighlight = false;
      }
    }

    if (shouldHighlight) {
      const attributeNames = node.getAttributeNames?.() || [];
      for (const name of attributeNames) {
        const value = node.getAttribute(name);
        nodeData.attributes![name] = value;
      }

      // Check viewport status before assigning index and highlighting
      if (nodeData.isInViewport === undefined) {
        nodeData.isInViewport = isInExpandedViewport(node, viewportExpansion);
      }

      // When viewportExpansion is -1, all interactive elements should get a highlight index
      // regardless of viewport status
      if (nodeData.isInViewport || viewportExpansion === -1) {
        nodeData.highlightIndex = highlightIndex++;

        if (doHighlightElements) {
          // Collect elements for deferred highlighting (after tree-based flow detection)
          if (focusHighlightIndex >= 0) {
            if (focusHighlightIndex === nodeData.highlightIndex) {
              elementsToHighlight.push({ element: node, index: nodeData.highlightIndex, parentIframe });
            }
          } else {
            elementsToHighlight.push({ element: node, index: nodeData.highlightIndex, parentIframe });
          }
          return { highlighted: true, rect: currentRect }; // Will be highlighted after traversal
        }
        // Even if not drawing highlights, we still "highlighted" for tracking purposes
        return { highlighted: true, rect: currentRect };
      } else {
        // console.log(`Skipping highlight for ${nodeData.tagName} (outside viewport)`);
      }
    }

    return { highlighted: false, rect: null }; // Did not highlight
  }

  function isElementScrollable(element: HTMLElement): boolean {
    const listenedEvents = getCachedNodeEventListeners(element);
    if (listenedEvents && listenedEvents.includes('scroll')) {
      const hasScrollableX = element.scrollWidth > element.clientWidth;
      const hasScrollableY = element.scrollHeight > element.clientHeight;
      return hasScrollableX || hasScrollableY;
    }

    const style = getCachedComputedStyle(element);
    const hasScrollableX = ['auto', 'scroll'].includes(style?.overflowX || '') &&
        element.scrollWidth > element.clientWidth;
    const hasScrollableY = ['auto', 'scroll'].includes(style?.overflowY || '') &&
        element.scrollHeight > element.clientHeight;
    return hasScrollableX || hasScrollableY;
  }

  /**
   * Creates a node data object for a given node and its descendants.
   */
  function buildDomTree(node: Node | null, parentIframe: HTMLIFrameElement | null = null, parentHighlightedRect: DOMRect | null = null): string | null {

    // Fast rejection checks first
    if (!node || (node as Element).id === HIGHLIGHT_CONTAINER_ID) {
      return null;
    }

    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) {
      return null;
    }

    // Special handling for root node (body)
    if (node === document.body) {
      const nodeData: DOMTreeNode = {
        tagName: 'body',
        attributes: {},
        xpath: '/body',
        children: [],
      };

      // Process children of body
      for (const child of node.childNodes) {
        const domElement = buildDomTree(child, parentIframe, null); // Body's children have no highlighted parent initially
        if (domElement) nodeData.children!.push(domElement);
      }

      const id = `${ID.current++}`;
      DOM_HASH_MAP[id] = nodeData;
      return id;
    }

    // Process text nodes
    if (node.nodeType === Node.TEXT_NODE) {
      const textContent = node.textContent?.trim();
      if (!textContent) {
        return null;
      }

      // Only check visibility for text nodes that might be visible
      const parentElement = (node as Text).parentElement;
      if (!parentElement || parentElement.tagName.toLowerCase() === 'script') {
        return null;
      }

      const id = `${ID.current++}`;
      DOM_HASH_MAP[id] = {
        type: "TEXT_NODE",
        text: textContent,
        isVisible: isTextNodeVisible(node as Text),
      };
      return id;
    }

    // Quick checks for element nodes
    if (node.nodeType === Node.ELEMENT_NODE && !isElementAccepted(node as Element)) {
      return null;
    }

    const element = node as HTMLElement;

    const nodeData: DOMTreeNode = {
      tagName: element.tagName.toLowerCase(),
      attributes: {},
      xpath: getXPathTree(element, true),
      children: [],
    };

    // Get attributes for interactive elements or potential text containers
    if (element.tagName.toLowerCase() === 'iframe' || element.tagName.toLowerCase() === 'body') {
      const attributeNames = element.getAttributeNames?.() || [];
      for (const name of attributeNames) {
        const value = element.getAttribute(name);
        nodeData.attributes![name] = value;
      }
    }

    let highlightResult: { highlighted: boolean; rect: DOMRect | null } = { highlighted: false, rect: null };
    // Perform visibility, interactivity, and highlighting checks
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (alwaysHighlightFileInput && element.tagName.toLowerCase() === 'input' && (element as HTMLInputElement).type === 'file') {
        nodeData.isTopElement = true;
        if (nodeData.isTopElement) {
          nodeData.isInteractive = true;
          nodeData.isInViewport = true; // File inputs should always be considered in viewport
          // Call the dedicated highlighting function
          highlightResult = handleHighlighting(nodeData, element, parentIframe, parentHighlightedRect);
        }
      } else {
        nodeData.isVisible = isElementVisible(element); // isElementVisible uses offsetWidth/Height, which is fine

        if (nodeData.isVisible) {
          nodeData.isTopElement = isTopElement(element);
          if (nodeData.isTopElement) {
            let isScrollable = isElementScrollable(element);
            nodeData.isInteractive = isInteractiveElement(element) || isScrollable;
            nodeData.isScrollable = isScrollable;
            nodeData.markAsClickable = shouldMarkAsClickable(element);
            // Call the dedicated highlighting function
            highlightResult = handleHighlighting(nodeData, element, parentIframe, parentHighlightedRect);
          }
        }
      }
    }

    // Determine the rect to pass to children: use this element's rect if highlighted, otherwise parent's
    const rectForChildren = highlightResult.highlighted ? highlightResult.rect : parentHighlightedRect;

    // Process children, with special handling for iframes and rich text editors
    if (element.tagName) {
      const tagName = element.tagName.toLowerCase();

      // Handle iframes
      if (tagName === "iframe") {
        try {
          const iframeEl = element as HTMLIFrameElement;
          const iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
          if (iframeDoc) {
            for (const child of iframeDoc.childNodes) {
              const domElement = buildDomTree(child, iframeEl, null); // iframes start fresh
              if (domElement) nodeData.children!.push(domElement);
            }
          }
        } catch (e) {
          console.warn("Unable to access iframe:", e);
        }
      }
      // Handle rich text editors and contenteditable elements
      else if (
        element.isContentEditable ||
        element.getAttribute("contenteditable") === "true" ||
        element.id === "tinymce" ||
        element.classList.contains("mce-content-body") ||
        (tagName === "body" && element.getAttribute("data-id")?.startsWith("mce_"))
      ) {
        // Process all child nodes to capture formatted text
        for (const child of element.childNodes) {
          const domElement = buildDomTree(child, parentIframe, rectForChildren);
          if (domElement) nodeData.children!.push(domElement);
        }
      }
      else {
        // Handle shadow DOM
        if (element.shadowRoot) {
          nodeData.shadowRoot = true;
          for (const child of element.shadowRoot.childNodes) {
            const domElement = buildDomTree(child, parentIframe, rectForChildren);
            if (domElement) nodeData.children!.push(domElement);
          }
        }
        // Handle regular elements
        for (const child of element.childNodes) {
          const domElement = buildDomTree(child, parentIframe, rectForChildren);
          if (domElement) nodeData.children!.push(domElement);
        }
      }
    }

    const id = `${ID.current++}`;
    DOM_HASH_MAP[id] = nodeData;
    return id;
  }

  const rootId = buildDomTree(document.body);

  // After traversal, render all highlights
  let treeEntries: TreeEntry[] = [];
  if (doHighlightElements) {
    if (phase === 'labels') {
      // Labels phase: use provided element data to place labels only
      processLabelsPhase();
    } else if (elementsToHighlight.length > 0) {
      // Boxes phase or legacy mode: traverse tree to draw boxes and optionally labels
      treeEntries = buildTreeEntries();

      // Use recursive tree processing for correct hot map behavior:
      // - Pre-order: Mark bounding boxes in hot map (so children avoid parent borders)
      // - Post-order: Place labels (so parent labels avoid children's labels, skipped in boxes phase)
      processElementTreeRecursively(elementsToHighlight);
    }
  }

  // Clear the cache before returning
  DOM_CACHE.clearCache();

  return {
    rootId,
    map: DOM_HASH_MAP,
    debugLogs,
    treeEntries,
    highlightCount: highlightIndex,
    // Return the final grayscale image state (after all boxes and labels marked) for debugging
    finalGrayscaleImage: grayscaleImage ?? undefined,
    // Note: labelSnapshots are now streamed via onSnapshot callback instead of returned
    // Return element data from boxes phase for use in labels phase
    elementData: phase === 'boxes' ? collectedElementData : undefined,
  };
};

// Export as default for backwards compatibility with the IIFE pattern
export default buildDOMTree;
