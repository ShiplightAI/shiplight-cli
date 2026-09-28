/**
 * Google AI Provider
 *
 * Provides Google AI and Vertex AI model instances via Vercel AI SDK.
 */

import { createGoogleGenerativeAI, GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { getSdkConfig } from '../../config';
import logger from '../../utils/logger';
import { getGoogleProxyBaseURL } from './proxy';
import { LLMProviderNotConfiguredError } from './errors';

// Inline MediaResolution values to avoid importing @google/genai which pulls in child_process
const MediaResolution = {
	MEDIA_RESOLUTION_HIGH: 'MEDIA_RESOLUTION_HIGH',
	MEDIA_RESOLUTION_MEDIUM: 'MEDIA_RESOLUTION_MEDIUM',
	MEDIA_RESOLUTION_LOW: 'MEDIA_RESOLUTION_LOW',
} as const;

/**
 * Check if Vertex AI is being used based on SDK config
 * Only checks explicit GOOGLE_GENAI_USE_VERTEXAI flag for clarity
 */
export function isUsingVertexAI(): boolean {
	const config = getSdkConfig();
	const env = config.env || {};
	const useVertexAIFlag = env.GOOGLE_GENAI_USE_VERTEXAI;
	return useVertexAIFlag === 'True' || useVertexAIFlag === 'true';
}

/**
 * Get Google AI model with support for:
 * 1. Vertex AI (via GOOGLE_GENAI_USE_VERTEXAI flag or GOOGLE_CLOUD_PROJECT)
 * 2. API key from SDK config
 * 3. Default Google AI SDK
 *
 * Environment variables (in SDK config first):
 * - GOOGLE_GENAI_USE_VERTEXAI: Set to "True" or "true" to force Vertex AI
 * - GOOGLE_CLOUD_PROJECT: GCP project ID for Vertex AI
 * - GOOGLE_CLOUD_LOCATION: GCP region (default: us-central1)
 * - GOOGLE_APPLICATION_CREDENTIALS: Path to service account JSON (read by google-auth-library)
 * - GOOGLE_API_KEY: Direct Google AI Studio API key (takes precedence over Shiplight token)
 * - SHIPLIGHT_API_TOKEN: Shiplight cloud token; routes through Shiplight LLM
 *   proxy when no GOOGLE_API_KEY is set and Vertex isn't enabled. v2 tokens
 *   (shp_*: shp_pat_* personal access tokens, shp_ctx_* scoped runtime
 *   credentials) must carry the `llm:invoke` scope (enforced by the cloud service).
 * - SHIPLIGHT_API_URL: Override proxy base URL
 */
export function getGoogleModel(modelName: string): LanguageModelV4 {
	const config = getSdkConfig();
	const env = config.env || {};

	if (isUsingVertexAI()) {
		const vertexProject = env.GOOGLE_CLOUD_PROJECT;
		if (!vertexProject) {
			throw new Error('GOOGLE_CLOUD_PROJECT is required when using Vertex AI');
		}
		// gemini-3* preview models are only in the "global" Vertex location
		// (gemini-3-flash-preview, gemini-3.1-pro-preview, etc.).
		// The 2.5 family stays on GOOGLE_CLOUD_LOCATION (us-central1 by default).
		const vertexLocation = modelName.startsWith('gemini-3') ? 'global' : env.GOOGLE_CLOUD_LOCATION;
		if (!vertexLocation) {
			throw new Error('GOOGLE_CLOUD_LOCATION is required when using Vertex AI');
		}
		logger.debug(`Using Vertex AI provider: model=${modelName}, location=${vertexLocation}`);
		const vertexProvider = createVertex({
			project: vertexProject,
			location: vertexLocation,
		});
		return vertexProvider(modelName);
	}

	const apiKey = env.GOOGLE_API_KEY;
	if (apiKey) {
		logger.debug(`Using Google AI provider (API key): model=${modelName}`);
		const googleProvider = createGoogleGenerativeAI({ apiKey });
		return googleProvider(modelName);
	}

	const shiplightToken = env.SHIPLIGHT_API_TOKEN;
	if (shiplightToken) {
		const baseURL = getGoogleProxyBaseURL(shiplightToken, env.SHIPLIGHT_API_URL);
		logger.debug(`Using Shiplight LLM proxy (Google): model=${modelName}, baseURL=${baseURL}`);
		const googleProvider = createGoogleGenerativeAI({ apiKey: shiplightToken, baseURL });
		return googleProvider(modelName);
	}

	throw new LLMProviderNotConfiguredError(
		'Google API key is missing. Set GOOGLE_API_KEY in SDK config or environment.'
	);
}

/**
 * Provider options type for Google/Vertex AI
 * In AI SDK v6, Vertex AI uses 'vertex' key while Google AI uses 'google' key
 */
export type GoogleProviderOptionsResult = {
	google?: GoogleGenerativeAIProviderOptions;
	vertex?: GoogleGenerativeAIProviderOptions;
};

type GeminiThinkingConfig = NonNullable<GoogleGenerativeAIProviderOptions['thinkingConfig']>;

/**
 * Gemini 3 or later. Follows the same rule as @ai-sdk/google's internal
 * `usesGemini3Features` (not exported), minus its gemini-robotics-er-1.5 special
 * case: a Gemini id that is not a known 1.x/2.x model is treated as Gemini 3 or
 * later, so a new model gets the newer API.
 */
function isGemini3OrLaterModel(modelName: string): boolean {
	if (!/(^|\/)gemini-/i.test(modelName)) return false;
	const isPreGemini3 =
		/(^|\/)gemini-[12](?:[.-]|$)/i.test(modelName) || /(^|\/)gemini-pro(?:-vision)?$/i.test(modelName);
	return !isPreGemini3;
}

/**
 * Thinking control for a Gemini model.
 *
 * Gemini 2.x takes only a token budget; Gemini 3 and later take a thinking level.
 * Non-Gemini ids on this path keep the token budget they always had.
 * Vertex rejects the wrong field with a non-retryable HTTP 400, and a 400 does
 * not trigger model fallback, so the wrong field fails the call. Observed on
 * Vertex (2026-09-28): `thinkingLevel` is rejected by gemini-2.5-flash/-pro, and
 * `thinkingBudget` is rejected on about half of gemini-3.5-flash calls
 * ("Thinking budget is not supported for this model.").
 *
 * The level is `low`, the lowest level every Gemini 3 model we route accepts:
 * gemini-3.8-flash and gemini-3.1-pro-preview reject `minimal`.
 * gemini-3-flash-preview accepts `minimal` and keeps it.
 */
function getGeminiThinkingConfig(modelName: string): GeminiThinkingConfig {
	if (!isGemini3OrLaterModel(modelName)) {
		return { thinkingBudget: 512, includeThoughts: true };
	}
	return {
		thinkingLevel: modelName === 'gemini-3-flash-preview' ? 'minimal' : 'low',
		includeThoughts: true,
	};
}

/**
 * Get provider options based on image count in the request
 * - Exactly 1 image: HIGH resolution for best quality
 * - 0 images (PDFs, text only): No mediaResolution needed
 * - Multiple images: Default resolution (Vertex AI limitation)
 * - gemini-3-flash-preview: HIGH at any image count
 *
 * In AI SDK v6, provider options key must match the provider:
 * - 'vertex' for Vertex AI (createVertex)
 * - 'google' for Google AI (createGoogleGenerativeAI)
 */
export function getGoogleProviderOptions(imageCount: number, modelName: string): GoogleProviderOptionsResult {
	const providerOptions: GoogleGenerativeAIProviderOptions = {
		thinkingConfig: getGeminiThinkingConfig(modelName),
	};
	if (modelName === 'gemini-3-flash-preview' || imageCount === 1) {
		providerOptions.mediaResolution = MediaResolution.MEDIA_RESOLUTION_HIGH;
	}

	// AI SDK v6: Use 'vertex' key for Vertex AI, 'google' key for Google AI
	if (isUsingVertexAI()) {
		return { vertex: providerOptions };
	}
	return { google: providerOptions };
}
