/**
 * DOM node implementations
 * Structure follows the approach browser-use takes in views.py; the
 * implementation here is our own.
 */

import {
	DOMBaseNode,
	DOMTextNode,
	DOMElementNode,
	CoordinateSet,
	ViewportInfo,
	StringifyConfig,
	DEFAULT_INCLUDE_ATTRIBUTES,
	DEFAULT_INCLUDE_CLASSES_WITH_RENAME,
} from './types';
import { capTextLength } from './utils';

/**
 * Base DOM node implementation
 */
abstract class DOMBaseNodeImpl implements DOMBaseNode {
	constructor(
		public isVisible: boolean,
		public parent: DOMElementNode | null = null
	) {}
}

/**
 * DOM text node implementation
 */
export class DOMTextNodeImpl extends DOMBaseNodeImpl implements DOMTextNode {
	readonly type = 'TEXT_NODE' as const;

	constructor(
		public text: string,
		isVisible: boolean,
		parent: DOMElementNode | null = null
	) {
		super(isVisible, parent);
	}

	hasParentWithHighlightIndex(): boolean {
		let current = this.parent;
		while (current !== null) {
			if (current.highlightIndex !== null) {
				return true;
			}
			current = current.parent;
		}
		return false;
	}

	isParentInViewport(): boolean {
		if (this.parent === null) {
			return false;
		}
		return this.parent.isInViewport;
	}

	isParentTopElement(): boolean {
		if (this.parent === null) {
			return false;
		}
		return this.parent.isTopElement;
	}
}

/**
 * DOM element node implementation
 */
export class DOMElementNodeImpl extends DOMBaseNodeImpl implements DOMElementNode {
	public shadowHostXPaths: string[];

	constructor(
		public tagName: string,
		public xpath: string,
		public attributes: Record<string, string>,
		public children: DOMBaseNode[],
		isVisible: boolean,
		public isInteractive: boolean = false,
		public isScrollable: boolean = false,
		public markAsClickable: boolean = false,
		public isTopElement: boolean = false,
		public isInViewport: boolean = false,
		public shadowRoot: boolean = false,
		public highlightIndex: number | null = null,
		public viewportCoordinates: CoordinateSet | null = null,
		public pageCoordinates: CoordinateSet | null = null,
		public viewportInfo: ViewportInfo | null = null,
		shadowHostXPaths: string[] = [],
		parent: DOMElementNode | null = null
	) {
		super(isVisible, parent);
		this.shadowHostXPaths = shadowHostXPaths;
	}

	public isNew: boolean | null = null;

	getAllTextTillNextClickableElement(maxDepth: number = -1): string {
		const textParts: string[] = [];

		const collectText = (node: DOMBaseNode, currentDepth: number): void => {
			if (maxDepth !== -1 && currentDepth > maxDepth) {
				return;
			}

			// Skip this branch if we hit a highlighted element (except for current node)
			if (node instanceof DOMElementNodeImpl && node !== this && node.highlightIndex !== null) {
				return;
			}

			if (node instanceof DOMTextNodeImpl) {
				textParts.push(node.text);
			} else if (node instanceof DOMElementNodeImpl) {
				for (const child of node.children) {
					collectText(child, currentDepth + 1);
				}
			}
		};

		collectText(this, 0);
		return textParts.join('\n').trim();
	}

