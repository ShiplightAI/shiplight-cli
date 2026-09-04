/**
 * Action Entity Cache Types
 *
 * Types for the cloud-backed action entity cache used by YAML tests in CI.
 * Maps statement hashes to full ActionEntity objects, enabling reuse of
 * self-healed actions across runs.
 */

import type { ActionEntity } from './actionEntity.js';

/**
 * A single cached action entity entry, stored in the cloud.
 */
export interface ActionEntityCacheEntry {
  /** SHA-256 truncated to 16 hex chars */
  statement_hash: string;
  /** Full action entity (action_data, locator, xpath, etc.) */
  action_entity: ActionEntity;
  /** What triggered the cache update */
  update_source: 'runner' | 'sandbox' | 'generation';
  /** Relative path to YAML file (for debugging/inspection) */
  file_path: string;
  /** Structural position e.g. 'main.0', 'beforeEach.1' */
  statement_path: string;
  /** Statement description (for debugging/inspection) */
  description: string;
  /** ISO 8601 timestamp of last update */
  updated_at: string;
}

/**
 * Per-statement metadata collected during a run, tracking how the
 * action entity was resolved (from source, cache, or self-healing).
 */
export interface RunStatementCacheMetadata {
  statement_hash: string;
  statement_path: string;
  description: string;
  /** How this statement's action entity was resolved */
  source: 'original' | 'cache_hit' | 'healed' | 'failed';
  /** Action entity from the YAML source */
  original_action_entity?: ActionEntity;
  /** Action entity from the cache (when source is 'cache_hit') */
  cached_action_entity?: ActionEntity;
  /** Action entity produced by self-healing (when source is 'healed') */
  healed_action_entity?: ActionEntity;
  /** Why self-healing was needed (when source is 'healed') */
  heal_reason?: 'locator_changed' | 'action_changed' | 'both';
}

/**
 * Run-level cache summary, aggregated from per-statement metadata.
 * Included in the test report JSON.
 */
export interface RunCacheSummary {
  total_statements: number;
  /** Used YAML source as-is */
  original: number;
  /** Used cached entity from previous healing */
  cache_hits: number;
  /** Self-healed this run (new cache entry) */
  healed: number;
  /**
   * Of `healed`, how many had resolved from the CACHE before healing — i.e.
   * cache entries that went stale. The remainder healed from the YAML's own
   * inline entity, which the cache is not responsible for. Optional: reports
   * written before this field existed do not carry it.
   */
  healed_from_cache?: number;
  /** Broken, self-healing also failed */
  failed: number;
}

/**
 * Execution-scoped counts of what the action-entity cache actually did during a run.
 *
 * Distinct from {@link RunCacheSummary}, which is a TRANSPILE-time view: the
 * transpiler walks every YAML file it can see and reports how each statement's
 * entity resolved, so its counts include statements in tests that never ran (tag
 * filters, `--shard`, `skip`, an early failure), count both arms of an `IF`, and
 * count a `WHILE` body once no matter how often it looped. That view answers "how
 * much of the corpus can the cache serve". It cannot answer "how many model calls
 * did the cache save on this run", because it never learns which statements ran.
 *
 * These counts come from the runtime instead: every statement counted here reached
 * `agent.step()`, so it executed. Statements resolved by AI on purpose (DRAFT) are
 * excluded throughout — they compile to `agent.execute()` and never reach
 * `agent.step()`. A DRAFT is not a heal: nothing failed, the AI call is the
 * intended behaviour, and folding it in would overstate what the cache rescued.
 *
 * The unit is one statement per test ATTEMPT, not one statement. Within an attempt a
 * step id maps to a single result record, so a looping `WHILE` body contributes once
 * and a statement that healed on any iteration counts as healed. Across attempts it
 * does not collapse: a test retried twice contributes each of its statements three
 * times, because each attempt genuinely re-executed them and re-spent (or re-saved)
 * the model calls. So `executed` is an execution count and can exceed the number of
 * distinct statements in the corpus — do NOT compare it against
 * {@link RunCacheSummary}'s `total_statements` to derive what fraction of the corpus
 * ran.
 *
 * Every field is disjoint across the shards of a run, because a statement can only be
 * counted where it actually executed — so merging sharded runs is a plain sum, unlike
 * {@link RunCacheSummary}.
 */
export interface RunCacheExecutionSummary {
  /** Statements that executed with an action entity, cached or inline. The denominator. */
  executed: number;
  /**
   * Executed off a CACHED entity that worked — no model call was needed. This is the
   * cache's payoff: without the cache each of these would have fallen back to the
   * inline entity that previously failed, and self-healing would have run again.
   */
  cache_served: number;
  /**
   * Executed, failed, and self-healing recovered them. Auto-heal that fired and won.
   */
  auto_healed: number;
  /**
   * Executed, failed, self-healing was invoked and did NOT recover them. Auto-heal
   * that fired and lost. Counted separately from `auto_healed` because both spent a
   * model call: `auto_healed + auto_heal_failed` is how many times AI was invoked to
   * rescue a step this run.
   */
  auto_heal_failed: number;
  /**
   * Of `auto_healed + auto_heal_failed`, how many had resolved from the CACHE — a
   * cache entry that went stale, so the cache cost a model call rather than saving
   * one. The remainder healed from the YAML's own inline entity, which the cache is
   * not responsible for.
   */
  healed_from_cache: number;
}
