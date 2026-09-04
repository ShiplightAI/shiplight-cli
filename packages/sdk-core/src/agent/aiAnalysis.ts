/**
 * General-purpose AI analysis (agent.ai)
 *
 * Runs a natural-language prompt with optional local file attachments,
 * independent of the browser page. This is the only agent AI primitive that
 * is not page-bound — it lets tests reason over non-browser artifacts such
 * as files saved by wait_for_download_complete.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateText, UserContent } from 'ai';
import type { TokenUsage } from 'shiplight-types';
import { convertUsageToTokenUsage } from '../utils/tokenUsage';
import { getModel, getProviderOptions, resolveTemperature } from './llm';
import { withLlmTimeout } from './llm/timeout';

/** Per-file size cap, aligned with provider inline-attachment limits. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const DOCUMENT_MEDIA_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
};

const TEXT_EXTENSIONS = new Set([
  '.txt', '.csv', '.tsv', '.json', '.md', '.markdown',
  '.html', '.htm', '.xml', '.yaml', '.yml', '.log',
]);

export interface AiAnalysisResult {
  text: string;
  tokenUsage: TokenUsage | null;
}

/** UserContent minus the bare-string form — the part-array shape we build. */
type ContentParts = Exclude<UserContent, string>;

/**
 * Validate an attachment and convert it to AI SDK user-content parts.
 * Text files are inlined as labeled text blocks (works across all providers);
 * images and PDFs become native image/file parts.
 */
async function fileToContentParts(filePath: string): Promise<{ parts: ContentParts; imageCount: number }> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    throw new Error(`agent.ai: file not found or unreadable: ${filePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`agent.ai: not a file: ${filePath}`);
  }
  if (stat.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `agent.ai: file exceeds the ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB attachment limit ` +
      `(${stat.size} bytes): ${filePath}`,
    );
  }

  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);

  if (IMAGE_MEDIA_TYPES[ext]) {
    return {
      parts: [{ type: 'file', data: await fs.promises.readFile(filePath), mediaType: IMAGE_MEDIA_TYPES[ext], filename }],
      imageCount: 1,
    };
  }

  if (DOCUMENT_MEDIA_TYPES[ext]) {
    return {
      parts: [{ type: 'file', data: await fs.promises.readFile(filePath), mediaType: DOCUMENT_MEDIA_TYPES[ext], filename }],
      imageCount: 0,
    };
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return {
      parts: [{ type: 'text', text: `File: ${filename}\n---\n${content}\n---` }],
      imageCount: 0,
    };
  }

  throw new Error(
    `agent.ai: ${ext ? `unsupported attachment type "${ext}"` : 'file has no extension, cannot determine attachment type'} (${filePath}). ` +
    `Supported: PDF, images (${Object.keys(IMAGE_MEDIA_TYPES).join(', ')}), ` +
    `and text files (${[...TEXT_EXTENSIONS].join(', ')}). ` +
    `For other formats, parse the file in code and pass the extracted text in the prompt.`,
  );
}

/**
 * Execute a natural-language prompt with optional file attachments.
 * Attachments are placed before the prompt (providers follow documents-first prompts more reliably).
 *
 * @param prompt - Natural-language instruction or question
 * @param files - Local file paths to attach (PDF, image, or text formats)
 * @param modelString - Model identifier from the agent's configuration
 */
export async function runAiAnalysis(prompt: string, files: string[], modelString: string): Promise<AiAnalysisResult> {
  const content: ContentParts = [];
  let imageCount = 0;

  for (const filePath of files) {
    const { parts, imageCount: count } = await fileToContentParts(filePath);
    content.push(...parts);
    imageCount += count;
  }

  content.push({ type: 'text', text: prompt });

  // Sampling-free Anthropic models (Opus 4.7/4.8, Sonnet 5, Fable 5) reject a
  // non-default temperature with a 400 — omit the field for those.
  const temperature = resolveTemperature(modelString, undefined);
  const result = await withLlmTimeout((abortSignal) =>
    generateText({
      model: getModel(modelString),
      abortSignal,
      messages: [{ role: 'user', content }],
      ...(temperature !== undefined ? { temperature } : {}),
      providerOptions: getProviderOptions(modelString, imageCount),
    }),
  );

  return {
    text: result.text,
    tokenUsage: convertUsageToTokenUsage(result.usage, modelString),
  };
}
