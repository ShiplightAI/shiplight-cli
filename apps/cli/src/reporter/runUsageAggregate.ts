/**
 * Aggregate a run's per-operation LLM usage (shiplight spec 047 analytics plane).
 *
 * The summary is computed at report-generation time — in the Playwright reporter's
 * onEnd, where the agent's `ai-actions.json` files still sit under the cwd's
 * `test-results/` — and folded into `report-data.json`. That matters: only
 * `report-data.json` travels to a merge/regenerate/upload job (the raw
 * `ai-actions.json` do not), so aggregating anywhere downstream — e.g. from a
 * merge job's cwd, which never ran tests — would silently produce nothing for
 * every sharded run. Merge sums the shards' summaries; upload reads the summary
 * off `reportData`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';
// Import the aggregator from a source subpath, NOT the 'sdk-core' barrel: this
// file is reached by the standalone reporter.ts tsup entry (splitting:false), so
// a value import from the barrel inlines the entire ~360 KB sdk-core bundle into
// dist/reporter.js, blowing the release tarball-size gate. AIActionDetail stays a
// type-only barrel import (fully erased, no runtime cost). Mirrors cloud-routing.
import { buildRunUsageSummary } from 'sdk-core/run-usage-summary';
import type { AIActionDetail } from 'sdk-core';
import type { LlmRouting, RunUsageByOperation, RunUsageSummary } from 'shiplight-types';
import { getShiplightEnv } from '../dotenvSource.js';

/**
 * The FULL Shiplight env stash (`getShiplightEnv()`), not the allowlisted
 * subset `buildSdkEnv()` produces — SHIPLIGHT_USAGE_ROUTING is deliberately
 * not on SDK_ENV_ALLOWLIST, so swapping in `buildSdkEnv()` here would
 * silently kill the override.
 */
type ShiplightEnvStash = Record<string, string | undefined>;

/** Mirrors sdk-core agent/llm/anthropic.ts `isTruthy` — the exact truthiness
 * rule of the Anthropic Vertex flag (and ONLY that flag; google.ts uses a
 * stricter literal match, see PROVIDER_ROUTING). */
function isTruthy(value?: string): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * Per-provider routing resolution, mirroring the branch outcomes of
 * sdk-core's agent/llm/{anthropic,google,openai}.ts `get*Model` functions:
 * direct configuration (API key or Vertex flag — sdk-core checks the flag
 * first, but both land on a non-proxy path) takes precedence over
 * SHIPLIGHT_API_TOKEN, so its presence means that provider's calls bypassed
 * the Shiplight proxy. Each flag check reuses that provider's own truthiness
 * rule — anthropic.ts `isTruthy` accepts 1/true/yes/on, while google.ts
 * `isUsingVertexAI` accepts only the literal strings 'True'/'true' — so the
 * label cannot drift from the branch sdk-core actually took. An OpenAI key
 * with OPENAI_BASE_URL (Ollama / self-hosted, honored only alongside the key
 * in openai.ts) is `custom_endpoint`; a bare direct key or Vertex flag is
 * `byok`. Vertex traffic is counts-only regardless of who operates the
 * Vertex project — it never crosses the proxy, so it cannot be
 * proxy-reconciled; Shiplight-managed images that bake a Vertex flag must
 * set SHIPLIGHT_USAGE_ROUTING explicitly if they want a different label.
 */
const PROVIDER_ROUTING: Record<string, (env: ShiplightEnvStash) => LlmRouting> = {
  anthropic: (env) =>
    Boolean(env.ANTHROPIC_API_KEY) || isTruthy(env.ANTHROPIC_MODELS_USE_VERTEXAI)
      ? 'byok'
      : 'proxy',
  gemini: (env) => {
    const vertexFlag = env.GOOGLE_GENAI_USE_VERTEXAI;
    return Boolean(env.GOOGLE_API_KEY) || vertexFlag === 'True' || vertexFlag === 'true'
      ? 'byok'
      : 'proxy';
  },
  openai: (env) => {
    if (!env.OPENAI_API_KEY) return 'proxy';
    return env.OPENAI_BASE_URL ? 'custom_endpoint' : 'byok';
  },
};

