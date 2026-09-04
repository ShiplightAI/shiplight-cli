/**
 * Run-level LLM usage summary — the analytics-plane contract uploaded on
 * run-complete (cloud service spec 047). Sits alongside RunCacheSummary in the
 * complete payload.
 *
 * Why the runner emits this: sdk-core is the only seam that sees every LLM call
 * and its token usage in every routing mode (Shiplight proxy, the customer's own
 * key, or a custom endpoint) AND knows the construct behind each call (IF vs
 * WHILE, verify-JS vs verify-AI). A proxy-side tag is structurally blind to BYOK,
 * so operation-attributed usage must come from here.
 *
 * Aggregate per (operation, provider, model, routing) — NOT a per-call stream.
 * Tokens are counts in all modes; the platform attaches cost only for `proxy`
 * traffic (from its billing plane).
 */

/**
 * Classification of an LLM call. IF and WHILE stay distinct even though both
 * compile to `agent.evaluate`; verify_js/verify_ai stay distinct (verify_js made
 * no model call).
 */
export type LlmOperation =
  | 'action'
  | 'evaluate_if'
  | 'evaluate_while'
  | 'evaluate_wait_until'
  | 'verify_ai'
  | 'verify_js'
  | 'heal'
  | 'draft';

/** How the call reached its provider. Only `proxy` is billed by the platform. */
export type LlmRouting = 'proxy' | 'byok' | 'custom_endpoint';

/** One (operation, provider, model, routing) bucket within a run. */
export interface RunUsageByOperation {
  operation: LlmOperation;
  provider: string;
  model: string;
  routing: LlmRouting;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  /** Reasoning/thinking tokens, when the provider reports them separately. */
  thinking_tokens: number;
  /** Input tokens served from the provider's prompt cache (a subset of input). */
  cache_read_tokens: number;
}

/**
 * Run-level usage summary, aggregated from per-step AI-action details. Uploaded
 * with the run-complete payload; omission means "not reported" (a blind spot),
 * never zero usage.
 */
export interface RunUsageSummary {
  by_operation: RunUsageByOperation[];
}
