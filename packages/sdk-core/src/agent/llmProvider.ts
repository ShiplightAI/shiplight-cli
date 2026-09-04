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
	type GoogleProviderOptionsResult,
	type AnthropicProviderOptionsResult,
	type ProviderOptionsResult,
} from './llm';
