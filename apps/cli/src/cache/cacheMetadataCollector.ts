/**
 * Cache Metadata Collector
 *
 * Tracks per-statement cache interaction during a test run.
 * Produces a summary for the test report.
 *
 * Usage:
 * 1. After transpilation: call recordStatementSource() for each statement
 * 2. After execution: call recordHealedEntities() with new-action-entities.json
 * 3. Call getSummary() and getStatementDetails() for the report
 */

import type { ActionEntity } from 'shiplight-types';
import type { RunStatementCacheMetadata, RunCacheSummary } from 'shiplight-types';

export type StatementSource = 'original' | 'cache_hit' | 'healed' | 'failed';

interface StatementRecord {
  statement_hash: string;
  statement_path: string;
  description: string;
  source: StatementSource;
  /**
   * What `source` was before healing overwrote it. Retained because the two
   * cases mean opposite things — a healed `cache_hit` is a cache entry that went
   * stale, a healed `original` is the YAML's own locator going stale, which the
   * cache is not responsible for — and because it is what lets sharded runs be
   * merged exactly (see `mergeCacheSummaries`).
   */
  pre_heal_source?: 'original' | 'cache_hit';
  original_action_entity?: ActionEntity;
  cached_action_entity?: ActionEntity;
  healed_action_entity?: ActionEntity;
  heal_reason?: 'locator_changed' | 'action_changed' | 'both';
}

export class CacheMetadataCollector {
  private records = new Map<string, StatementRecord>();

  /**
   * Record whether a statement used the original entity or a cached one.
   * Called during/after transpilation.
   */
  recordStatementSource(
    statementHash: string,
    statementPath: string,
    description: string,
    source: 'original' | 'cache_hit',
    originalEntity?: ActionEntity,
    cachedEntity?: ActionEntity,
  ): void {
    this.records.set(statementHash, {
      statement_hash: statementHash,
      statement_path: statementPath,
      description,
      source,
      original_action_entity: originalEntity,
      cached_action_entity: source === 'cache_hit' ? cachedEntity : undefined,
    });
  }

  /**
   * Update records with healed entities from execution.
   * Call after test execution with the content of new-action-entities.json.
   *
   * @param healedByUid - Map of statement UID → healed ActionEntity
   * @param uidToHash - Map of statement UID → statement hash (for correlating)
   */
  recordHealedEntities(
    healedByUid: Map<string, ActionEntity>,
    uidToHash: Map<string, string>,
  ): void {
    for (const [uid, healedEntity] of healedByUid) {
      const hash = uidToHash.get(uid);
      if (!hash) continue;

      const record = this.records.get(hash);
      if (record) {
        if (record.source === 'original' || record.source === 'cache_hit') {
          record.pre_heal_source = record.source;
        }
        record.source = 'healed';
        record.healed_action_entity = healedEntity;
        record.heal_reason = detectHealReason(record.original_action_entity, healedEntity);
      }
    }
  }

  /**
   * Mark a statement as failed (execution failed, self-healing also failed).
   */
  recordFailed(statementHash: string): void {
    const record = this.records.get(statementHash);
    if (record) {
      record.source = 'failed';
    }
  }

  /**
   * Get per-statement metadata for the report.
   */
  getStatementDetails(): RunStatementCacheMetadata[] {
    return Array.from(this.records.values());
  }

  /**
   * Get aggregated run-level summary.
   */
  getSummary(): RunCacheSummary {
    let original = 0;
    let cache_hits = 0;
    let healed = 0;
    let healed_from_cache = 0;
    let failed = 0;

    for (const record of this.records.values()) {
      switch (record.source) {
        case 'original': original++; break;
        case 'cache_hit': cache_hits++; break;
        case 'healed':
          healed++;
          if (record.pre_heal_source === 'cache_hit') healed_from_cache++;
          break;
        case 'failed': failed++; break;
      }
    }

    return {
      total_statements: this.records.size,
      original,
      cache_hits,
      healed,
      healed_from_cache,
      failed,
    };
  }

  /**
   * Format a one-line console summary.
   */
  getConsoleSummary(): string {
    const s = this.getSummary();
    if (s.total_statements === 0) return '';
    const parts: string[] = [];
    if (s.cache_hits > 0) parts.push(`${s.cache_hits} cached`);
    if (s.healed > 0) parts.push(`${s.healed} healed`);
    if (s.original > 0) parts.push(`${s.original} original`);
    if (s.failed > 0) parts.push(`${s.failed} failed`);
    return `[Shiplight Cache] ${parts.join(', ')}`;
  }
}

