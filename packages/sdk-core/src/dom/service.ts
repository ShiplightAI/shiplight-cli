/**
 * DOM Service - Main orchestrator for DOM extraction
 * Extraction strategy follows the approach browser-use takes in
 * dom/service.py; the implementation here is our own.
 *
 * Supports two modes:
 * 1. Traditional: JavaScript-based DOM traversal with heuristic interactivity detection
 * 2. Hybrid (experimental): CDP Accessibility Tree for authoritative interactivity + DOM for visuals
 */

import { Page, CDPSession } from 'playwright';
import logger from '../utils/logger';
import { sliceScreenshot, generateGrayscaleFromPng } from '../utils/imageUtils';
import {
	DOMState,
	DOMExtractionOptions,
	DOMEvalResult,
	SelectorMap,
	DOMElementNode,
	DOMBaseNode,
	ActionIntent,
} from './types';
import { DOMElementNodeImpl, DOMTextNodeImpl } from './nodes';
import {
	INTERACTIVE_ROLES,
	INTERACTION_EVENT_TYPES,
	EVENT_LISTENER_CANDIDATE_SELECTORS,
	DEFAULT_EVENT_LISTENER_LIMIT,
} from './axtree-shared';

// @ts-ignore - Original JavaScript implementation
import domTreeJs from './dom-tree/index.js?raw';
// @ts-ignore - TypeScript implementation (built from index.ts via build.ts)
import domTreeTs from './dom-tree/dist/index.js?raw';

/**
 * CDP Accessibility Tree types
 */
interface AXValue {
	type: string;
	value?: any;
}

interface AXProperty {
	name: string;
	value: AXValue;
}

interface AXNode {
	nodeId: string;
	ignored: boolean;
	role?: AXValue;
	name?: AXValue;
	description?: AXValue;
	value?: AXValue;
	properties?: AXProperty[];
	childIds?: string[];
	backendDOMNodeId?: number;
}


/**
 * Result from resolving an AXNode to DOM with visual info
 */
interface ResolvedElement {
	axNode: AXNode;
	tagName: string;
	xpath: string;
	attributes: Record<string, string>;
	isVisible: boolean;
	isInViewport: boolean;
	isTopElement: boolean;
	boundingRect: { x: number; y: number; width: number; height: number } | null;
	clientRects: Array<{ x: number; y: number; width: number; height: number }>;
}

/**
 * Check if URL is a new tab page
 */
function isNewTabPage(url: string): boolean {
	return (
		url === 'about:blank' ||
		url === 'chrome://newtab/' ||
		url === 'edge://newtab/' ||
		url === 'about:newtab'
	);
}

/**
 * Options for DomService constructor
 */
export interface DomServiceOptions {
	/**
	 * Use the TypeScript implementation (compiled from index.ts)
	 * Default: false (uses original JavaScript implementation)
	 */
	useDomTreeTs?: boolean;
	/**
	 * Root node for DOM tree traversal.
	 * 'document' starts from document.documentElement (includes <head>).
	 * 'body' starts from document.body.
	 * Default: 'body'
	 */
	domTreeRoot?: 'body' | 'document';
}

/**
 * DOM Service for extracting clickable elements from pages
 *
 * Note: This service does NOT store a page reference. All methods that need
 * a page accept it as a parameter. This ensures the correct page is always
 * used, even when tabs change during a session.
 */
export class DomService {
	private jsCode: string;
	private useDomTreeTs: boolean;
	private domTreeRoot: 'body' | 'document';

	private normalizeDomain(domain: string): string {
		const trimmed = domain.trim().toLowerCase();
		if (!trimmed) return '';

		// Allow plain domains or full URLs in settings.
		try {
			if (trimmed.includes('://')) {
				return new URL(trimmed).hostname.toLowerCase();
			}
		} catch {
			return '';
		}

		return trimmed.split('/')[0].split(':')[0];
	}

	private isConfiguredIframeFallbackDomain(frameSrc: string, configuredDomains: string[]): boolean {
		let frameHostname: string;
		try {
			frameHostname = new URL(frameSrc).hostname.toLowerCase();
		} catch {
			return false;
		}

		for (const rawDomain of configuredDomains) {
			const normalized = this.normalizeDomain(rawDomain);
			if (!normalized) continue;
			if (frameHostname === normalized || frameHostname.endsWith(`.${normalized}`)) {
				return true;
			}
		}

		return false;
	}

	private shouldProcessWithPlaywrightFrameFallback(nodeData: any, configuredDomains: string[]): boolean {
		if (!nodeData.inaccessibleFrame) return false;

		const src = nodeData.attributes?.src;
		if (!src) return false;

		if (src.startsWith('chrome-extension://')) return true;
		return this.isConfiguredIframeFallbackDomain(src, configuredDomains);
	}

	constructor(options: DomServiceOptions = {}) {
		logger.debug('🌳 Initializing DomService with options:', options);
		// Select DOM tree implementation based on options
		this.useDomTreeTs = options.useDomTreeTs ?? false;
		this.domTreeRoot = options.domTreeRoot ?? 'body';
		this.jsCode = this.useDomTreeTs ? domTreeTs : domTreeJs;
	}

	/**
	 * Get clickable elements from the page
	 */
	async getClickableElements(page: Page, options: DOMExtractionOptions = {}): Promise<DOMState> {
		const {
			highlightElements = true,
			focusElement = -1,
			viewportExpansion = 0,
			interactiveClassNames = [],
			playwrightFrameFallbackDomains = [],
			alwaysHighlightFileInput = false,
			sameRectIoUThreshold,
			actionIntent = 'all',
		} = options;

		const [elementTree, selectorMap] = await this.buildDomTree(
			page,
			highlightElements,
			focusElement,
			viewportExpansion,
			interactiveClassNames,
			playwrightFrameFallbackDomains,
			alwaysHighlightFileInput,
			sameRectIoUThreshold,
			actionIntent
		);

		return {
			elementTree,
			selectorMap,
		};
	}

