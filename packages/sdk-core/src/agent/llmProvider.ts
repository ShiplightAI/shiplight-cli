/**
 * LLM Provider utilities
 *
 * Re-exports from ./llm for backward compatibility.
 * New code should import from './llm' directly.
 */

export {
	getModel,
	getProviderOptions,
	resolveTemperature,
	getGoogleModel,
	getGoogleProviderOptions,
	isUsingVertexAI,
	getAnthropicModel,
	getAnthropicProviderOptions,
	getOpenRouterModel,
	getOpenRouterProviderOptions,
	type GoogleProviderOptionsResult,
	type AnthropicProviderOptionsResult,
	type OpenRouterProviderOptionsResult,
	type ProviderOptionsResult,
} from './llm';