	clickableElementsToString(config?: StringifyConfig): string {
		const includeAttributes = config?.includeAttributes ?? DEFAULT_INCLUDE_ATTRIBUTES;
		const includeClassesWithRename = config?.includeClassesWithRename ?? DEFAULT_INCLUDE_CLASSES_WITH_RENAME;

		const formattedText: string[] = [];

		const processNode = (node: DOMBaseNode, depth: number): void => {
			let nextDepth = depth;
			const depthStr = '\t'.repeat(depth);

			if (node instanceof DOMElementNodeImpl) {
				// Add element with highlight_index
				if (node.highlightIndex !== null) {
					nextDepth += 1;

					const text = node.isScrollable ? '' : node.getAllTextTillNextClickableElement();
					let attributesHtmlStr: string | null = null;

					if (includeAttributes.length > 0) {
						const attributesToInclude: Record<string, string> = {};

						for (const key of Object.keys(node.attributes)) {
							if (includeAttributes.includes(key)) {
								const value = node.attributes[key].trim();
								if (value !== '') {
									attributesToInclude[key] = value;
								}
							}
						}

						// Remove duplicate attribute values
						const orderedKeys = includeAttributes.filter((key) => key in attributesToInclude);

						if (orderedKeys.length > 1) {
							const keysToRemove = new Set<string>();
							const seenValues: Record<string, string> = {};

							for (const key of orderedKeys) {
								const value = attributesToInclude[key];
								if (value.length > 5) {
									if (value in seenValues) {
										keysToRemove.add(key);
									} else {
										seenValues[value] = key;
									}
								}
							}

							for (const key of keysToRemove) {
								delete attributesToInclude[key];
							}
						}

						// If tag == role attribute, don't include it
						if (node.tagName === attributesToInclude['role']) {
							delete attributesToInclude['role'];
						}

						// Remove attributes that duplicate the node's text content
						const attrsToRemoveIfTextMatches = ['aria-label', 'placeholder', 'title'];
						for (const attr of attrsToRemoveIfTextMatches) {
							if (
								attributesToInclude[attr] &&
								attributesToInclude[attr].trim().toLowerCase() === text.trim().toLowerCase()
							) {
								delete attributesToInclude[attr];
							}
						}

						if (Object.keys(attributesToInclude).length > 0) {
							attributesHtmlStr = Object.entries(attributesToInclude)
								.map(([key, value]) => `${key}=${capTextLength(value, 200)}`)
								.join(' ');
						}
					}

					// Build the line
					const highlightIndicator = node.isNew ? `*[${node.highlightIndex}]` : `[${node.highlightIndex}]`;

					// Handle class filtering with regex patterns
					const filteredClasses: string[] = [];
					if (Object.keys(includeClassesWithRename).length > 0 && node.attributes['class']) {
						const classString = node.attributes['class'];
						const classes = classString.split(/\s+/);

						for (const cssClass of classes) {
							for (const [pattern, replacement] of Object.entries(includeClassesWithRename)) {
								try {
									const regex = new RegExp(`^${pattern}$`);
									const match = cssClass.match(regex);
									if (match) {
										const renamed = cssClass.replace(regex, replacement);
										if (renamed) {
											filteredClasses.push(renamed);
										}
										break;
									}
								} catch (e) {
									// Invalid regex pattern, skip it
									continue;
								}
							}
						}
					}

					const scrollableIndicator = node.isScrollable ? ' (SCROLLABLE)' : '';
					const clickableIndicator = node.markAsClickable ? ' (CLICKABLE)' : '';
					let line = `${depthStr}${highlightIndicator}${scrollableIndicator}${clickableIndicator}<${node.tagName}`;

					if (filteredClasses.length > 0) {
						line += ` ${filteredClasses.join(' ')}`;
					}
					if (attributesHtmlStr) {
						line += ` ${attributesHtmlStr}`;
					}

					if (text) {
						const trimmedText = text.trim();
						if (!attributesHtmlStr) {
							line += ' ';
						}
						line += `>${trimmedText}`;
					} else if (!attributesHtmlStr) {
						line += ' ';
					}

					line += ' />';
					formattedText.push(line);
				} else {
					const semanticAttributes = ['data-testid', 'data-test-id'];
					const filteredAttributes = semanticAttributes.filter(attr => node.attributes[attr]);
					if (filteredAttributes.length > 0) {
						nextDepth += 1;
						formattedText.push(`${depthStr}<${node.tagName} ${filteredAttributes.map(attr => `${attr}="${node.attributes[attr]}"`).join(' ')} />`);
					}
				}

				// Process children regardless
				for (const child of node.children) {
					processNode(child, nextDepth);
				}
			} else if (node instanceof DOMTextNodeImpl) {
				// Add text only if it doesn't have a highlighted parent
				if (node.hasParentWithHighlightIndex()) {
					return;
				}

				if (node.parent && node.parent.isVisible && node.parent.isTopElement) {
					formattedText.push(`${depthStr}${node.text}`);
				}
			}
		};

		processNode(this, 0);
		return formattedText.join('\n');
	}
}
