/**
 * Knowledge image with hash and presigned URL
 */
export interface KnowledgeImage {
  /** SHA-256 hash of the image (64 hex chars) or UUID for backward compatibility */
  hash?: string;
  uuid?: string;
  /** Presigned S3 URL for the image */
  url: string;
}

/**
 * Preloaded knowledge from agent context
 */
export interface PreloadedKnowledge {
  id: number;
  content: string;
  type: 'system' | 'manual';
  platform: 'all' | 'desktop' | 'mobile';
  isAlwaysInclude: boolean;
  referencedImageHashes?: string[];
  /** Images with presigned URLs (from retrieve endpoint) */
  images?: KnowledgeImage[];
}