	/**
	 * Get clickable elements and capture SoM (Set-of-Mark) screenshot
	 * Returns both the DOM state and a base64-encoded screenshot with highlights
	 * Optionally slices the screenshot into 3 parts (left/middle/right) for token optimization
	 */
	async getClickableElementsWithScreenshot(
		page: Page,
		options: DOMExtractionOptions = {}
	): Promise<{ domState: DOMState; screenshotBase64: string; screenshot: Buffer; slicedScreenshotsBase64?: string[] }> {
		// Use hybrid AXTree approach if enabled
		if (options.useAccessibilityTree) {
			return this.getClickableElementsWithAXTree(page, options);
		}

		let screenshotBuffer: Buffer | undefined;
		if (options.useCleanScreenshot) {
			screenshotBuffer = await page.screenshot({
				type: 'png',
				fullPage: false,
			});
		}
		// Get clickable elements (this will add highlights to the page)
		const domState = await this.getClickableElements(page, options);

		// Wait a moment for highlights to render
		await page.waitForTimeout(100);

		if (!options.useCleanScreenshot) {
			// Capture screenshot with highlights
			screenshotBuffer = await page.screenshot({
				type: 'png',
				fullPage: false, // Only visible viewport
			});
		}

		// Clean up highlights after screenshot
		await this.removeHighlights(page, options.playwrightFrameFallbackDomains || []);

		// Validate screenshot was captured
		if (!screenshotBuffer) {
			throw new Error('Failed to capture screenshot: screenshot buffer is undefined');
		}

		const screenshotBase64 = screenshotBuffer.toString('base64');

		// Optionally slice the screenshot
		let slicedScreenshotsBase64: string[] | undefined;
		if (options.useSlicedScreenshots) {
			try {
				const slices = await sliceScreenshot(screenshotBuffer, {
					resize: options.resizeSlicedScreenshots,
				});
				slicedScreenshotsBase64 = slices.map(slice => slice.toString('base64'));
			} catch (error) {
				logger.warn('Failed to slice screenshot:', error);
			}
		}

		return {
			domState,
			screenshotBase64,
			screenshot: screenshotBuffer,
			slicedScreenshotsBase64,
		};
	}

	/**
	 * EXPERIMENTAL: Get clickable elements using Chrome Accessibility Tree
	 *
	 * This hybrid approach:
	 * 1. Uses CDP Accessibility API to get authoritative interactive elements
	 * 2. Resolves AXNodes to DOM elements for visual info (coordinates, visibility)
	 * 3. Renders SoM highlights using the same visual approach
	 *
	 * Benefits over heuristic approach:
	 * - Browser-native interactivity detection (no guessing about event listeners)
	 * - Proper ARIA role handling
	 * - Framework-agnostic (React, Vue, Angular all produce valid AXTree)
	 */
	private async getClickableElementsWithAXTree(
		page: Page,
		options: DOMExtractionOptions = {}
	): Promise<{ domState: DOMState; screenshotBase64: string; screenshot: Buffer; slicedScreenshotsBase64?: string[] }> {
		logger.debug('🌳 Using CDP Accessibility Tree for element detection');

		let screenshotBuffer: Buffer | undefined;
		if (options.useCleanScreenshot) {
			screenshotBuffer = await page.screenshot({
				type: 'png',
				fullPage: false,
			});
		}

		// Create CDP session for this operation
		const cdp = await page.context().newCDPSession(page);

		// Step 1: Get full accessibility tree
		const { nodes } = await cdp.send('Accessibility.getFullAXTree', {
			depth: -1, // Full depth
		}) as { nodes: AXNode[] };

		logger.debug(`📊 Got ${nodes.length} AXNodes from accessibility tree`);

		// Step 2: Filter to interactive nodes
		const interactiveNodes = nodes.filter((node) => {
			if (node.ignored) return false;

			const role = node.role?.value;
			if (!role) return false;

			// Check if role is interactive
			if (!INTERACTIVE_ROLES.has(role)) return false;

			// Check if disabled
			const isDisabled = node.properties?.find((p) => p.name === 'disabled')?.value?.value;
			if (isDisabled) return false;

			// Must have a backend DOM node reference
			if (!node.backendDOMNodeId) return false;

			return true;
		});

		logger.debug(`✅ Found ${interactiveNodes.length} interactive elements from AXTree`);

		// Log all buttons for debugging
		const allButtons = nodes.filter((n) => n.role?.value === 'button');
		logger.debug(`🔘 Total buttons in AXTree: ${allButtons.length}`);
		for (const btn of allButtons) {
			const reasons: string[] = [];
			if (btn.ignored) reasons.push('ignored');
			if (!btn.backendDOMNodeId) reasons.push('no-backendDOMNodeId');
			const isDisabled = btn.properties?.find((p) => p.name === 'disabled')?.value?.value;
			if (isDisabled) reasons.push('disabled');
			logger.debug(`   - "${btn.name?.value || '(no name)'}" ${reasons.length > 0 ? `[SKIPPED: ${reasons.join(', ')}]` : '[INCLUDED]'}`);
		}

		// Step 2b: Get elements with event listeners (CDP DOMDebugger)
		const axTreeNodeIds = new Set(interactiveNodes.map((n) => n.backendDOMNodeId));
		const eventListenerElements = await this.getElementsWithEventListeners(
			cdp,
			options.eventListenerLimit ?? 500
		);

		// Merge: Add event listener elements not already in AXTree
		let addedFromEventListeners = 0;
		for (const el of eventListenerElements) {
			if (!axTreeNodeIds.has(el.backendNodeId)) {
				// Create synthetic AXNode for this element
				interactiveNodes.push({
					nodeId: `synthetic-${el.backendNodeId}`,
					ignored: false,
					backendDOMNodeId: el.backendNodeId,
					role: { type: 'role', value: 'generic' },
					name: { type: 'string', value: '' },
					properties: [
						{
							name: 'eventListeners',
							value: { type: 'string', value: el.eventTypes.join(',') },
						},
					],
				});
				axTreeNodeIds.add(el.backendNodeId);
				addedFromEventListeners++;
			}
		}

		logger.debug(
			`🎯 Added ${addedFromEventListeners} elements from event listeners (total: ${interactiveNodes.length})`
		);

		// Step 3: Resolve to DOM elements and get visual info
		const resolvedElements = await this.resolveAXNodesToDOM(cdp, interactiveNodes);

		// Step 4: Filter to visible, in-viewport, top elements
		const visibleElements = resolvedElements.filter(
			(el) => el.isVisible && el.isInViewport && el.isTopElement && el.boundingRect
		);

		// Log filtered out elements for debugging
		const filteredOut = resolvedElements.filter(
			(el) => !(el.isVisible && el.isInViewport && el.isTopElement && el.boundingRect)
		);
		if (filteredOut.length > 0) {
			logger.debug(`🚫 Filtered out ${filteredOut.length} elements:`);
			for (const el of filteredOut) {
				const reasons: string[] = [];
				if (!el.isVisible) reasons.push('not-visible');
				if (!el.isInViewport) reasons.push('not-in-viewport');
				if (!el.isTopElement) reasons.push('not-top-element');
				if (!el.boundingRect) reasons.push('no-bounding-rect');
				logger.debug(`   - <${el.tagName}> "${el.axNode.name?.value || ''}" [${reasons.join(', ')}]`);
			}
		}

		logger.debug(`👁️ ${visibleElements.length} elements are visible and in viewport`);

		// Step 5: Build DOM state and render highlights
		const { domState, highlightIndex } = await this.buildDomStateFromAXTree(visibleElements);

		// Step 6: Render highlights on page
		if (options.highlightElements !== false && highlightIndex > 0) {
			await this.renderHighlightsForAXElements(page, visibleElements.slice(0, highlightIndex));
			await page.waitForTimeout(100);
		}

		// Step 7: Capture screenshot
		if (!options.useCleanScreenshot) {
			screenshotBuffer = await page.screenshot({
				type: 'png',
				fullPage: false,
			});
		}

			// Step 8: Clean up highlights
			await this.removeHighlights(page, options.playwrightFrameFallbackDomains || []);

		// Step 9: Detach CDP session
		try {
			await cdp.detach();
		} catch {
			// Ignore errors when detaching
		}

		// Validate screenshot was captured
		if (!screenshotBuffer) {
			throw new Error('Failed to capture screenshot: screenshot buffer is undefined');
		}

		const screenshotBase64 = screenshotBuffer.toString('base64');

		// Step 10: Optionally slice screenshot
		let slicedScreenshotsBase64: string[] | undefined;
		if (options.useSlicedScreenshots) {
			try {
				const slices = await sliceScreenshot(screenshotBuffer, {
					resize: options.resizeSlicedScreenshots,
				});
				slicedScreenshotsBase64 = slices.map((slice) => slice.toString('base64'));
			} catch (error) {
				logger.warn('Failed to slice screenshot:', error);
			}
		}

		return {
			domState,
			screenshotBase64,
			screenshot: screenshotBuffer,
			slicedScreenshotsBase64,
		};
	}

