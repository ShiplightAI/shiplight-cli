/**
 * Utility for loading organization knowledge from exported JSON files
 */

import * as fs from 'fs/promises';
import logger from './logger';

/**
 * Knowledge data structure matching the exported format
 */
export interface KnowledgeData {
  id: number;
  content: string;
  type: 'system' | 'manual';
  platform: 'all' | 'desktop' | 'mobile';
  isAlwaysInclude: boolean;
  referencedImageHashes?: string[];
  /** Images with presigned URLs (included in export) */
  images?: Array<{
    hash?: string;
    uuid?: string;
    url: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Pre-computed statement to knowledge mapping
 */
export interface KnowledgeMapping {
  /** The original statement text */
  text: string;
  /** Relevant knowledge IDs in order of relevance */
  knowledgeIds: number[];
}

/**
 * Load knowledges from a JSON file
 * @param path The path to the JSON file containing knowledge definitions
 * @returns Array of knowledge data
 */
export async function loadKnowledges(path: string): Promise<KnowledgeData[]> {
  try {
    const fileContent = await fs.readFile(path, 'utf8');
    const knowledges = JSON.parse(fileContent) as KnowledgeData[];
    logger.info(`Loaded ${knowledges.length} knowledges from file`);
    return knowledges;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      logger.debug('No knowledges file found');
      return [];
    }
    logger.error('Failed to load knowledges:', error);
    throw error;
  }
}

/**
 * Load knowledge mappings from a JSON file for offline semantic search
 * @param path The path to the JSON file containing knowledge mappings
 * @returns Array of knowledge mappings
 */
export async function loadKnowledgeMappings(path: string): Promise<KnowledgeMapping[]> {
  try {
    const fileContent = await fs.readFile(path, 'utf8');
    const mappings = JSON.parse(fileContent) as KnowledgeMapping[];
    logger.info(`Loaded ${mappings.length} knowledge mappings from file`);
    return mappings;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      logger.debug('No knowledge mappings file found');
      return [];
    }
    logger.error('Failed to load knowledge mappings:', error);
    throw error;
  }
}