/**
 * Combine the per-shard cache summaries of one sharded run.
 *
 * Shards do NOT partition the corpus. `shiplightConfig()` runs in every shard
 * process and transpiles every YAML file it can see — Playwright's `--shard`
 * splits only which tests EXECUTE — so each shard's transpile-time buckets
 * describe the same statements over and over, while healing is disjoint (a
 * shard can only heal what it ran). Summing everything would multiply the
 * corpus by the shard count; taking one shard's numbers would discard every
 * other shard's healing.
 *
 * So: reconstruct each shard's pre-heal buckets (a heal moved a statement out of
 * `original` or `cache_hit`, and `healed_from_cache` says which), confirm the
 * shards agree on that baseline, then subtract the union of their heals from it.
 * When the baselines disagree the shards transpiled genuinely different corpora
 * — e.g. each was invoked with its own file list — and a plain sum is the exact
 * answer for that case instead.
 */
export function mergeCacheSummaries(
  summaries: ReadonlyArray<RunCacheSummary | undefined>,
): RunCacheSummary | undefined {
  const present = summaries.filter((s): s is RunCacheSummary => s != null);
  if (present.length === 0) return undefined;
  if (present.length === 1) return { ...present[0] };

  // Pre-heal buckets, per shard. `healed_from_cache` is absent on reports
  // written by older shiplightai builds; attributing those heals to the cache
  // matches what `healed` was documented to mean at the time.
  const baselines = present.map((s) => {
    const fromCache = s.healed_from_cache ?? s.healed;
    return {
      total: s.total_statements,
      original: s.original + (s.healed - fromCache),
      cache_hits: s.cache_hits + fromCache,
      healedFromOriginal: s.healed - fromCache,
      healedFromCache: fromCache,
      failed: s.failed,
    };
  });

  const first = baselines[0];
  // Compared on quantities that do NOT depend on the healed/original split:
  // the total, and the pre-heal bucket SUM. Comparing `original` and
  // `cache_hits` individually looked stricter but was wrong — a shard written by
  // a CLI predating `healed_from_cache` attributes all its healing to the cache,
  // so an identical corpus reports a different split and the check would fall
  // through to the sum branch and DOUBLE `total_statements`. The sum
  // `original + cache_hits` is invariant across both encodings (each equals
  // original + cache_hits + healed), so a mixed-version merge is recognised as
  // the same corpus.
  const preHealTotal = (b: (typeof baselines)[number]) => b.original + b.cache_hits;
  const sameCorpus = baselines.every(
    (b) => b.total === first.total && preHealTotal(b) === preHealTotal(first),
  );
  const sum = (pick: (b: (typeof baselines)[number]) => number) =>
    baselines.reduce((acc, b) => acc + pick(b), 0);

  const healedFromOriginal = sum((b) => b.healedFromOriginal);
  const healedFromCache = sum((b) => b.healedFromCache);
  // Residual, unavoidable: on a mixed-version merge the split is taken from the
  // first shard, and a pre-`healed_from_cache` shard genuinely did not record
  // where its heals came from. `total_statements` and `healed` are exact either
  // way; only the original/cache_hits division can be skewed, and only by the
  // number of heals the legacy shard misattributed.
  const base = sameCorpus
    ? { total: first.total, original: first.original, cache_hits: first.cache_hits }
    : { total: sum((b) => b.total), original: sum((b) => b.original), cache_hits: sum((b) => b.cache_hits) };

  return {
    total_statements: base.total,
    original: base.original - healedFromOriginal,
    cache_hits: base.cache_hits - healedFromCache,
    healed: healedFromOriginal + healedFromCache,
    healed_from_cache: healedFromCache,
    // Summed in BOTH branches. A failure is a runtime outcome, so — like healing
    // — it is disjoint across same-corpus shards: a shard can only fail what it
    // actually ran. `Math.max` underestimated, merging shards that failed 2 and
    // 1 distinct statements into 2 instead of 3.
    // Residual gap, deliberate: a nonzero `failed` would also need pre-fail
    // provenance to be taken out of its origin bucket, the way
    // `healed_from_cache` does for healing, or the buckets stop summing to
    // total. That belongs with wiring `recordFailed` a production caller — see
    // `uploadableCacheSummary`, which strips this field from the upload until
    // then. Summing is simply the correct half of that work.
    failed: sum((b) => b.failed),
  };
}

/**
 * Detect what changed between the original and healed action entity.
 */
function detectHealReason(
  original?: ActionEntity,
  healed?: ActionEntity,
): 'locator_changed' | 'action_changed' | 'both' | undefined {
  if (!original || !healed) return undefined;

  const locatorChanged = original.locator !== healed.locator ||
    original.xpath !== healed.xpath;
  const actionChanged = original.action_data?.action_name !== healed.action_data?.action_name;

  if (locatorChanged && actionChanged) return 'both';
  if (locatorChanged) return 'locator_changed';
  if (actionChanged) return 'action_changed';
  return undefined;
}
