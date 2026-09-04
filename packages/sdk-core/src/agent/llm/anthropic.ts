/**
 * Anthropic Provider
 *
 * Provides Anthropic Claude model instances via Vercel AI SDK.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { getSdkConfig } from '../../config';
import logger from '../../utils/logger';
import { getAnthropicProxyBaseURL } from './proxy';
import { LLMProviderNotConfiguredError } from './errors';

function isTruthy(value?: string): boolean {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function shouldUseVertexForAnthropic(): boolean {
	// Read from SdkConfig.env only. sdk-core never reads process.env directly
	// for runtime env vars — all vars must flow through the explicit allowlist
	// set by the caller via configureSdk().
	return isTruthy(getSdkConfig().env?.ANTHROPIC_MODELS_USE_VERTEXAI);
}

/**
 * Get Anthropic Claude model
 *
 * The model id is passed straight through to the AI SDK (or the Vertex Anthropic
 * publisher) — there is no allowlist here, so any current Claude id works, with
 * or without a date suffix (e.g. claude-sonnet-5-20260101). Current ids include:
 * - claude-sonnet-5, claude-opus-4-8, claude-haiku-4-5
 * - older: claude-sonnet-4-6, claude-opus-4-6
 *
 * Environment variables (in SDK config):
 * - ANTHROPIC_API_KEY: Anthropic API key (direct path; takes precedence)
 * - ANTHROPIC_MODELS_USE_VERTEXAI: Route via Vertex AI Anthropic publisher
 *   (requires GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION)
 * - SHIPLIGHT_API_TOKEN: Shiplight cloud token; routes through Shiplight LLM
 *   proxy when no direct ANTHROPIC_API_KEY is set. v2 tokens (shp_*: shp_pat_*
 *   personal access tokens, shp_ctx_* scoped runtime credentials) must carry
 *   the `llm:invoke` scope (enforced by the cloud service).
 * - SHIPLIGHT_API_URL: Override proxy base URL
 */
export function getAnthropicModel(modelName: string): LanguageModelV4 {
	const config = getSdkConfig();
	if (shouldUseVertexForAnthropic()) {
		const project = config.env?.GOOGLE_CLOUD_PROJECT;
		const location = config.env?.GOOGLE_CLOUD_LOCATION;
		if (!project) {
			throw new Error(
				'GOOGLE_CLOUD_PROJECT is required when ANTHROPIC_MODELS_USE_VERTEXAI is enabled'
			);
		}
		if (!location) {
			throw new Error(
				'GOOGLE_CLOUD_LOCATION is required when ANTHROPIC_MODELS_USE_VERTEXAI is enabled'
			);
		}

		logger.debug(`Using Anthropic via Vertex AI provider: model=${modelName}, project=${project}, location=${location}`);
		const vertexAnthropic = createVertexAnthropic({
			project,
			location,
		});
		return vertexAnthropic(modelName);
	}

	const apiKey = config.env?.ANTHROPIC_API_KEY;
	if (apiKey) {
		logger.debug(`Using Anthropic provider: model=${modelName}`);
		const anthropic = createAnthropic({ apiKey });
		return anthropic(modelName);
	}

	const shiplightToken = config.env?.SHIPLIGHT_API_TOKEN;
	if (shiplightToken) {
		const baseURL = getAnthropicProxyBaseURL(shiplightToken, config.env?.SHIPLIGHT_API_URL);
		logger.debug(`Using Shiplight LLM proxy (Anthropic): model=${modelName}, baseURL=${baseURL}`);
		const anthropic = createAnthropic({ apiKey: shiplightToken, baseURL });
		return anthropic(modelName);
	}

	throw new LLMProviderNotConfiguredError('ANTHROPIC_API_KEY not configured in SDK config');
}

/**
 * Whether an Anthropic model still accepts sampling parameters
 * (`temperature` / `top_p` / `top_k`).
 *
 * Anthropic removed sampling parameters starting with its "sampling-free"
 * generation — Opus 4.7, Opus 4.8, Sonnet 5, and Fable 5 / Mythos 5 — where
 * sending a *non-default* value (the web agent sends temperature 0 for
 * determinism; the API default is 1) returns HTTP 400 `invalid_request_error`.
 * A 400 is non-retryable and does not trigger model fallback, so an unconditional
 * `temperature` silently poisons every sampling-free model in the fallback chain.
 *
 * Older models still accept it: Opus ≤4.6, Sonnet ≤4.6, all Haiku 3.x/4.x, and
 * the claude-2/claude-3 era. We allowlist those families (matching current model
 * ids, with or without a date suffix) and omit sampling params for everything
 * else Anthropic — so future models, which follow the removal trend, default to
 * safe omission (running at the model's default temperature) rather than a
 * deterministic 400. Bare model id only — strip any `provider:` prefix first.
 */
export function anthropicModelSupportsSamplingParams(modelName: string): boolean {
	return /^claude-(opus-4-[0-6]|sonnet-4-[0-6]|haiku-[34]|[23])/.test(modelName);
}

/**
 * Provider options type for Anthropic
 */
export type AnthropicProviderOptionsResult = {
	anthropic?: {
		structuredOutputMode?: 'outputFormat' | 'jsonTool' | 'auto';
	};
};

/**
 * Get Anthropic provider options
 *
 * Uses 'jsonTool' structured output mode for Claude models.
 * This mode uses tool calling internally to enforce JSON schema.
 */
export function getAnthropicProviderOptions(_modelName: string): AnthropicProviderOptionsResult {
	return {
		anthropic: {
			structuredOutputMode: 'jsonTool',
		},
	};
}
