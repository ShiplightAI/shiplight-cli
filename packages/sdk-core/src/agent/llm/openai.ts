/**
 * OpenAI Provider
 *
 * Provides OpenAI model instances via Vercel AI SDK.
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { getSdkConfig } from '../../config';
import logger from '../../utils/logger';
import { getOpenAIProxyBaseURL } from './proxy';
import { LLMProviderNotConfiguredError } from './errors';

/**
 * Get OpenAI model
 *
 * The model id is passed straight through to the AI SDK — there is no allowlist
 * here, so any current OpenAI id works. Current ids include:
 * - gpt-5.4, gpt-5.4-mini, gpt-5.5
 * - reasoning: o3, o4-mini
 * - older: gpt-4o, gpt-4o-mini, gpt-4-turbo
 *
 * Environment variables (in SDK config):
 * - OPENAI_API_KEY: OpenAI API key (direct path; takes precedence)
 * - OPENAI_BASE_URL: Custom base URL for OpenAI-compatible APIs (only honored
 *   alongside OPENAI_API_KEY — Shiplight proxy users do not set this)
 * - SHIPLIGHT_API_TOKEN: Shiplight cloud token; routes shp_* tokens like
 *   shp_pat_* and shp_ctx_* through the Shiplight LLM proxy when no direct
 *   OPENAI_API_KEY is set. Tokens must carry the `llm:invoke` scope.
 * - SHIPLIGHT_API_URL: Override proxy base URL (defaults resolved by
 *   token prefix); useful for staging or local dev
 */
export function getOpenAIModel(modelName: string): LanguageModelV4 {
	const config = getSdkConfig();
	const apiKey = config.env?.OPENAI_API_KEY;

	if (apiKey) {
		const baseURL = config.env?.OPENAI_BASE_URL;
		logger.debug(`Using OpenAI provider: model=${modelName}${baseURL ? `, baseURL=${baseURL}` : ''}`);
		const openai = createOpenAI({ apiKey, baseURL });
		return openai(modelName);
	}

	const shiplightToken = config.env?.SHIPLIGHT_API_TOKEN;
	if (shiplightToken) {
		const baseURL = getOpenAIProxyBaseURL(shiplightToken, config.env?.SHIPLIGHT_API_URL);
		logger.debug(`Using Shiplight LLM proxy (OpenAI): model=${modelName}, baseURL=${baseURL}`);
		const openai = createOpenAI({ apiKey: shiplightToken, baseURL });
		return openai(modelName);
	}

	throw new LLMProviderNotConfiguredError('OPENAI_API_KEY not configured in SDK config');
}

/**
 * Provider options type for OpenAI
 */
export type OpenAIProviderOptionsResult = Record<string, never>;

/**
 * Get OpenAI provider options
 *
 * OpenAI models work without additional provider options.
 */
export function getOpenAIProviderOptions(_modelName: string): OpenAIProviderOptionsResult {
	return {};
}