/** Mirrors OPENAI_MODEL_RE in sdk-core agent/llm/index.ts. */
const OPENAI_MODEL_RE = /^(gpt-|o\d|chatgpt-)/;

/**
 * Bucket providers come from `inferProvider`, whose OpenAI patterns are
 * narrower than the dispatcher's (`detectProvider` in agent/llm/index.ts):
 * ids like `chatgpt-*` or a future `o5-*` dispatch to OpenAI but bucket as
 * `unknown`. Re-map those — the result is both the published bucket provider
 * and the routing-lookup key — so a direct OpenAI key doesn't leave
 * customer-paid usage labeled as billable proxy traffic, and the bucket lands
 * under `openai` in per-provider analytics instead of `unknown`.
 */
export function resolveRoutingProvider(provider: string, model: string): string {
  if (provider !== 'unknown') return provider;
  return OPENAI_MODEL_RE.test(model) ? 'openai' : 'unknown';
}

/**
 * Routing decides whether the platform can attach cost to this bucket's usage:
 * `proxy` traffic is billed and reconciled; `byok` / `custom_endpoint` are
 * counts-only. Only the Shiplight-token path is `proxy` (see PROVIDER_ROUTING
 * for the per-provider rule). Reads the same Shiplight `.env` stash the
 * fixture feeds into `configureSdk` via `buildSdkEnv` — including the
 * SHIPLIGHT_USAGE_ROUTING whole-run override, so a `.env`-declared override
 * wins over the shell like every other Shiplight env read — and stays
 * per-provider so a run mixing a direct key for one provider with proxy for
 * another labels each bucket correctly. A provider with no PROVIDER_ROUTING
 * entry is `proxy` only when NO direct config exists anywhere (then every
 * sdk-core path falls through to the token); otherwise the call may have been
 * customer-paid, and counts-only is the conservative label — never claim
 * billable traffic that can't be attributed.
 */
export function detectUsageRouting(provider: string, env: ShiplightEnvStash): LlmRouting {
  const override = env.SHIPLIGHT_USAGE_ROUTING;
  if (override === 'proxy' || override === 'byok' || override === 'custom_endpoint') return override;
  const routingFor = PROVIDER_ROUTING[provider];
  if (routingFor) return routingFor(env);
  const anyDirect = Object.values(PROVIDER_ROUTING).some((fn) => fn(env) !== 'proxy');
  return anyDirect ? 'byok' : 'proxy';
}

/**
 * Aggregate the per-operation LLM usage for a run from the `ai-actions.json` files
 * the agent writes under `<cwd>/test-results/`. Call this ONLY where those files
 * exist — i.e. immediately after a test run, from the reporter's onEnd. Returns
 * undefined when nothing was captured, so the field is omitted (a blind spot,
 * never zero usage).
 */
export function aggregateRunUsageSummary(
  cwd: string,
  scanDirs?: string[],
): RunUsageSummary | undefined {
  // `<cwd>/test-results` is the fallback, NOT the default. Under shiplightConfig
  // the output directory is `test-results/<runId>` with a fresh id per
  // invocation, and nothing prunes the parent — so globbing it would read every
  // previous run's ai-actions.json too, and the run total would come out a
  // multiple of what its own tests report per-test. Callers that know the run's
  // real output directories (the reporter, from Playwright's resolved config)
  // pass them, which also covers a user-supplied `outputDir` the fallback would
  // miss entirely.
  const roots = scanDirs?.length ? scanDirs : [path.join(cwd, 'test-results')];

  const details: AIActionDetail[] = [];
  for (const resultsDir of roots) {
    let files: string[];
    try {
      files = globSync('**/ai-actions.json', { cwd: resultsDir });
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf-8'));
        if (Array.isArray(parsed)) details.push(...(parsed as AIActionDetail[]));
      } catch {
        // Skip unreadable/invalid files.
      }
    }
  }
  if (details.length === 0) return undefined;

  // Buckets are built under a uniform placeholder routing, then relabeled per
  // bucket: provider first (resolveRoutingProvider closes inferProvider's gap
  // vs the dispatcher, so e.g. chatgpt-* publishes as openai, not unknown),
  // then routing from that corrected provider. Safe against key collisions:
  // with one routing value the bucket key degenerates to (operation, provider,
  // model), and both rewrites are pure functions of (provider, model) —
  // deterministic per model — so distinct keys stay distinct.
  const env = getShiplightEnv();
  const summary = buildRunUsageSummary(details, { routing: 'proxy' });
  const byOperation = summary.by_operation.map((b) => {
    const provider = resolveRoutingProvider(b.provider, b.model);
    return { ...b, provider, routing: detectUsageRouting(provider, env) };
  });
  // Re-sort: the unknown→openai provider rename can leave buckets out of
  // order relative to their published provider.
  byOperation.sort(compareBuckets);
  return byOperation.length > 0 ? { ...summary, by_operation: byOperation } : undefined;
}

