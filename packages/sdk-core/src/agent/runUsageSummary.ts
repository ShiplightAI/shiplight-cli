/**
 * Aggregate a run's per-step AI-action details into a RunUsageSummary — the
 * analytics-plane contract uploaded on run-complete (cloud service spec 047).
 *
 * Mirrors CacheMetadataCollector.getSummary(): pure, no I/O. Maps each
 * AIActionDetail's actionType (+ conditionKind for evaluate) to an operation and
 * sums the token usage per (operation, provider, model, routing) bucket.
 *
 * actionType -> operation:
 *   execute  -> action        (element interaction resolved by the model)
 *   generate -> draft         (action generated from scratch, no locator)
 *   assert   -> verify_ai     (a verify that fell through JS to the model)
 *   evaluate -> evaluate_if / evaluate_while / evaluate_wait_until (by conditionKind;
 *              WAIT_UNTIL polls, so it is usually the largest evaluate driver)
 *   run      -> action        (agent.run high-level task)
 *
 * Not attributed here (documented limitations, closed by follow-ups):
 *   - `heal`     — self-healing regenerates via the `generate`/`execute` path and
 *                  is not yet tagged distinctly; the RunCacheSummary.healed count
 *                  carries the heal signal in the same upload.
 *   - `verify_js`— a verify that passed on JS makes NO model call, so it produces
 *                  no AIActionDetail (correctly zero tokens); its count comes from
 *                  the report step structure, not from usage.
 *   - thinking_tokens / cache_read_tokens — TokenUsage does not carry these yet;
 *                  reported as 0 until TokenUsage is extended.
 */

import type { AIActionDetail, TokenUsage } from '../core/types';
import type { LlmOperation, LlmRouting, RunUsageByOperation, RunUsageSummary } from 'shiplight-types';

export interface BuildRunUsageSummaryOptions {
  /** How LLM calls were routed this run. Defaults to 'proxy'. */
  routing?: LlmRouting;
  /** Override provider inference for a model id. */
  providerOf?: (model: string) => string;
}

/** Infer the provider family from a model id (Anthropic / OpenAI / Gemini). */
export function inferProvider(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic';
  if (m.includes('gemini') || m.includes('google')) return 'gemini';
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4') || m.includes('openai')) {
    return 'openai';
  }
  return 'unknown';
}

function operationFor(detail: AIActionDetail): LlmOperation | null {
  switch (detail.actionType) {
    case 'execute':
    case 'run':
      return 'action';
    case 'generate':
      return 'draft';
    case 'assert':
      return 'verify_ai';
    case 'evaluate':
      if (detail.conditionKind === 'while') return 'evaluate_while';
      if (detail.conditionKind === 'wait_until') return 'evaluate_wait_until';
      return 'evaluate_if';
    default:
      return null;
  }
}

/** Read an optional token field that may not exist on older TokenUsage records. */
function optionalToken(tu: TokenUsage, key: string): number {
  const value = (tu as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : 0;
}

interface Bucket extends RunUsageByOperation {}

function bucketKey(op: LlmOperation, provider: string, model: string, routing: LlmRouting): string {
  return `${op}\u0000${provider}\u0000${model}\u0000${routing}`;
}

export function buildRunUsageSummary(
  aiActionDetails: readonly AIActionDetail[] | undefined,
  options: BuildRunUsageSummaryOptions = {},
): RunUsageSummary {
  const routing = options.routing ?? 'proxy';
  const providerOf = options.providerOf ?? inferProvider;
  const buckets = new Map<string, Bucket>();

  for (const detail of aiActionDetails ?? []) {
    const operation = operationFor(detail);
    if (!operation) continue;

    for (const tu of detail.tokenUsages ?? []) {
      const model = tu.model ?? 'unknown';
      const provider = providerOf(model);
      const key = bucketKey(operation, provider, model, routing);

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          operation,
          provider,
          model,
          routing,
          calls: 0,
          input_tokens: 0,
          output_tokens: 0,
          thinking_tokens: 0,
          cache_read_tokens: 0,
        };
        buckets.set(key, bucket);
      }

      bucket.calls += 1;
      bucket.input_tokens += tu.prompt_tokens || 0;
      bucket.output_tokens += tu.completion_tokens || 0;
      bucket.thinking_tokens += optionalToken(tu, 'thinking_tokens');
      bucket.cache_read_tokens += optionalToken(tu, 'cache_read_tokens');
    }
  }

  // Stable order (operation, then provider, then model) for deterministic output.
  const by_operation = Array.from(buckets.values()).sort((a, b) =>
    a.operation !== b.operation
      ? a.operation.localeCompare(b.operation)
      : a.provider !== b.provider
        ? a.provider.localeCompare(b.provider)
        : a.model.localeCompare(b.model),
  );

  return { by_operation };
}