	/**
	 * Resolve AXNodes to DOM elements with visual information
	 */
	private async resolveAXNodesToDOM(
		cdp: CDPSession,
		axNodes: AXNode[]
	): Promise<ResolvedElement[]> {
		const results: ResolvedElement[] = [];

		// Batch resolve: collect all backend node IDs and resolve in one page.evaluate
		const backendNodeIds = axNodes
			.map((n) => n.backendDOMNodeId)
			.filter((id): id is number => id !== undefined);

		if (backendNodeIds.length === 0) {
			return results;
		}

		// Use DOM.resolveNode to get object IDs for each backend node
		const objectIds: (string | null)[] = [];
		for (const backendNodeId of backendNodeIds) {
			try {
				const { object } = await cdp.send('DOM.resolveNode', {
					backendNodeId,
				});
				objectIds.push(object.objectId || null);
			} catch {
				objectIds.push(null);
			}
		}

		// Now get visual info for each resolved element
		for (let i = 0; i < axNodes.length; i++) {
			const axNode = axNodes[i];
			const objectId = objectIds[i];

			if (!objectId) {
				continue;
			}

			try {
				// Get element info via Runtime.callFunctionOn
				const { result } = await cdp.send('Runtime.callFunctionOn', {
					objectId,
					functionDeclaration: `function() {
						const el = this;
						const rect = el.getBoundingClientRect();
						const rects = el.getClientRects();
						const style = window.getComputedStyle(el);

						// Check visibility
						const isVisible =
							el.offsetWidth > 0 &&
							el.offsetHeight > 0 &&
							style.visibility !== 'hidden' &&
							style.display !== 'none' &&
							style.opacity !== '0';

						// Check if in viewport
						const viewportWidth = window.innerWidth;
						const viewportHeight = window.innerHeight;
						const isInViewport = !(
							rect.bottom < 0 ||
							rect.top > viewportHeight ||
							rect.right < 0 ||
							rect.left > viewportWidth
						);

						// Check if topmost element
						let isTopElement = false;
						if (isVisible && isInViewport) {
							const centerX = rect.left + rect.width / 2;
							const centerY = rect.top + rect.height / 2;
							const topEl = document.elementFromPoint(centerX, centerY);
							if (topEl) {
								let current = topEl;
								while (current && current !== document.documentElement) {
									if (current === el) {
										isTopElement = true;
										break;
									}
									current = current.parentElement;
								}
							}
						}

						// Get XPath
						function getXPath(element) {
							const segments = [];
							let current = element;
							while (current && current.nodeType === Node.ELEMENT_NODE) {
								const tagName = current.nodeName.toLowerCase();
								const siblings = current.parentElement
									? Array.from(current.parentElement.children).filter(c => c.nodeName.toLowerCase() === tagName)
									: [];
								const index = siblings.length > 1 ? siblings.indexOf(current) + 1 : 0;
								segments.unshift(index > 0 ? tagName + '[' + index + ']' : tagName);
								current = current.parentNode;
							}
							return segments.join('/');
						}

						// Get attributes
						const attributes = {};
						for (const attr of el.attributes) {
							attributes[attr.name] = attr.value;
						}

						// Convert client rects to plain objects
						const clientRectsArray = [];
						for (const r of rects) {
							clientRectsArray.push({
								x: r.x, y: r.y, width: r.width, height: r.height
							});
						}

						return {
							tagName: el.tagName.toLowerCase(),
							xpath: getXPath(el),
							attributes: attributes,
							isVisible: isVisible,
							isInViewport: isInViewport,
							isTopElement: isTopElement,
							boundingRect: rect.width > 0 && rect.height > 0 ? {
								x: rect.x, y: rect.y, width: rect.width, height: rect.height
							} : null,
							clientRects: clientRectsArray
						};
					}`,
					returnByValue: true,
				});

				if (result.value) {
					results.push({
						axNode,
						...result.value,
					});
				}
			} catch (error) {
				// Element may have been removed from DOM
				logger.debug(`Failed to resolve element: ${error}`);
			}
		}

		return results;
	}

