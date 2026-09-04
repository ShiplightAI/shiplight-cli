/**
 * DOM module types
 * Shapes follow the approach of browser-use's Python DOM module; the
 * definitions here are our own.
 */

/**
 * Coordinates for an element
 */
export interface Coordinates {
	x: number;
	y: number;
}

/**
 * Set of coordinate points for an element
 */
export interface CoordinateSet {
	topLeft: Coordinates;
	topRight: Coordinates;
	bottomLeft: Coordinates;
	bottomRight: Coordinates;
	center: Coordinates;
	width: number;
	height: number;
}

/**
 * Viewport information
 */
export interface ViewportInfo {
	scrollX?: number;
	scrollY?: number;
	width: number;
	height: number;
}

/**
 * Base DOM node interface
 */
export interface DOMBaseNode {
	isVisible: boolean;
	parent: DOMElementNode | null;
}

/**
 * DOM text node
 */
export interface DOMTextNode extends DOMBaseNode {
	type: 'TEXT_NODE';
	text: string;

	hasParentWithHighlightIndex(): boolean;
	isParentInViewport(): boolean;
	isParentTopElement(): boolean;
}

/**
 * Configuration for clickableElementsToString
 */
export interface StringifyConfig {
	includeAttributes?: string[];
	includeClassesWithRename?: Record<string, string>;
}

/**
 * DOM element node
 */
export interface DOMElementNode extends DOMBaseNode {
	tagName: string;
	xpath: string;
	attributes: Record<string, string>;
	children: DOMBaseNode[];
	isInteractive: boolean;
	isScrollable: boolean;
	markAsClickable: boolean;
	isTopElement: boolean;
	isInViewport: boolean;
	shadowRoot: boolean;
	highlightIndex: number | null;
	viewportCoordinates: CoordinateSet | null;
	pageCoordinates: CoordinateSet | null;
	viewportInfo: ViewportInfo | null;
	shadowHostXPaths: string[];

	/** State injected by browser context - indicates if element is new */
	isNew: boolean | null;

	/**
	 * Get all text content until the next clickable element
	 */
	getAllTextTillNextClickableElement(maxDepth?: number): string;

	/**
	 * Convert clickable elements to string format for LLM
	 */
	clickableElementsToString(config?: StringifyConfig): string;
}

/**
 * Selector map: highlightIndex -> DOMElementNode
 */
export type SelectorMap = Map<number, DOMElementNode>;

/**
 * DOM state containing element tree and selector map
 */
export interface DOMState {
	elementTree: DOMElementNode;
	selectorMap: SelectorMap;
}

/**
 * Action intent types for filtering DOM elements.
 * - 'click': buttons, links, elements with click handlers
 * - 'input': text inputs, textareas, contenteditable elements
 * - 'scroll': scrollable containers
 * - 'all': all interactive elements (default)
 */
export type ActionIntent = 'click' | 'input' | 'scroll' | 'all';

/**
 * Options for DOM extraction
 */
export interface DOMExtractionOptions {
	highlightElements?: boolean;
	focusElement?: number;
	viewportExpansion?: number;
	interactiveClassNames?: string[];
	playwrightFrameFallbackDomains?: string[];
	alwaysHighlightFileInput?: boolean;
	useCleanScreenshot?: boolean;
	useSlicedScreenshots?: boolean;
	resizeSlicedScreenshots?: boolean;
	/**
	 * Use Chrome Accessibility Tree for element detection (experimental).
	 * When enabled, uses CDP Accessibility API to get authoritative
	 * interactive elements, then enriches with visual data from DOM.
	 */
	useAccessibilityTree?: boolean;
	/**
	 * Maximum number of elements to check for event listeners when
	 * useAccessibilityTree is enabled. Higher values find more elements
	 * but take longer. Default: 500
	 */
	eventListenerLimit?: number;
	/**
	 * IoU (Intersection over Union) threshold for considering two element
	 * rects as "the same". Used to deduplicate parent/child elements with
	 * nearly identical bounds. Range: 0-1. Default: 0.85
	 */
	sameRectIoUThreshold?: number;
	/**
	 * Action intent for filtering elements. Only elements relevant to this
	 * action type are highlighted and included. Falls back to 'all' if no
	 * elements match the specified intent.
	 */
	actionIntent?: ActionIntent;
}

/**
 * Raw JavaScript evaluation result from page.evaluate
 */
export interface DOMEvalResult {
	map: Record<string, any>;
	rootId: string;
	perfMetrics?: any;
}

/**
 * Hashed DOM element for comparison
 */
export interface HashedDomElement {
	branchPathHash: string;
	attributesHash: string;
	xpathHash: string;
}

/**
 * DOM history element for tracking state changes
 */
export interface DOMHistoryElement {
	tagName: string;
	xpath: string;
	highlightIndex: number | null;
	entireParentBranchPath: string[];
	attributes: Record<string, string>;
	shadowRoot: boolean;
	cssSelector: string | null;
	pageCoordinates: CoordinateSet | null;
	viewportCoordinates: CoordinateSet | null;
	viewportInfo: ViewportInfo | null;
}

/**
 * Default attributes to include in string representation
 */
export const DEFAULT_INCLUDE_ATTRIBUTES = [
	'title',
	'type',
	'checked',
	'name',
	'role',
	'value',
	'placeholder',
	'data-date-format',
	'alt',
	'aria-label',
	'aria-expanded',
	'data-state',
	'aria-checked',
	'data-id',
	'data-testid',
	'data-test-id',
	'data-handlepos',
	'data-item-id',
];

/**
 * Default class name patterns to include with rename rules
 */
export const DEFAULT_INCLUDE_CLASSES_WITH_RENAME: Record<string, string> = {
	// Regex pattern -> replacement (use \1, \2 etc for capture groups)
	'react-flow__(\\S+)': '$1', // Captures 'textBlock', 'staticImageBlock', etc.
};
