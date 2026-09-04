/**
 * LLM Provider Dispatcher
 *
 * Unified interface for getting LLM model instances and provider options.
 * Supports LiteLLM-style "provider:model" prefix for explicit routing,
 * or auto-detects provider from model name prefix.
 *
 * See DESIGN.md in this directory for the full specification.
 */

import type { LanguageModelV4 } from '@ai-sdk/provider';
import { getGoogleModel, getGoogleProviderOptions, GoogleProviderOptionsResult } from './google';
import {
	getAnthropicModel,
	getAnthropicProviderOptions,
	anthropicModelSupportsSamplingParams,
	AnthropicProviderOptionsResult,
} from './anthropic';
import { getOpenAIModel, getOpenAIProviderOptions, OpenAIProviderOptionsResult } from './openai';

// ---------------------------------------------------------------------------
// Model name → provider auto-detection (when no provider: prefix is given)
// ---------------------------------------------------------------------------

/** Matches OpenAI model names: gpt-*, o{N}[-*], chatgpt-* */
const OPENAI_MODEL_RE = /^(gpt-|o\d|chatgpt-)/;

/** Model prefix → provider name mapping for auto-detection */
function detectProvider(modelId: string): string | undefined {
	if (modelId.startsWith('claude-')) return 'anthropic';
	if (modelId.startsWith('gemini-')) return 'google';
	if (OPENAI_MODEL_RE.test(modelId)) return 'openai';
	return undefined;
}

// ---------------------------------------------------------------------------
// Parse "provider:model" format — moved to ./parseModel (leaf, no imports) so
// usage/reporting code can normalise model strings without importing this
// module's provider/AI-SDK graph. Re-exported here to keep existing callers.
// ---------------------------------------------------------------------------

export { KNOWN_PROVIDERS, parseModel, type ParsedModel } from './parseModel';
import { parseModel } from './parseModel';

// ---------------------------------------------------------------------------
// Provider model factories
// ---------------------------------------------------------------------------

type ModelFactory = (modelId: string) => LanguageModelV4;

