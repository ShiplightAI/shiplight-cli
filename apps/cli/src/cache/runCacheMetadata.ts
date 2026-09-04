/**
 * Run-scoped singleton for {@link CacheMetadataCollector}.
 *
 * The two halves of a cache summary are produced in different places within the
 * SAME Playwright process, and neither can hand a value to the other:
 *
 *   - "did this statement resolve from cache" is known only inside the
 *     transpiler, which runs while `playwright.config.ts` is being loaded;
 *   - "was it later healed" is known only to the reporter, from each test's
 *     `shiplight-new-action-entities` attachment, long after that.
 *
 * A module singleton is the seam they can share. It is deliberately NOT exported
 * as a class instance to be constructed by callers — a second instance would
 * silently collect half a summary and report it as whole.
 *
 * Scope note: the parent `shiplight test` process spawns Playwright, so this
 * lives entirely in the CHILD. The parent's own post-test scan of
 * `new-action-entities.json` (commands/test.ts) is a different concern — it
 * writes the cache back — and does not feed this.
 */

import type { ActionEntity } from 'shiplight-types';
import { CacheMetadataCollector } from './cacheMetadataCollector.js';

/**
 * State lives on globalThis, NOT in a module-level `let`. tsup compiles each
 * entry (`src/index.ts`, `src/reporter.ts`, …) into its own self-contained
 * bundle with `splitting: false`, so this module is inlined once per bundle.
 * The writer (transpile.ts, reached from the config bundle) and the reader
 * (reporter/index.ts, its own bundle) would therefore hold two separate
 * collectors, and the reporter's would always be empty — the summary would be
 * silently absent from every published build while passing tsx-based unit tests,
 * which run a single module graph. Same hazard and same workaround as the
 * dotenv stash in `../dotenvSource.ts`.
 */
const STASH_KEY = '__shiplightRunCacheMetadata__';

interface RunCacheStash {
  collector?: CacheMetadataCollector;
  /**
   * Set when some part of the run's statements went unobserved (a file failed
   * to transpile). A hit rate measured over an arbitrary subset is worse than
   * no number at all, so this suppresses the summary entirely.
   */
  incomplete?: boolean;
  /** Set when the run had an action-entity cache to apply at all. */
  cacheInPlay?: boolean;
}

function stash(): RunCacheStash {
  const g = globalThis as Record<string, unknown>;
  return (g[STASH_KEY] as RunCacheStash | undefined) ?? (g[STASH_KEY] = {} as RunCacheStash);
}

/** The run's collector, created on first use. */
export function runCacheCollector(): CacheMetadataCollector {
  const s = stash();
  s.collector ??= new CacheMetadataCollector();
  return s.collector;
}

/**
 * Declare that this run has an action-entity cache in play.
 *
 * Gates the whole summary: without it a developer who never enabled the cache
 * would get an "Action Entity Cache" panel reading only "37 original" on every
 * report, and the platform would store a cacheSummary for orgs that cannot be
 * told apart from one whose cache is merely cold.
 */
export function markRunCacheInPlay(): void {
  stash().cacheInPlay = true;
}

/** Declare that part of the run's statements could not be observed. */
export function markRunMeasurementIncomplete(): void {
  stash().incomplete = true;
}

/**
 * Whether part of the run's statements went unobserved.
 *
 * Exposed separately from {@link hasRunCacheMetadata} because the two cache
 * summaries need different halves of that gate. The transpile-time summary needs
 * all three conditions; the execution-scoped one must still report on a run with no
 * cache at all (that is the auto-heal baseline the cache's saving is measured
 * against) but must NOT report when the transpile was partial. A file that failed to
 * transpile still RUNS — Playwright executes whatever stale `.yaml.spec.ts` the last
 * transpile left behind, and those statements carry baked-in UIDs the collector
 * never saw this run. They therefore land in `executed` but can never be matched as
 * cache-served, so the published figure understates the cache over a denominator
 * nobody can size.
 */
export function isRunMeasurementIncomplete(): boolean {
  return stash().incomplete === true;
}

/**
 * Whether a trustworthy summary can be reported.
 *
 * Three conditions, each covering a way the number would otherwise mislead:
 * the cache must have been in play (else it is noise for a feature the user
 * never enabled), the measurement must be complete (a partial denominator
 * publishes a measured-looking rate over a fraction of the run), and something
 * must actually have been recorded.
 */
export function hasRunCacheMetadata(): boolean {
  const s = stash();
  return (
    s.cacheInPlay === true &&
    s.incomplete !== true &&
    s.collector !== undefined &&
    s.collector.getSummary().total_statements > 0
  );
}

/**
 * The statement UIDs whose action entity the transpiler took from the cache.
 *
 * Call this BEFORE {@link recordRunHealedEntities} folds healing in — healing
 * overwrites a record's `source`, so afterwards a cache entry that went stale is
 * indistinguishable from a statement that never had one. Execution-scoped metrics
 * need the pre-heal answer: "did this statement start the run on a cached entity",
 * which is a property of the transpile, not of the outcome.
 *
 * Empty when no cache was in play, which makes every cache-served count 0 rather
 * than absent — correct here, because the run demonstrably served nothing from a
 * cache it did not have.
 */
export function cacheServedStatementUids(): Set<string> {
  const collector = stash().collector;
  if (!collector) return new Set();
  const uids = new Set<string>();
  for (const record of collector.getStatementDetails()) {
    if (record.source === 'cache_hit') uids.add(record.statement_hash);
  }
  return uids;
}

/**
 * Return a snapshot of the action entities that the transpiler selected from
 * cache, keyed by statement UID for this run.
 *
 * Presence is both provenance and payload: callers do not need a separate
 * `fromCache` boolean that could disagree with the entity. The collector keeps
 * `cached_action_entity` even after a later self-heal changes `source` to
 * `healed`, so the report can preserve the full execution chain.
 */
export function cachedActionEntitiesByStatementUid(): ReadonlyMap<string, ActionEntity> {
  const result = new Map<string, ActionEntity>();
  for (const statement of stash().collector?.getStatementDetails() ?? []) {
    if (statement.cached_action_entity) {
      result.set(statement.statement_hash, statement.cached_action_entity);
    }
  }
  return result;
}

/**
 * Fold healed entities in, keyed by statement UID.
 *
 * The collector correlates healed entities through a uid->hash map because it
 * was written to key records by statement hash. We key records by UID instead —
 * the hash is only needed to identify a statement across RUNS, and a run-scoped
 * summary never leaves the run — so the mapping here is the identity.
 */
export function recordRunHealedEntities(healedByUid: Map<string, ActionEntity>): void {
  const s = stash();
  if (!s.collector || healedByUid.size === 0) return;
  const identity = new Map<string, string>();
  for (const uid of healedByUid.keys()) identity.set(uid, uid);
  s.collector.recordHealedEntities(healedByUid, identity);
}

/**
 * Drop all run state. Called at the start of each transpile pass, which is the
 * one point that runs exactly once per test run — Playwright's watch/UI mode
 * re-evaluates the config in the SAME process, and without this the second run
 * would report the first run's statements alongside its own and reset any
 * statement the first run had marked `healed`.
 */
export function resetRunCacheMetadata(): void {
  (globalThis as Record<string, unknown>)[STASH_KEY] = {} as RunCacheStash;
}

/** Test-only alias of {@link resetRunCacheMetadata}. */
export function __resetRunCacheCollector(): void {
  resetRunCacheMetadata();
}
