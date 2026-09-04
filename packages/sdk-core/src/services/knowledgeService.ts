/**
 * Knowledge Service - Retrieves and parses knowledge for action generation
 *
 * This module provides knowledge retrieval and parsing utilities, including
 * support for multimodal knowledge content (text + images).
 *
 * Originally from the v1 Python backend's knowledge_parser, which is not
 * part of this repository.
 */

import { TextPart, FilePart } from 'ai';
import { PreloadedKnowledge } from 'shiplight-types';
/**
 * Knowledge item structure with images
 */
export interface KnowledgeItem {
  /** Knowledge content with markdown image placeholders */
  content: string;
  /** Optional images referenced in the content */
  images?: Array<{
    /** Image hash (SHA-256) or UUID for backward compatibility */
    hash?: string;
    uuid?: string;
    /** Image URL (S3 presigned URL or other) */
    url: string;
  }>;
  /** Knowledge source/category */
  source?: string;
  /** Relevance score (0-1) */
  relevance?: number;
}

/**
 * Parse knowledge content and split it around image placeholders.
 *
 * This function parses markdown image syntax like `![alt](image:hash)` and
 * splits the content into text and image parts for multimodal message construction.
 *
 * @param content - The knowledge content with image placeholders like ![alt](image:uuid)
 * @param images - List of image objects with 'hash'/'uuid' and 'url' keys
 * @returns List of tuples (content_type, content) where:
 *   - ('text', text_content) for text parts
 *   - ('image', image_url) for images
 *
 * @example
 * Input:
 *   content: "Step 1: Click ![Login](image:abc-123) then enter password"
 *   images: [{ hash: "abc-123", url: "https://s3..." }]
 * Output:
 *   [
 *     ['text', 'Step 1: Click '],
 *     ['image', 'https://s3...'],
 *     ['text', ' then enter password']
 *   ]
 */
export function parseKnowledgeWithImages(
  content: string,
  images: Array<{ hash?: string; uuid?: string; url: string }>
): Array<TextPart | FilePart> {
  // Create hash to URL mapping (supporting both 'uuid' and 'hash' fields for compatibility)
  const hashToUrl: Map<string, string> = new Map();

  for (const img of images) {
    // Support both 'uuid' (old) and 'hash' (new) field names
    if (img.hash && img.url) {
      hashToUrl.set(img.hash, img.url);
    } else if (img.uuid && img.url) {
      hashToUrl.set(img.uuid, img.url);
    }
  }

  // Pattern to match markdown images with image:hash placeholder
  // Matches: ![alt text](image:hash) where hash is 64 hex chars (SHA-256)
  // Also supports old UUID format for backward compatibility
  const pattern = /!\[([^\]]*)\]\(image:([a-f0-9]{64}|[a-zA-Z0-9\-]+)\)/g;

  const parts: Array<TextPart | FilePart> = [];
  let lastEnd = 0;

  // Find all matches
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    // Add text before the image
    const textBefore = content.slice(lastEnd, match.index);
    if (textBefore) {
      parts.push({ type: 'text', text: textBefore });
    }

    // Get the hash/uuid and find corresponding URL
    // match[1] is alt text (not used currently)
    const hashOrUuid = match[2];

    if (hashToUrl.has(hashOrUuid)) {
      // Add the image with its URL
      // Subtype is unknown for a remote knowledge image; the top-level IANA
      // segment alone is a valid mediaType.
      parts.push({ type: 'file', mediaType: 'image', data: new URL(hashToUrl.get(hashOrUuid)!) });
    } else {
      // If no URL found, keep the original markdown
      parts.push({ type: 'text', text: match[0] });
    }

    lastEnd = match.index + match[0].length;
  }

  // Add any remaining text after the last image
  const remainingText = content.slice(lastEnd);
  if (remainingText) {
    parts.push({ type: 'text', text: remainingText });
  }

  // If no parts were created (no images found), return the whole content as text
  if (parts.length === 0) {
    parts.push({ type: 'text', text: content });
  }

  return parts;
}

/**
 * Process multiple knowledge items with images into a single list of content parts.
 *
 * @param knowledgeItems - List of knowledge items with 'content' and 'images' keys
 * @returns Flattened list of content parts ready for multimodal message construction
 */
export function createMultimodalContentParts(
  knowledgeItems: KnowledgeItem[]
): Array<TextPart | FilePart> {
  const allParts: Array<TextPart | FilePart> = [];

  for (const item of knowledgeItems) {
    const content = item.content || '';
    const images = item.images || [];

    // Parse this knowledge item
    const parts = parseKnowledgeWithImages(content, images);

    // Add separator between knowledge items
    if (allParts.length > 0 && parts.length > 0) {
      allParts.push({ type: 'text', text: '\n\n' });
    }

    allParts.push(...parts);
  }

  return allParts;
}