	/**
	 * Get elements with interaction event listeners using CDP DOMDebugger
	 * Returns elements that have click/mousedown/etc handlers attached
	 */
	private async getElementsWithEventListeners(
		cdp: CDPSession,
		limit: number = DEFAULT_EVENT_LISTENER_LIMIT
	): Promise<Array<{ backendNodeId: number; eventTypes: string[] }>> {
		const results: Array<{ backendNodeId: number; eventTypes: string[] }> = [];

		try {
			// Step 1: Get document root
			const { root } = (await cdp.send('DOM.getDocument', { depth: 0 })) as {
				root: { nodeId: number };
			};

			// Step 2: Query potentially interactive elements (from shared config)
			const selectors = EVENT_LISTENER_CANDIDATE_SELECTORS.join(',');

			const { nodeIds } = (await cdp.send('DOM.querySelectorAll', {
				nodeId: root.nodeId,
				selector: selectors,
			})) as { nodeIds: number[] };

			logger.debug(`🔍 Checking ${Math.min(nodeIds.length, limit)} elements for event listeners`);

			// Step 3: Check each element for event listeners
			for (const nodeId of nodeIds.slice(0, limit)) {
				try {
					// Resolve node to get objectId
					const { object } = (await cdp.send('DOM.resolveNode', { nodeId })) as {
						object: { objectId?: string };
					};
					if (!object.objectId) continue;

					// Get event listeners for this element
					const { listeners } = (await cdp.send('DOMDebugger.getEventListeners', {
						objectId: object.objectId,
					})) as { listeners: Array<{ type: string }> };

					// Filter to interaction event types
					const interactionListeners = listeners.filter((l) =>
						INTERACTION_EVENT_TYPES.has(l.type)
					);

					if (interactionListeners.length > 0) {
						// Get backendNodeId for this element
						const { node } = (await cdp.send('DOM.describeNode', { nodeId })) as {
							node: { backendNodeId: number };
						};

						results.push({
							backendNodeId: node.backendNodeId,
							eventTypes: interactionListeners.map((l) => l.type),
						});
					}

					// Release object to free memory
					await cdp.send('Runtime.releaseObject', { objectId: object.objectId });
				} catch {
					// Element may have been removed, skip
				}
			}

			logger.debug(`✅ Found ${results.length} elements with interaction event listeners`);
		} catch (error) {
			logger.warn('Failed to get elements with event listeners:', error);
		}

		return results;
	}

	/**
	 * Build DOMState from resolved AXTree elements
	 */
	private async buildDomStateFromAXTree(
		elements: ResolvedElement[]
	): Promise<{ domState: DOMState; highlightIndex: number }> {
		const selectorMap = new Map<number, DOMElementNode>();

		// Create a root body element
		const rootElement = new DOMElementNodeImpl(
			'body',
			'/body',
			{},
			[],
			true, // isVisible
			false, // isInteractive (body itself is not interactive)
			false, // isScrollable
			false, // markAsClickable
			true, // isTopElement
			true, // isInViewport
			false, // shadowRoot
			null // highlightIndex
		);

		// Add each element as a child with highlight index
		let highlightIndex = 0;
		for (const el of elements) {
			const role = el.axNode.role?.value || '';
			const name = el.axNode.name?.value || '';

			// Determine if this should be marked as clickable based on role
			const isClickable = ['button', 'link', 'menuitem', 'tab', 'switch'].includes(role);

			// Create element node
			const elementNode = new DOMElementNodeImpl(
				el.tagName,
				el.xpath,
				el.attributes,
				[], // children - we don't track children in AXTree mode
				el.isVisible,
				true, // isInteractive - all AXTree elements we include are interactive
				role === 'scrollbar', // isScrollable
				isClickable,
				el.isTopElement,
				el.isInViewport,
				false, // shadowRoot
				highlightIndex,
				el.boundingRect
					? {
							topLeft: { x: el.boundingRect.x, y: el.boundingRect.y },
							topRight: { x: el.boundingRect.x + el.boundingRect.width, y: el.boundingRect.y },
							bottomLeft: { x: el.boundingRect.x, y: el.boundingRect.y + el.boundingRect.height },
							bottomRight: {
								x: el.boundingRect.x + el.boundingRect.width,
								y: el.boundingRect.y + el.boundingRect.height,
							},
							center: {
								x: el.boundingRect.x + el.boundingRect.width / 2,
								y: el.boundingRect.y + el.boundingRect.height / 2,
							},
							width: el.boundingRect.width,
							height: el.boundingRect.height,
						}
					: null,
				null, // pageCoordinates
				null, // viewportInfo
				[], // shadowHostXPaths
				rootElement // parent
			);

			// Add accessible name as a text node child if present
			if (name) {
				const textNode = new DOMTextNodeImpl(name, true, elementNode);
				elementNode.children.push(textNode);
			}

			rootElement.children.push(elementNode);
			selectorMap.set(highlightIndex, elementNode);
			highlightIndex++;
		}

		return {
			domState: {
				elementTree: rootElement,
				selectorMap,
			},
			highlightIndex,
		};
	}

