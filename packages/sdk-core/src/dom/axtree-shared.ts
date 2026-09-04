/**
 * Shared AXTree constants and logic
 *
 * This module contains the authoritative definitions used by both:
 * - service.ts (production Playwright-based detection)
 * - Chrome extension (debugging tool)
 *
 * IMPORTANT: Any changes here affect both production and debug tooling.
 */

/**
 * Interactive ARIA roles that indicate an element can receive user interaction.
 * Elements with these roles are considered interactive by the Accessibility Tree.
 */
export const INTERACTIVE_ROLES = new Set([
	'button',
	'link',
	'textbox',
	'checkbox',
	'radio',
	'combobox',
	'listbox',
	'menuitem',
	'menuitemcheckbox',
	'menuitemradio',
	'option',
	'tab',
	'switch',
	'slider',
	'spinbutton',
	'searchbox',
	'scrollbar',
	'treeitem',
	'gridcell',
]);

/**
 * Event types that indicate user interaction intent.
 * Used for CDP DOMDebugger.getEventListeners detection.
 */
export const INTERACTION_EVENT_TYPES = new Set([
	'click',
	'mousedown',
	'mouseup',
	'dblclick',
	'pointerdown',
	'pointerup',
	'touchstart',
	'touchend',
]);

/**
 * CSS selectors for elements likely to have JS event handlers.
 * Used to limit the scope of event listener detection for performance.
 */
export const EVENT_LISTENER_CANDIDATE_SELECTORS = [
	// Inline handlers (always interactive)
	'[onclick]',
	'[onmousedown]',
	'[ontouchstart]',
	// Common JS-handler targets
	'div',
	'span',
	'li',
	'tr',
	'td',
	// Likely interactive patterns
	'[role]',
	'[class*="btn"]',
	'[class*="button"]',
	'[class*="click"]',
	'[data-action]',
	'[data-click]',
];

/**
 * Default limit for event listener detection.
 * Higher values find more elements but take longer.
 */
export const DEFAULT_EVENT_LISTENER_LIMIT = 500;

/**
 * Check if an ARIA role is considered interactive
 */
export function isInteractiveRole(role: string | undefined | null): boolean {
	return role ? INTERACTIVE_ROLES.has(role) : false;
}

/**
 * Check if an event type indicates user interaction
 */
export function isInteractionEventType(eventType: string): boolean {
	return INTERACTION_EVENT_TYPES.has(eventType);
}

/**
 * Filter event listeners to only interaction types
 */
export function filterInteractionListeners<T extends { type: string }>(
	listeners: T[]
): T[] {
	return listeners.filter((l) => INTERACTION_EVENT_TYPES.has(l.type));
}
