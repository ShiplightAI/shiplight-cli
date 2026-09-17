/**
 * OpenRouter Provider
 *
 * Provides OpenRouter model instances through the official Vercel AI SDK
 * provider. Model ids use OpenRouter's upstream-qualified slug format, for
 * example `openai/gpt-4o` or `anthropic/claude-sonnet-4.6`.
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { getSdkConfig } from '../../config';
import logger from '../../utils/logger';
import { LLMProviderNotConfiguredError } from './errors';

export function getOpenRouterModel(modelName: string): LanguageModelV4 {
  const apiKey = getSdkConfig().env?.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new LLMProviderNotConfiguredError('OPENROUTER_API_KEY not configured in SDK config');
  }

  logger.debug(`Using OpenRouter provider: model=${modelName}`);
  const openrouter = createOpenRouter({ apiKey, compatibility: 'strict' });
  return openrouter(modelName);
}

export type OpenRouterProviderOptionsResult = Record<string, never>;

export function getOpenRouterProviderOptions(_modelName: string): OpenRouterProviderOptionsResult {
  return {};
}