	/**
	 * Render SoM highlights for AXTree elements
	 */
	private async renderHighlightsForAXElements(page: Page, elements: ResolvedElement[]): Promise<void> {
		// Colors for highlighting (same as dom-tree/index.js)
		const colors = [
			'#FF0000',
			'#00FF00',
			'#0000FF',
			'#FFA500',
			'#800080',
			'#008080',
			'#FF69B4',
			'#4B0082',
			'#FF4500',
			'#2E8B57',
			'#DC143C',
			'#4682B4',
		];

		await page.evaluate(
			({ elements, colors }) => {
				// Create or get highlight container
				const HIGHLIGHT_CONTAINER_ID = 'playwright-highlight-container';
				let container = document.getElementById(HIGHLIGHT_CONTAINER_ID);
				if (!container) {
					container = document.createElement('div');
					container.id = HIGHLIGHT_CONTAINER_ID;
					container.style.position = 'fixed';
					container.style.pointerEvents = 'none';
					container.style.top = '0';
					container.style.left = '0';
					container.style.width = '100%';
					container.style.height = '100%';
					container.style.zIndex = '2147483647';
					container.style.backgroundColor = 'transparent';
					document.body.appendChild(container);
				}

				// Create highlights for each element
				elements.forEach((el: any, index: number) => {
					if (!el.boundingRect) return;

					const color = colors[index % colors.length];
					const rect = el.boundingRect;

					// Create overlay
					const overlay = document.createElement('div');
					overlay.style.position = 'fixed';
					overlay.style.border = `1px solid ${color}`;
					overlay.style.backgroundColor = 'transparent';
					overlay.style.pointerEvents = 'none';
					overlay.style.boxSizing = 'border-box';
					overlay.style.top = `${rect.y}px`;
					overlay.style.left = `${rect.x}px`;
					overlay.style.width = `${rect.width}px`;
					overlay.style.height = `${rect.height}px`;
					container!.appendChild(overlay);

					// Create label
					const label = document.createElement('div');
					label.style.position = 'fixed';
					label.style.background = color;
					label.style.color = 'white';
					label.style.padding = '1px 4px';
					label.style.borderRadius = '4px';
					label.style.fontSize = index >= 100 ? '8px' : '12px';
					label.textContent = String(index);

					// Position label above element, aligned to right
					const labelTop = Math.max(0, rect.y - 16);
					const labelLeft = Math.max(0, Math.min(rect.x + rect.width - 20, window.innerWidth - 25));
					label.style.top = `${labelTop}px`;
					label.style.left = `${labelLeft}px`;
					container!.appendChild(label);
				});
			},
			{ elements, colors }
		);
	}

	/**
	 * Remove all highlights from the page
	 */
	async removeHighlights(page: Page, playwrightFrameFallbackDomains: string[] = []): Promise<void> {
		const cleanupScript = () => {
			const container = document.getElementById('playwright-highlight-container');
			if (container) {
				container.remove();
			}
			if ((window as any)._highlightCleanupFunctions) {
				(window as any)._highlightCleanupFunctions.forEach((fn: () => void) => fn());
				(window as any)._highlightCleanupFunctions = [];
			}
		};

		// Clean up main page
		try {
			await page.evaluate(cleanupScript);
			logger.debug('✅ Highlights removed from page');
		} catch (error: any) {
			logger.warn('Failed to remove highlights:', error.message);
		}

		// Clean up fallback iframe frames (extension + configured domains)
		for (const frame of page.frames()) {
			const frameUrl = frame.url();
			if (
				!frameUrl.startsWith('chrome-extension://') &&
				!this.isConfiguredIframeFallbackDomain(frameUrl, playwrightFrameFallbackDomains)
			) {
				continue;
			}
			try {
				await frame.evaluate(cleanupScript);
			} catch {
				// frame may be gone or restricted, ignore
			}
		}
	}

	/**
	 * Get cross-origin iframes (for multi-frame navigation)
	 */
	async getCrossOriginIframes(page: Page): Promise<string[]> {
		// Get hidden frame URLs
		const hiddenFrameUrls = await page
			.locator('iframe')
			.filter({ hasNot: page.locator(':visible') })
			.evaluateAll((iframes) => iframes.map((iframe) => (iframe as HTMLIFrameElement).src));

		const isAdUrl = (url: string): boolean => {
			try {
				const urlObj = new URL(url);
				const adDomains = ['doubleclick.net', 'adroll.com', 'googletagmanager.com'];
				return adDomains.some((domain) => urlObj.hostname.includes(domain));
			} catch {
				return false;
			}
		};

		const pageUrl = page.url();
		const pageHostname = new URL(pageUrl).hostname;

		const frames = page.frames();
		const crossOriginUrls: string[] = [];

		for (const frame of frames) {
			const frameUrl = frame.url();

			try {
				const frameHostname = new URL(frameUrl).hostname;

				// Exclude same-origin, hidden frames, and ad frames
				if (
					frameHostname && // exclude data:urls and new tab pages
					frameHostname !== pageHostname && // exclude same-origin iframes
					!hiddenFrameUrls.includes(frameUrl) && // exclude hidden frames
					!isAdUrl(frameUrl) // exclude ad network frames
				) {
					crossOriginUrls.push(frameUrl);
				}
			} catch {
				// Skip invalid URLs
				continue;
			}
		}

		return crossOriginUrls;
	}

