/**
 * Execution-scoped action-entity cache metrics.
 *
 * The question this answers is "how many model calls did the cache save on this
 * run, and how often did auto-heal have to fire anyway". `cacheSummary`
 * (CacheMetadataCollector) cannot answer it: the transpiler builds that from every
 * YAML file it can see, while `playwright.config.ts` is loading, long before any
 * test runs. It therefore counts statements in tests that never executed, counts
 * both arms of an `IF`, and counts a `WHILE` body once however often it loops.
 *
 * Here the denominator is what ran. Two runtime facts, both recorded in
 * `agent.step()` and carried to the reporter on each step result, make that
 * possible: `stmtUid` (which YAML statement this step was, so it can be joined to
 * what the transpiler knew about it) and the heal outcome (`autoHealed` /
 * `healFailed`).
 *
 * DRAFT statements are outside this entirely, by construction rather than by a
 * filter: a DRAFT compiles to `agent.execute()`, which never reaches
 * `agent.step()` and so never stamps a `stmtUid`. That is the intended reading —
 * a DRAFT's model call is deliberate, nothing failed, and counting it as a heal
 * would inflate what the cache is credited with rescuing.
 */

import type { RunCacheExecutionSummary } from 'shiplight-types';
import type { ReportStep, ReportTest } from './template.js';

function emptySummary(): RunCacheExecutionSummary {
  return {
    executed: 0,
    cache_served: 0,
    auto_healed: 0,
    auto_heal_failed: 0,
    healed_from_cache: 0,
  };
}

/**
 * The step lists to count for one test.
 *
 * `test.steps` IS the final attempt's step list, and `test.attempts` (populated only
 * when a retry happened) already includes that same final attempt — so reading both
 * would double-count the last try of every retried test. Deliberately identical to
 * `sumTestLlmUsage` in cloudUpload.ts: these counts and the per-test `llmCalls` are
 * meant to be read side by side, and they would not line up if one counted retries
 * and the other did not. Every attempt genuinely re-executed its statements and
 * genuinely re-spent (or re-saved) the model calls, so counting them all is the
 * honest answer for a metric denominated in calls.
 */
function stepSetsOf(test: ReportTest): ReportStep[][] {
  return test.attempts?.length ? test.attempts.map((a) => a.steps) : [test.steps];
}

/**
 * Whether a model call was spent trying to get this step through.
 *
 * Four signals, because self-healing is not the only rescue path and crediting the
 * cache for a rescued step inverts the number this summary exists to produce:
 *
 *   - `healFailed` / `autoHealed` — the `execute()` self-heal path.
 *   - `dismissedModalActions` — the action failed, `dismissModalIfPresent` called
 *     the model, a modal was dismissed and the retry succeeded (webAgent.ts:1381).
 *     Needed as its own signal because that call deliberately passes NO stepId
 *     (webAgent.ts:301), so it produces no AIActionDetail and the `llmUsage` check
 *     below cannot see it.
 *   - `llmUsage` — any model call recorded against this step id. Catches rescues
 *     with no dedicated flag, above all a `verify` carrying a `code:` fast path:
 *     it is classified non-AI, so it is wrapped in `agent.step()`, but its body
 *     swallows the JS failure and falls back to `agent.assert()`. The step then
 *     resolves normally and would otherwise read as an unhealed success.
 */
function aiWasInvoked(step: ReportStep): boolean {
  return Boolean(
    step.autoHealed ||
      step.healFailed ||
      step.dismissedModalActions?.length ||
      step.llmUsage?.length,
  );
}

/**
 * Whether the step got through.
 *
 * Positively verified — `'success'` or the soft-pass `'warning'` — NOT "anything
 * that is not `'failure'`". The runtime commonly leaves `status` unset on a
 * failure: a `canSelfHeal: false` action that throws reaches
 * `updateStepResult(stepId, undefined, undefined)` (webAgent.ts:1345) and a step
 * that hangs until the test times out never updates at all, so the reporter maps
 * both to `'pending'`. Treating "not failure" as success credited the cache for the
 * statement that killed the run.
 */
function stepSucceeded(step: ReportStep): boolean {
  return step.status === 'success' || step.status === 'warning';
}

