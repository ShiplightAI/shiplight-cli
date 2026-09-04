/**
 * History tree processor for DOM state tracking
 * Approach follows browser-use's history_tree_processor; the implementation
 * here is our own.
 */

import { createHash } from 'crypto';
import { DOMElementNode, DOMHistoryElement, HashedDomElement } from '../types';
import { DOMElementNodeImpl } from '../nodes';

/**
 * Operations on DOM elements for history tracking
 */
export class HistoryTreeProcessor {
	/**
	 * Convert DOM element to history element
	 */
	static convertDomElementToHistoryElement(domElement: DOMElementNode): DOMHistoryElement {
		const parentBranchPath = this.getParentBranchPath(domElement);
		const cssSelector = this.generateCssSelector(domElement);

		return {
			tagName: domElement.tagName,
			xpath: domElement.xpath,
			highlightIndex: domElement.highlightIndex,
			entireParentBranchPath: parentBranchPath,
			attributes: domElement.attributes,
			shadowRoot: domElement.shadowRoot,
			cssSelector,
			pageCoordinates: domElement.pageCoordinates,
			viewportCoordinates: domElement.viewportCoordinates,
			viewportInfo: domElement.viewportInfo,
		};
	}

	/**
	 * Find history element in DOM tree
	 */
	static findHistoryElementInTree(
		domHistoryElement: DOMHistoryElement,
		tree: DOMElementNode
	): DOMElementNode | null {
		const hashedDomHistoryElement = this.hashDomHistoryElement(domHistoryElement);

		const processNode = (node: DOMElementNode): DOMElementNode | null => {
			if (node.highlightIndex !== null) {
				const hashedNode = this.hashDomElement(node);
				if (this.compareHashes(hashedNode, hashedDomHistoryElement)) {
					return node;
				}
			}

			for (const child of node.children) {
				if (child instanceof DOMElementNodeImpl) {
					const result = processNode(child);
					if (result !== null) {
						return result;
					}
				}
			}

			return null;
		};

		return processNode(tree);
	}

	/**
	 * Compare history element and DOM element
	 */
	static compareHistoryElementAndDomElement(
		domHistoryElement: DOMHistoryElement,
		domElement: DOMElementNode
	): boolean {
		const hashedHistoryElement = this.hashDomHistoryElement(domHistoryElement);
		const hashedDomElement = this.hashDomElement(domElement);
		return this.compareHashes(hashedHistoryElement, hashedDomElement);
	}

	/**
	 * Hash DOM history element
	 */
	static hashDomHistoryElement(domHistoryElement: DOMHistoryElement): HashedDomElement {
		const branchPathHash = this.parentBranchPathHash(domHistoryElement.entireParentBranchPath);
		const attributesHash = this.attributesHash(domHistoryElement.attributes);
		const xpathHash = this.xpathHash(domHistoryElement.xpath);

		return {
			branchPathHash,
			attributesHash,
			xpathHash,
		};
	}

	/**
	 * Hash DOM element
	 */
	static hashDomElement(domElement: DOMElementNode): HashedDomElement {
		const parentBranchPath = this.getParentBranchPath(domElement);
		const branchPathHash = this.parentBranchPathHash(parentBranchPath);
		const attributesHash = this.attributesHash(domElement.attributes);
		const xpathHash = this.xpathHash(domElement.xpath);

		return {
			branchPathHash,
			attributesHash,
			xpathHash,
		};
	}

	/**
	 * Get parent branch path (list of tag names from root to element)
	 */
	private static getParentBranchPath(domElement: DOMElementNode): string[] {
		const parents: DOMElementNode[] = [];
		let currentElement: DOMElementNode | null = domElement;

		while (currentElement !== null && currentElement.parent !== null) {
			parents.push(currentElement);
			currentElement = currentElement.parent;
		}

		parents.reverse();
		return parents.map((parent) => parent.tagName);
	}

	/**
	 * Hash parent branch path
	 */
	private static parentBranchPathHash(parentBranchPath: string[]): string {
		const parentBranchPathString = parentBranchPath.join('/');
		return createHash('sha256').update(parentBranchPathString).digest('hex');
	}

	/**
	 * Hash attributes
	 */
	private static attributesHash(attributes: Record<string, string>): string {
		const attributesString = Object.entries(attributes)
			.map(([key, value]) => `${key}=${value}`)
			.join('');
		return createHash('sha256').update(attributesString).digest('hex');
	}

	/**
	 * Hash xpath
	 */
	private static xpathHash(xpath: string): string {
		return createHash('sha256').update(xpath).digest('hex');
	}

	/**
	 * Compare two hashed elements
	 */
	private static compareHashes(hash1: HashedDomElement, hash2: HashedDomElement): boolean {
		return (
			hash1.branchPathHash === hash2.branchPathHash &&
			hash1.attributesHash === hash2.attributesHash &&
			hash1.xpathHash === hash2.xpathHash
		);
	}

	/**
	 * Generate CSS selector for element (simplified version)
	 */
	private static generateCssSelector(domElement: DOMElementNode): string | null {
		// Simple implementation - can be enhanced
		const id = domElement.attributes['id'];
		if (id) {
			return `#${id}`;
		}

		const classes = domElement.attributes['class'];
		if (classes) {
			const classList = classes.split(/\s+/).filter((c) => c.trim());
			if (classList.length > 0) {
				return `${domElement.tagName}.${classList.join('.')}`;
			}
		}

		return domElement.tagName;
	}
}