	/**
	 * Build DOM tree by executing JavaScript in the browser
	 */
	private async buildDomTree(
		page: Page,
		highlightElements: boolean,
		focusElement: number,
		viewportExpansion: number,
		interactiveClassNames: string[],
		playwrightFrameFallbackDomains: string[],
		alwaysHighlightFileInput: boolean,
		sameRectIoUThreshold?: number,
		actionIntent: ActionIntent = 'all'
	): Promise<[DOMElementNode, SelectorMap]> {
		// Test if page can evaluate JavaScript
		const canEvaluate = await page.evaluate('1+1');
		if (canEvaluate !== 2) {
			throw new Error('The page cannot evaluate javascript code properly');
		}

		// Short-circuit if the page is a new empty tab
		if (isNewTabPage(page.url())) {
			const emptyElement = new DOMElementNodeImpl(
				'body',
				'',
				{},
				[],
				false, // isVisible
				false, // isInteractive
				false, // isScrollable
				false, // markAsClickable
				false, // isTopElement
				false, // isInViewport
				false, // shadowRoot
				null // highlightIndex
			);
			return [emptyElement, new Map()];
		}

		// Base args for JavaScript DOM analysis
		const baseArgs = {
			doHighlightElements: highlightElements,
			focusHighlightIndex: focusElement,
			viewportExpansion: viewportExpansion,
			debugMode: false,
			interactiveClassNames: interactiveClassNames,
			alwaysHighlightFileInput: alwaysHighlightFileInput,
			sameRectIoUThreshold: sameRectIoUThreshold,
			actionIntent: actionIntent,
			domTreeRoot: this.domTreeRoot,
		};

		logger.debug(`🔧 Starting JavaScript DOM analysis for ${page.url().slice(0, 50)}...`);

		let evalPage: any;
		let grayscaleImage: number[][] | null = null;

		// Two-phase rendering with grayscale-based label placement
		// Only available when using the TypeScript DOM tree implementation
		const useTwoPhaseRendering = this.useDomTreeTs && highlightElements;

		if (useTwoPhaseRendering) {
			// Two-phase rendering when highlighting:
			// Phase 1: Draw all bounding boxes (no labels yet)
			// Phase 2: Capture screenshot (boxes visible), generate grayscale, place labels
			try {
				// Phase 1: Draw all bounding boxes
				const boxesArgs = {
					...baseArgs,
					phase: 'boxes' as const,
					grayscaleImage: null, // Not needed for boxes phase
				};

				const boxesResult = await page.evaluate(
					({ code, argsObj }: { code: string; argsObj: any }) => {
						const fn = (new Function('return ' + code))();
						return fn(argsObj);
					},
					{ code: this.jsCode, argsObj: boxesArgs }
				);
				logger.debug(`📦 Phase 1: Drew ${boxesResult.elementData?.length || 0} bounding boxes`);

				// Capture screenshot WITH boxes visible
				const screenshotBuffer = await page.screenshot({
					type: 'png',
					fullPage: false,
				});
				logger.debug('📸 Captured screenshot with bounding boxes');

				// Generate grayscale from screenshot (boxes are "baked in")
				const startTime = performance.now();
				const grayscaleData = await generateGrayscaleFromPng(screenshotBuffer);
				grayscaleImage = grayscaleData.pixels;
				const elapsed = Math.round(performance.now() - startTime);
				logger.debug(`🖼️ Generated grayscale image (${grayscaleData.width}x${grayscaleData.height}) in ${elapsed}ms`);

				// Phase 2: Place labels using grayscale
				const labelsArgs = {
					...baseArgs,
					phase: 'labels' as const,
					grayscaleImage: grayscaleImage,
					elementData: boxesResult.elementData,
				};

				evalPage = await page.evaluate(
					({ code, argsObj }: { code: string; argsObj: any }) => {
						const fn = (new Function('return ' + code))();
						return fn(argsObj);
					},
					{ code: this.jsCode, argsObj: labelsArgs }
				);

				// Merge results from boxes phase (map, rootId) with labels phase
				evalPage.map = boxesResult.map;
				evalPage.rootId = boxesResult.rootId;
				evalPage.highlightCount = boxesResult.highlightCount;
				evalPage.perfMetrics = boxesResult.perfMetrics;

				logger.debug('✅ Phase 2: Labels placed using grayscale-based positioning');
			} catch (error: any) {
				logger.warn('Two-phase rendering failed, falling back to legacy mode:', error.message);
				// Fallback to legacy single-pass mode
				grayscaleImage = null;
				const legacyArgs = {
					...baseArgs,
					grayscaleImage: null,
				};

				evalPage = await page.evaluate(
					({ code, argsObj }: { code: string; argsObj: any }) => {
						const fn = (new Function('return ' + code))();
						return fn(argsObj);
					},
					{ code: this.jsCode, argsObj: legacyArgs }
				);
				logger.debug('✅ JavaScript DOM analysis completed (legacy mode)');
			}
		} else {
			// Legacy single-pass mode (JS implementation or no highlighting)
			try {
				evalPage = await page.evaluate(
					({ code, argsObj }: { code: string; argsObj: any }) => {
						const fn = (new Function('return ' + code))();
						return fn(argsObj);
					},
					{ code: this.jsCode, argsObj: baseArgs }
				);
				logger.debug('✅ JavaScript DOM analysis completed');
			} catch (error: any) {
				logger.error('Error evaluating JavaScript:', error.message);
				throw error;
			}
		}

		// Validate the result
		if (!evalPage || typeof evalPage !== 'object') {
			logger.error('JavaScript returned invalid result:', evalPage);
			throw new Error('JavaScript DOM analysis returned invalid result');
		}

		if (!evalPage.map || !evalPage.rootId) {
			logger.error('JavaScript result missing map or rootId:', JSON.stringify(evalPage, null, 2));
			throw new Error('JavaScript result missing required fields (map or rootId)');
		}

		// Fallback: If intent filtering found no elements, re-run with 'all' intent
		if (actionIntent !== 'all' && evalPage.highlightCount === 0) {
			logger.debug(`⚠️ No elements matched intent '${actionIntent}', falling back to 'all'`);
			// Re-run with single pass for simplicity in fallback case
			const fallbackArgs = { ...baseArgs, actionIntent: 'all' as const };
			evalPage = await page.evaluate(
				({ code, argsObj }: { code: string; argsObj: any }) => {
					const fn = (new Function('return ' + code))();
					return fn(argsObj);
				},
				{ code: this.jsCode, argsObj: fallbackArgs }
			);
		}

		// Process inaccessible iframes via Playwright frame access, which bypasses
		// in-page same-origin access restrictions. Fallback applies to:
		// - chrome-extension:// iframes
		// - configured domains from organization settings
		// The dom-tree script marks iframes it couldn't access with inaccessibleFrame=true.
		// Same-origin iframes that were already processed won't have this flag set.
		// Log all iframes found in map for debugging
		const allIframeNodes = Object.entries(evalPage.map).filter(([, nodeData]) => (nodeData as any).tagName === 'iframe');
		logger.debug(`🔍 [ext-iframe] Total iframe nodes in map: ${allIframeNodes.length}`);
		for (const [id, nodeData] of allIframeNodes) {
			const data = nodeData as any;
			logger.debug(`🔍 [ext-iframe] iframe node id=${id} src=${data.attributes?.src} inaccessibleFrame=${data.inaccessibleFrame}`);
		}

		// Log all Playwright frames for debugging
		const allFrames = page.frames();
		logger.debug(`🔍 [ext-iframe] Playwright frames count: ${allFrames.length}`);
		for (const frame of allFrames) {
			logger.debug(`🔍 [ext-iframe] Playwright frame url=${frame.url()}`);
		}

		const inaccessibleFallbackIframes: Array<{ nodeId: string; src: string }> = [];
		for (const [id, nodeData] of Object.entries(evalPage.map)) {
			const data = nodeData as any;
			if (this.shouldProcessWithPlaywrightFrameFallback(data, playwrightFrameFallbackDomains)) {
				inaccessibleFallbackIframes.push({ nodeId: id, src: data.attributes.src });
			}
		}

		logger.debug(`🔍 [ext-iframe] Inaccessible fallback iframes found: ${inaccessibleFallbackIframes.length}`);

		if (inaccessibleFallbackIframes.length > 0) {
			logger.debug(`🔌 Found ${inaccessibleFallbackIframes.length} inaccessible iframe(s) for Playwright fallback, processing`);

			// Find the current max highlight index from the main page result
			let maxHighlightIndex = -1;
			for (const nodeData of Object.values(evalPage.map)) {
				const data = nodeData as any;
				if (data.highlightIndex != null) {
					maxHighlightIndex = Math.max(maxHighlightIndex, data.highlightIndex);
				}
			}
			logger.debug(`🔍 [ext-iframe] Main page max highlight index: ${maxHighlightIndex}`);

			for (let frameIndex = 0; frameIndex < inaccessibleFallbackIframes.length; frameIndex++) {
				const { nodeId, src } = inaccessibleFallbackIframes[frameIndex];
				logger.debug(`🔍 [ext-iframe] Processing fallback iframe [${frameIndex}]: ${src}`);

				// Match by extension origin (chrome-extension://<id>) because the frame may have
				// redirected internally, so its URL won't match the iframe's src attribute exactly.
				const parseComparableOrigin = (url: string): string | null => {
					try {
						const parsed = new URL(url);
						// Node URL treats chrome-extension: as opaque (origin="null"), but for our
						// frame matching we want the extension origin scope.
						if (parsed.protocol === 'chrome-extension:' && parsed.hostname) {
							return `chrome-extension://${parsed.hostname}`;
						}

						const origin = parsed.origin;
						// Opaque origins (e.g. about:blank, many non-special schemes in Node URL)
						// report as literal "null" and should not be used for origin matching.
						return origin === 'null' ? null : origin;
					} catch {
						return null;
					}
				};

				const srcOrigin = parseComparableOrigin(src);
				logger.debug(`🔍 [ext-iframe] iframe src origin=${srcOrigin ?? 'null'}`);

				let matchedBy: 'exact' | 'origin' | null = null;
				const frame = page.frames().find(f => {
					const frameUrl = f.url();
					if (frameUrl === src) {
						matchedBy = 'exact';
						logger.debug(`🔍 [ext-iframe] Candidate frame matched by exact URL: ${frameUrl}`);
						return true;
					}

					const frameOrigin = parseComparableOrigin(frameUrl);
					logger.debug(
						`🔍 [ext-iframe] Candidate frame compare url=${frameUrl} origin=${frameOrigin ?? 'null'} vs srcOrigin=${srcOrigin ?? 'null'}`
					);

					if (srcOrigin && frameOrigin === srcOrigin) {
						matchedBy = 'origin';
						logger.debug(`🔍 [ext-iframe] Candidate frame matched by origin: ${frameUrl}`);
						return true;
					}
					return false;
				});
				if (!frame) {
					logger.debug(`⚠️ [ext-iframe] No Playwright frame found for fallback iframe: ${src}`);
					logger.debug(`⚠️ [ext-iframe] Available frame URLs: ${page.frames().map(f => f.url()).join(', ')}`);
					continue;
				}

				logger.debug(`🔍 [ext-iframe] Found matching Playwright frame for: ${src} (frame url: ${frame.url()})`);

				try {
					const frameArgs = {
						...baseArgs,
						initialHighlightIndex: maxHighlightIndex + 1,
						domTreeRoot: 'body' as const,
					};
					logger.debug(`🔍 [ext-iframe] Running dom-tree in extension frame with initialHighlightIndex=${frameArgs.initialHighlightIndex}`);

					const frameEval = await frame.evaluate(
						({ code, argsObj }: { code: string; argsObj: any }) => {
							const fn = (new Function('return ' + code))();
							return fn(argsObj);
						},
						{ code: this.jsCode, argsObj: frameArgs }
					);

					logger.debug(`🔍 [ext-iframe] frameEval result: map size=${Object.keys(frameEval?.map ?? {}).length} rootId=${frameEval?.rootId}`);

					if (!frameEval?.map || !frameEval.rootId) {
						logger.debug(`⚠️ [ext-iframe] frameEval missing map or rootId, skipping`);
						continue;
					}

					// Count interactive elements found in the frame
					const frameInteractive = Object.values(frameEval.map).filter((n: any) => n.highlightIndex != null);
					logger.debug(`🔍 [ext-iframe] Interactive elements in extension frame: ${frameInteractive.length}`);
					for (const n of frameInteractive) {
						const data = n as any;
						logger.debug(`🔍 [ext-iframe]   - <${data.tagName}> highlightIndex=${data.highlightIndex} text="${data.children?.length ? '...' : ''}"`);
					}

					// Update maxHighlightIndex from this frame's results
					for (const nodeData of Object.values(frameEval.map)) {
						const data = nodeData as any;
						if (data.highlightIndex != null) {
							maxHighlightIndex = Math.max(maxHighlightIndex, data.highlightIndex);
						}
					}

					// Merge frame map into main map with prefixed IDs to avoid key collisions
					const frameMapPrefix = `ext_${frameIndex}_`;
					for (const [id, nodeData] of Object.entries(frameEval.map)) {
						const data = { ...(nodeData as any) };
						if (data.children) {
							data.children = (data.children as string[]).map(childId => `${frameMapPrefix}${childId}`);
						}
						evalPage.map[`${frameMapPrefix}${id}`] = data;
					}

					// Attach the frame's root as a child of the iframe node
					const iframeNode = evalPage.map[nodeId] as any;
					if (iframeNode) {
						iframeNode.children = [...(iframeNode.children || []), `${frameMapPrefix}${frameEval.rootId}`];
						logger.debug(`🔍 [ext-iframe] Attached frame root to iframe node ${nodeId}`);
					} else {
						logger.debug(`⚠️ [ext-iframe] iframe node ${nodeId} not found in map`);
					}

					logger.debug(`✅ Merged fallback iframe content from: ${src}`);
				} catch (error) {
					logger.warn(`Failed to process fallback iframe ${src}:`, error);
				}
			}
		}

		// Log performance metrics if available
		if (evalPage && evalPage.perfMetrics) {
			const perf = evalPage.perfMetrics;
			const totalNodes = perf.nodeMetrics?.totalNodes ?? 0;

			// Count interactive elements from the DOM map
			let interactiveCount = 0;
			if (evalPage.map) {
				for (const nodeData of Object.values(evalPage.map)) {
					if (typeof nodeData === 'object' && nodeData !== null && (nodeData as any).isInteractive) {
						interactiveCount++;
					}
				}
			}

			const urlShort = page.url().length > 50 ? page.url().slice(0, 50) + '...' : page.url();
			logger.debug(
				`🔎 Ran buildDOMTree.js interactive element detection on: ${urlShort} interactive=${interactiveCount}/${totalNodes}`
			);
		}

		logger.debug('🔄 Starting TypeScript DOM tree construction...');
		const result = await this.constructDomTree(evalPage);
		logger.debug('✅ TypeScript DOM tree construction completed');

		return result;
	}

