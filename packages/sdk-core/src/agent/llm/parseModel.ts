// ---------------------------------------------------------------------------
// Parse "provider:model" format
// ---------------------------------------------------------------------------
//
// Leaf module — no imports. Kept separate from ./index so pure string parsing
// (used by usage/reporting code such as utils/tokenUsage.ts) does not have to
// pull in the provider factories and the AI SDK graph that ./index carries.

/**
 * Known provider prefixes for "provider:model" parsing.
 * Only these prefixes are recognized — unknown prefixes (e.g., "ft:", "mistral:")
 * are left as-is in the model string.
 *
 * Note: vertex, azure, and bedrock are recognized for parsing but not yet
 * implemented as providers. Using them will produce a clear error.
 */
export const KNOWN_PROVIDERS = new Set([
	'anthropic',
	'google',
	'openai',
	'vertex',
	'azure',
	'bedrock',
]);

export interface ParsedModel {
	/** Explicit provider name, or undefined for auto-detection */
	provider: string | undefined;
	/** Model ID to pass to the provider SDK */
	modelId: string;
}

/**
 * Parse a model string that may contain a "provider:model" prefix.
 *
 * Examples:
 *   "claude-sonnet-4-6"           → { provider: undefined, modelId: "claude-sonnet-4-6" }
 *   "vertex:claude-sonnet-4-6"    → { provider: "vertex", modelId: "claude-sonnet-4-6" }
 *   "bedrock:anthropic.claude-v2" → { provider: "bedrock", modelId: "anthropic.claude-v2" }
 *   "azure:gpt-4o"               → { provider: "azure", modelId: "gpt-4o" }
 *
 * Fine-tuned model IDs with colons (e.g., "ft:gpt-4o:my-org") are NOT split
 * because "ft" is not a known provider. Use "openai:ft:gpt-4o:my-org" for
 * explicit routing of fine-tuned models.
 */
export function parseModel(modelString: string): ParsedModel {
	const colonIndex = modelString.indexOf(':');
	if (colonIndex > 0) {
		const prefix = modelString.slice(0, colonIndex);
		if (KNOWN_PROVIDERS.has(prefix)) {
			return {
				provider: prefix,
				modelId: modelString.slice(colonIndex + 1),
			};
		}
	}
	return { provider: undefined, modelId: modelString };
}
