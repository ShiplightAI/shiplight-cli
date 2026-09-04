import { TokenUsage } from 'shiplight-types';
import { parseModel } from '../agent/llm/parseModel';

/**
 * Convert AI SDK usage to TokenUsage format.
 * Handles both OpenAI format (promptTokens/completionTokens) and Gemini format (inputTokens/outputTokens).
 *
 * The recorded `model` is normalised to the **bare upstream id** — any
 * `provider:` routing prefix is stripped. `model` here becomes the identity a
 * usage row is billed and reconciled by (it flows to `ai-actions.json` and the
 * reporter's per-operation buckets, which the platform matches against
 * `llm_models` by name). Tier selection resolves primaries as `provider:model`
 * (e.g. `google:gemini-3.5-flash`), and cross-provider fallbacks have always
 * carried a prefix; without this, the same physical model would key as two
 * different rows (`gemini-3.5-flash` vs `google:gemini-3.5-flash`) and one of
 * them would fail reconciliation. Provider detection downstream (`inferProvider`)
 * reads the bare name and is unaffected.
 */
/** The AI SDK usage fields this reads — OpenAI-shaped and Gemini-shaped. */
interface RawUsage {
	promptTokens?: number;
	inputTokens?: number;
	completionTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
}

export function convertUsageToTokenUsage(usage: unknown, model: string): TokenUsage | null {
	if (!usage || typeof usage !== 'object') return null;
	const u = usage as RawUsage;
	return {
		prompt_tokens: u.promptTokens || u.inputTokens || 0,
		completion_tokens: u.completionTokens || u.outputTokens || 0,
		total_tokens: u.totalTokens || 0,
		model: parseModel(model).modelId,
	};
}