	/**
	 * Construct DOM tree from JavaScript evaluation result
	 */
	private async constructDomTree(evalPage: DOMEvalResult): Promise<[DOMElementNode, SelectorMap]> {
		const jsNodeMap = evalPage.map;
		const jsRootId = evalPage.rootId;

		const selectorMap = new Map<number, DOMElementNode>();
		const nodeMap = new Map<string, DOMBaseNode>();
		const childrenMapById = new Map<string, string[]>();

		// Pass 1: create all nodes (order-independent)
		for (const [id, nodeData] of Object.entries(jsNodeMap)) {
			const [node, childrenIds] = this.parseNode(nodeData);
			if (node === null) {
				continue;
			}

			nodeMap.set(id, node);
			childrenMapById.set(id, childrenIds);

			if (node instanceof DOMElementNodeImpl && node.highlightIndex !== null) {
				selectorMap.set(node.highlightIndex, node);
			}
		}

		// Pass 2: attach children (all nodes now exist in nodeMap regardless of insertion order)
		for (const [id, childrenIds] of childrenMapById) {
			const node = nodeMap.get(id);
			if (!(node instanceof DOMElementNodeImpl)) continue;

			for (const childId of childrenIds) {
				const childNode = nodeMap.get(childId);
				if (!childNode) continue;

				childNode.parent = node;
				node.children.push(childNode);
			}
		}

		const htmlToDict = nodeMap.get(jsRootId);

		if (!htmlToDict || !(htmlToDict instanceof DOMElementNodeImpl)) {
			throw new Error('Failed to parse HTML to dictionary');
		}

		return [htmlToDict, selectorMap];
	}