/** Implemented provider factories */
const PROVIDER_FACTORIES: Record<string, ModelFactory> = {
	anthropic: getAnthropicModel,
	google: getGoogleModel,
	openai: getOpenAIModel,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get LLM model instance based on model string.
 *
 * Supports two formats:
 *   - "model_name"          — auto-detect provider from model name prefix
 *   - "provider:model_name" — explicit provider routing (LiteLLM-style)
 *
 * Auto-detection rules:
 *   - claude-*                          → Anthropic
 *   - gemini-*                          → Google AI (or Vertex AI via legacy flag)
 *   - gpt-*, o1*, o3*, o4*, chatgpt-*  → OpenAI
 *
 * Legacy Vertex AI flags (ANTHROPIC_MODELS_USE_VERTEXAI, GOOGLE_GENAI_USE_VERTEXAI)
 * are handled internally by the anthropic.ts and google.ts providers when no
 * explicit "vertex:" prefix is given.
 *
 * @param modelString - Model name, optionally prefixed with "provider:"
 * @returns Language model instance
 * @throws Error if provider cannot be determined or is not supported
 */
export function getModel(modelString: string): LanguageModelV4 {
	const { provider: explicitProvider, modelId } = parseModel(modelString);
	const provider = explicitProvider ?? detectProvider(modelId);

	if (!provider) {
		throw new Error(
			`Cannot determine provider for model: ${modelString}. ` +
			`Use a known model prefix (claude-*, gemini-*, gpt-*) or specify a provider ` +
			`(e.g., "openai:${modelId}", "azure:${modelId}", "bedrock:${modelId}").`
		);
	}

	if (!modelId) {
		throw new Error(
			`Empty model ID in model string: "${modelString}". ` +
			`Specify a model after the provider prefix (e.g., "${provider}:gpt-5.4-mini").`
		);
	}

	const factory = PROVIDER_FACTORIES[provider];
	if (!factory) {
		throw new Error(
			`Provider "${provider}" is not yet implemented. ` +
			`Supported providers: ${Object.keys(PROVIDER_FACTORIES).join(', ')}. ` +
			`See packages/sdk-core/src/agent/llm/DESIGN.md for the roadmap.`
		);
	}

	return factory(modelId);
}

/**
 * Provider options result type
 */
export type ProviderOptionsResult = GoogleProviderOptionsResult | AnthropicProviderOptionsResult | OpenAIProviderOptionsResult;

/**
 * Get provider-specific options for the model.
 *
 * @param modelString - Model string (may include provider: prefix)
 * @param imageCount - Number of images in the request (used by Google for mediaResolution)
 * @returns Provider options object to pass to generateText()
 */
export function getProviderOptions(modelString: string, imageCount: number): ProviderOptionsResult {
	const { provider: explicitProvider, modelId } = parseModel(modelString);
	const provider = explicitProvider ?? detectProvider(modelId);

	if (provider === 'anthropic' || provider === 'vertex') {
		return getAnthropicProviderOptions(modelId);
	}
	if (provider === 'openai' || provider === 'azure') {
		return getOpenAIProviderOptions(modelId);
	}
	if (provider === 'bedrock') {
		// Bedrock hosts models from multiple providers; detect from model ID
		if (modelId.startsWith('anthropic.')) return getAnthropicProviderOptions(modelId);
		// Non-Anthropic Bedrock models (Llama, Mistral, etc.) need no special options
		return {};
	}
	return getGoogleProviderOptions(imageCount, modelId);
}

/**
 * Resolve the `temperature` to send for a given model, or `undefined` to omit it.
 *
 * Anthropic's sampling-free models (Opus 4.7/4.8, Sonnet 5, Fable 5) reject a
 * non-default `temperature` with a non-retryable HTTP 400, which — unlike an
 * availability error — does NOT trigger model fallback, so an unconditional
 * temperature deterministically kills those models mid-chain. For those we omit
 * the parameter entirely; every other provider/model (Google, OpenAI, and the
 * older Anthropic models that still accept it) receives `requested ?? 0`, the
 * agent's determinism default.
 *
 * @param modelString - Model string (may include a `provider:` prefix)
 * @param requested - Caller-supplied temperature, if any
 */
export function resolveTemperature(
	modelString: string,
	requested: number | undefined,
): number | undefined {
	const desired = requested ?? 0;
	const { provider: explicitProvider, modelId } = parseModel(modelString);
	const provider = explicitProvider ?? detectProvider(modelId);

	// The sampling-free restriction is specific to Anthropic *Claude* models —
	// resolve the bare `claude-*` id across the routing forms this repo parses,
	// and gate only that. Everything else (Gemini-on-Vertex, non-Anthropic
	// Bedrock, Google, OpenAI) keeps the determinism default.
	let claudeId: string | undefined;
	if ((provider === 'anthropic' || provider === 'vertex') && modelId.startsWith('claude-')) {
		// Direct Anthropic, or Anthropic-on-Vertex (bare claude-* id).
		claudeId = modelId;
	} else if (provider === 'bedrock') {
		// Bedrock hosts Anthropic under an `anthropic.` id, optionally with a
		// cross-region `<xx>.` prefix (e.g. `us.anthropic.claude-sonnet-5`).
		const match = modelId.match(/^(?:[a-z]{2}\.)?anthropic\.(claude-.+)$/);
		if (match) claudeId = match[1];
	}

	if (claudeId !== undefined) {
		return anthropicModelSupportsSamplingParams(claudeId) ? desired : undefined;
	}
	return desired;
}

// Re-export for direct access and backward compatibility
export { getGoogleModel, getGoogleProviderOptions, isUsingVertexAI, type GoogleProviderOptionsResult } from './google';
export { getAnthropicModel, getAnthropicProviderOptions, anthropicModelSupportsSamplingParams, type AnthropicProviderOptionsResult } from './anthropic';
export { getOpenAIModel, getOpenAIProviderOptions, type OpenAIProviderOptionsResult } from './openai';
