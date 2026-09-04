/**
 * DOM module for extracting and processing DOM elements
 * Structure follows the approach of browser-use's Python DOM module; the
 * implementation here is our own.
 */

export { DomService } from './service';
export { DOMElementNodeImpl, DOMTextNodeImpl } from './nodes';
export { HistoryTreeProcessor } from './history/processor';
export * from './types';
export * from './utils';