/**
 * Classify one executed step and fold it into `into`.
 *
 * Order matters. The explicit heal flags are authoritative and are read first;
 * `healFailed` beats `autoHealed` because a step id can carry both — a `WHILE` body
 * whose first iteration healed and whose second one failed to — and the failure is
 * the outcome the run ended on. Only for a rescue with no flag of its own does the
 * bucket fall back to the step's status.
 *
 * A statement that failed with no model call at all lands in none of the three
 * outcome buckets: it neither saved a call nor spent one. It still counts in
 * `executed`, so the buckets deliberately do not have to sum to the denominator.
 */
function foldStep(step: ReportStep, cacheServedUids: ReadonlySet<string>, into: RunCacheExecutionSummary): void {
  const uid = step.stmtUid;
  if (!uid) return;

  into.executed += 1;
  const fromCache = cacheServedUids.has(uid);

  if (aiWasInvoked(step)) {
    if (step.healFailed || (!step.autoHealed && !stepSucceeded(step))) {
      into.auto_heal_failed += 1;
    } else {
      into.auto_healed += 1;
    }
    if (fromCache) into.healed_from_cache += 1;
    return;
  }
  if (fromCache && stepSucceeded(step)) {
    into.cache_served += 1;
  }
}

/**
 * Count what the cache did across one test's executed statements. Returns undefined
 * when the test executed no UID-carrying statement, so the field is omitted rather
 * than published as a row of zeros for a test the metric does not apply to.
 */
export function buildTestCacheExecution(
  test: ReportTest,
  cacheServedUids: ReadonlySet<string>,
): RunCacheExecutionSummary | undefined {
  const summary = emptySummary();
  for (const steps of stepSetsOf(test)) {
    for (const step of steps ?? []) foldStep(step, cacheServedUids, summary);
  }
  return summary.executed > 0 ? summary : undefined;
}

/**
 * Sum several execution summaries. Used to roll a run's tests up, and to merge
 * sharded runs — a plain sum is correct for both, because a statement can only be
 * counted where it actually executed and shards execute disjoint sets. (Contrast
 * `mergeCacheSummaries`, which cannot sum: every shard transpiles the whole corpus.)
 *
 * Returns undefined when nothing was counted, so "no cache-relevant statement ran"
 * stays distinguishable from "the cache served nothing".
 */
export function mergeCacheExecutionSummaries(
  summaries: ReadonlyArray<RunCacheExecutionSummary | undefined>,
): RunCacheExecutionSummary | undefined {
  const total = emptySummary();
  let seen = false;
  for (const s of summaries) {
    if (!s) continue;
    seen = true;
    total.executed += s.executed;
    total.cache_served += s.cache_served;
    total.auto_healed += s.auto_healed;
    total.auto_heal_failed += s.auto_heal_failed;
    total.healed_from_cache += s.healed_from_cache;
  }
  return seen && total.executed > 0 ? total : undefined;
}

/**
 * Whether this summary has anything worth showing a user.
 *
 * A run that executed statements but neither served one from cache nor healed one
 * has nothing to say about the cache — most commonly a project that never enabled
 * the feature. Reporting `executed` alone there puts a permanent "Action Entity
 * Cache" panel on every report for a feature the user does not use, which is the
 * same noise `markRunCacheInPlay` was written to suppress for `cacheSummary`.
 *
 * Shared by the console line and the HTML block so the two cannot disagree about
 * when to stay quiet.
 */
export function hasCacheExecutionSignal(summary: RunCacheExecutionSummary | undefined): summary is RunCacheExecutionSummary {
  if (!summary || summary.executed === 0) return false;
  return summary.cache_served > 0 || summary.auto_healed > 0 || summary.auto_heal_failed > 0;
}

/**
 * One line for the console / report header, phrased as what happened rather than as
 * a rate: "12 served from cache, 3 auto-healed (1 failed)". Returns '' when there is
 * nothing to say, so callers can print unconditionally.
 */
export function formatCacheExecutionSummary(summary: RunCacheExecutionSummary | undefined): string {
  if (!hasCacheExecutionSignal(summary)) return '';
  const parts: string[] = [];
  if (summary.cache_served > 0) parts.push(`${summary.cache_served} served from cache`);
  const healAttempts = summary.auto_healed + summary.auto_heal_failed;
  if (healAttempts > 0) {
    const failed = summary.auto_heal_failed > 0 ? ` (${summary.auto_heal_failed} failed)` : '';
    parts.push(`${healAttempts} auto-healed${failed}`);
  }
  if (parts.length === 0) return '';
  return `${parts.join(', ')} of ${summary.executed} executed statement${summary.executed === 1 ? '' : 's'}`;
}