/**
 * One raw LLM call's token usage, attached to its `ReportStep` (spec 047 analytics plane).
 * Deliberately NOT pre-aggregated: `report.json` carries the raw per-call records so the
 * viewer can re-derive totals and price them against the platform's own model rate card —
 * the runner's `estimated_cost_usd` (if any) is dropped here on purpose, since it reflects
 * the runner's own guess, not the platform's billed price.
 */
export interface StepLlmUsageRecord {
  model?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Group a test's raw `ai-actions.json` records (already parsed off the `shiplight-ai-actions`
 * Playwright attachment — see `apps/cli/src/fixture.ts`) by `stepId`, for attaching to each
 * `ReportStep`. A pure function, deliberately NOT filesystem-based: the reporter sees
 * attachments via Playwright's serialized `body`/`path` pair, not a directory it can trust to
 * derive from a sibling attachment's path (that path is commonly absent by the time the
 * reporter runs). Returns an empty map for missing/malformed input (a blind spot, never zero
 * usage).
 */
export function groupStepLlmUsage(details: AIActionDetail[]): Map<string, StepLlmUsageRecord[]> {
  const usageByStep = new Map<string, StepLlmUsageRecord[]>();
  for (const detail of details) {
    if (!detail.stepId || detail.tokenUsages.length === 0) continue;
    const records = usageByStep.get(detail.stepId) ?? [];
    for (const usage of detail.tokenUsages) {
      records.push({
        model: usage.model,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      });
    }
    usageByStep.set(detail.stepId, records);
  }
  return usageByStep;
}

function bucketKey(b: RunUsageByOperation): string {
  return `${b.operation} ${b.provider} ${b.model} ${b.routing}`;
}

// Total order over the full bucket key. Routing is a tiebreaker since it
// became per-bucket: two shards can carry the same (operation, provider,
// model) with different routing (e.g. only one CI lane holds a direct key),
// and merged output must stay deterministic regardless of shard glob order.
function compareBuckets(a: RunUsageByOperation, b: RunUsageByOperation): number {
  return a.operation !== b.operation
    ? a.operation.localeCompare(b.operation)
    : a.provider !== b.provider
      ? a.provider.localeCompare(b.provider)
      : a.model !== b.model
        ? a.model.localeCompare(b.model)
        : a.routing.localeCompare(b.routing);
}

/**
 * Sum several per-run usage summaries into one — used when merging sharded runs,
 * where each shard's `report-data.json` carries its own summary. Buckets with the
 * same (operation, provider, model, routing) are added together. Returns undefined
 * when no shard carried a summary.
 */
export function mergeUsageSummaries(
  summaries: ReadonlyArray<RunUsageSummary | undefined>,
): RunUsageSummary | undefined {
  const buckets = new Map<string, RunUsageByOperation>();
  for (const summary of summaries) {
    for (const b of summary?.by_operation ?? []) {
      const key = bucketKey(b);
      const existing = buckets.get(key);
      if (existing) {
        existing.calls += b.calls;
        existing.input_tokens += b.input_tokens;
        existing.output_tokens += b.output_tokens;
        existing.thinking_tokens += b.thinking_tokens;
        existing.cache_read_tokens += b.cache_read_tokens;
      } else {
        buckets.set(key, { ...b });
      }
    }
  }
  if (buckets.size === 0) return undefined;

  const by_operation = Array.from(buckets.values()).sort(compareBuckets);
  return { by_operation };
}