/**
 * Default feature flag: Enable knowledge images in LLM prompts
 * This is the fallback when organization settings are not available.
 */
export const DEFAULT_ENABLE_KNOWLEDGE_IMAGES = false;

/**
 * Create content parts specifically for LLM knowledge injection.
 *
 * This function wraps knowledge content with special tags and converts it to
 * text-only or multimodal format depending on the enableImages parameter.
 *
 * @param knowledgeItems - List of knowledge items with 'content' and 'images' keys
 * @param enableImages - Whether to include images (defaults to DEFAULT_ENABLE_KNOWLEDGE_IMAGES)
 * @returns Array of MessageContent parts ready for LLM consumption
 *
 * @example
 * Output format (text-only when enableImages=false):
 *   [
 *     { type: "text", text: "<retrieved_knowledge>..." },
 *     { type: "text", text: "Knowledge content..." },
 *     { type: "text", text: "</retrieved_knowledge>" }
 *   ]
 *
 * Output format (multimodal when enableImages=true):
 *   [
 *     { type: "text", text: "<retrieved_knowledge>..." },
 *     { type: "text", text: "Knowledge content..." },
 *     { type: "file", mediaType: "image", data: URL(...) },
 *     { type: "text", text: "</retrieved_knowledge>" }
 *   ]
 */
export function createKnowledgeParts(
  knowledgeItems: KnowledgeItem[],
  enableImages: boolean = DEFAULT_ENABLE_KNOWLEDGE_IMAGES
): Array<TextPart | FilePart> {
  if (enableImages) {
    // Multimodal: include images
    const parts = createMultimodalContentParts(knowledgeItems);
    if (parts.length === 0) {
      return [];
    }

    const preamble: TextPart = {
      type: 'text',
      text: '\n\n<retrieved_knowledge>\n\nBelow are expert curated knowledge that are retrieved from the knowledge base; APPLY THESE KNOWLEDGES IF THEY ARE RELEVANT TO THE TASK:\n',
    };

    const postamble: TextPart = {
      type: 'text',
      text: '\n\n</retrieved_knowledge>\n\n',
    };

    return [preamble, ...parts, postamble];
  } else {
    // Text-only: exclude knowledge items that have images (text doesn't make sense without images)
    const textOnlyItems = knowledgeItems.filter(item => !item.images || item.images.length === 0);

    const textContent = textOnlyItems
      .map(item => item.content || '')
      .filter(content => content.length > 0)
      .join('\n\n');

    if (!textContent) {
      return [];
    }

    const preamble: TextPart = {
      type: 'text',
      text: '\n\n<retrieved_knowledge>\n\nBelow are expert curated knowledge that are retrieved from the knowledge base; APPLY THESE KNOWLEDGES IF THEY ARE RELEVANT TO THE TASK:\n',
    };

    const content: TextPart = {
      type: 'text',
      text: textContent,
    };

    const postamble: TextPart = {
      type: 'text',
      text: '\n\n</retrieved_knowledge>\n\n',
    };

    return [preamble, content, postamble];
  }
}

/**
 * Count the number of images in knowledge parts
 * Returns 0 if enableImages is false
 * @param knowledgeItems - List of knowledge items
 * @param enableImages - Whether images are enabled (defaults to DEFAULT_ENABLE_KNOWLEDGE_IMAGES)
 */
export function countKnowledgeImages(
  knowledgeItems: KnowledgeItem[],
  enableImages: boolean = DEFAULT_ENABLE_KNOWLEDGE_IMAGES
): number {
  if (!enableImages) {
    return 0;
  }
  let count = 0;
  for (const item of knowledgeItems) {
    if (item.images) {
      count += item.images.length;
    }
  }
  return count;
}

/**
 * Knowledge Service for retrieving relevant knowledge
 */
export class KnowledgeService {
  /**
   * Retrieve relevant knowledge for a statement
   *
   * @param statement - Natural language statement
   * @param preloadedKnowledges - Optional preloaded knowledges from agent context
   * @returns Array of relevant knowledge items
   *
   * Implementation:
   * - If preloadedKnowledges are provided, returns all of them converted to KnowledgeItem format
   *   (semantic matching is not available locally - all knowledges are included)
   * - For runtime (sandbox/runner), semantic matching should be done via API before passing here
   * - For offline mode, all knowledges are included in the export
   */
  async retrieve(_statement: string, preloadedKnowledges?: PreloadedKnowledge[]): Promise<KnowledgeItem[]> {
    // If preloaded knowledges are available, convert and return them
    if (preloadedKnowledges && preloadedKnowledges.length > 0) {
      return preloadedKnowledges.map(knowledge => ({
        content: knowledge.content,
        // Pass through images with presigned URLs (from retrieve endpoint)
        images: knowledge.images,
        source: knowledge.type,
        relevance: knowledge.isAlwaysInclude ? 1.0 : 0.5,
      }));
    }

    // No knowledges available
    return [];
  }
}