	/**
	 * Parse a single node from JavaScript result
	 */
	private parseNode(nodeData: any): [DOMBaseNode | null, string[]] {
		if (!nodeData) {
			return [null, []];
		}

		// Process text nodes
		if (nodeData.type === 'TEXT_NODE') {
			const textNode = new DOMTextNodeImpl(nodeData.text, nodeData.isVisible, null);
			return [textNode, []];
		}

		// Process viewport info if present
		let viewportInfo = null;
		if (nodeData.viewport) {
			viewportInfo = {
				width: nodeData.viewport.width,
				height: nodeData.viewport.height,
				scrollX: nodeData.viewport.scrollX,
				scrollY: nodeData.viewport.scrollY,
			};
		}

		// Create element node
		const shadowHostXPaths = nodeData.shadowHostXPaths ?? [];
		const elementNode = new DOMElementNodeImpl(
			nodeData.tagName,
			nodeData.xpath,
			nodeData.attributes || {},
			[], // children will be added later
			nodeData.isVisible ?? false,
			nodeData.isInteractive ?? false,
			nodeData.isScrollable ?? false,
			nodeData.markAsClickable ?? false,
			nodeData.isTopElement ?? false,
			nodeData.isInViewport ?? false,
			nodeData.shadowRoot ?? false,
			nodeData.highlightIndex ?? null,
			nodeData.viewportCoordinates ?? null,
			nodeData.pageCoordinates ?? null,
			viewportInfo,
			shadowHostXPaths,
			null // parent
		);

		const childrenIds = nodeData.children || [];

		return [elementNode, childrenIds];
	}
}
