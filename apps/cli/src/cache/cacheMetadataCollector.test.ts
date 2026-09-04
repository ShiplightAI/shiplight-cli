import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CacheMetadataCollector, mergeCacheSummaries } from './cacheMetadataCollector.js';
import type { ActionEntity, RunCacheSummary } from 'shiplight-types';

const makeEntity = (actionName: string, locator?: string): ActionEntity => ({
  action_description: 'test',
  action_data: { action_name: actionName, kwargs: {} },
  ...(locator ? { locator } : {}),
});

describe('CacheMetadataCollector', () => {
  it('should track original statements', () => {
    const collector = new CacheMetadataCollector();
    collector.recordStatementSource('hash1', 'main.0', 'Click button', 'original', makeEntity('click', '#btn'));

    const summary = collector.getSummary();
    assert.equal(summary.total_statements, 1);
    assert.equal(summary.original, 1);
    assert.equal(summary.cache_hits, 0);
  });

  it('should track cache hits', () => {
    const collector = new CacheMetadataCollector();
    collector.recordStatementSource('hash1', 'main.0', 'Click button', 'cache_hit',
      makeEntity('click', '#old-btn'),
      makeEntity('click', '#cached-btn'),
    );

    const summary = collector.getSummary();
    assert.equal(summary.cache_hits, 1);
    assert.equal(summary.original, 0);

    const details = collector.getStatementDetails();
    assert.equal(details[0].cached_action_entity?.locator, '#cached-btn');
  });

  it('should update records when entities are healed', () => {
    const collector = new CacheMetadataCollector();
    collector.recordStatementSource('hash1', 'main.0', 'Click button', 'original', makeEntity('click', '#btn'));

    // After execution, statement was healed
    const healedMap = new Map<string, ActionEntity>();
    healedMap.set('uid-1', makeEntity('click', '#healed-btn'));
    const uidToHash = new Map<string, string>();
    uidToHash.set('uid-1', 'hash1');

    collector.recordHealedEntities(healedMap, uidToHash);

    const summary = collector.getSummary();
    assert.equal(summary.healed, 1);
    assert.equal(summary.original, 0);

    const details = collector.getStatementDetails();
    assert.equal(details[0].source, 'healed');
    assert.equal(details[0].healed_action_entity?.locator, '#healed-btn');
    assert.equal(details[0].heal_reason, 'locator_changed');
  });

  it('should detect action_changed heal reason', () => {
    const collector = new CacheMetadataCollector();
    collector.recordStatementSource('hash1', 'main.0', 'Click button', 'original',
      makeEntity('click', '#btn'));

    const healedMap = new Map<string, ActionEntity>();
    healedMap.set('uid-1', makeEntity('double_click', '#btn'));
    const uidToHash = new Map([['uid-1', 'hash1']]);

    collector.recordHealedEntities(healedMap, uidToHash);

    const details = collector.getStatementDetails();
    assert.equal(details[0].heal_reason, 'action_changed');
  });

  it('should detect both heal reason', () => {
    const collector = new CacheMetadataCollector();
    collector.recordStatementSource('hash1', 'main.0', 'Click button', 'original',
      makeEntity('click', '#btn'));

    const healedMap = new Map<string, ActionEntity>();
    healedMap.set('uid-1', makeEntity('double_click', '#new-btn'));
    const uidToHash = new Map([['uid-1', 'hash1']]);

    collector.recordHealedEntities(healedMap, uidToHash);

    const details = collector.getStatementDetails();
    assert.equal(details[0].heal_reason, 'both');
  });

  it('should track failed statements', () => {
    const collector = new CacheMetadataCollector();
    collector.recordStatementSource('hash1', 'main.0', 'Click button', 'original');
    collector.recordFailed('hash1');

    const summary = collector.getSummary();
    assert.equal(summary.failed, 1);
    assert.equal(summary.original, 0);
  });

  it('should produce correct mixed summary', () => {
    const collector = new CacheMetadataCollector();
    collector.recordStatementSource('h1', 'main.0', 'Navigate', 'original');
    collector.recordStatementSource('h2', 'main.1', 'Click login', 'cache_hit');
    collector.recordStatementSource('h3', 'main.2', 'Click submit', 'cache_hit');
    collector.recordStatementSource('h4', 'main.3', 'Verify result', 'original');
    collector.recordStatementSource('h5', 'main.4', 'Click next', 'original');

    // One statement was healed during execution
    const healedMap = new Map<string, ActionEntity>();
    healedMap.set('uid-5', makeEntity('click', '#healed'));
    collector.recordHealedEntities(healedMap, new Map([['uid-5', 'h5']]));

    // One statement failed
    collector.recordFailed('h4');

    const summary = collector.getSummary();
    assert.equal(summary.total_statements, 5);
    assert.equal(summary.original, 1);    // h1
    assert.equal(summary.cache_hits, 2);  // h2, h3
    assert.equal(summary.healed, 1);      // h5
    assert.equal(summary.failed, 1);      // h4
  });

  it('should produce correct console summary', () => {
    const collector = new CacheMetadataCollector();
    collector.recordStatementSource('h1', 'main.0', 'Nav', 'original');
    collector.recordStatementSource('h2', 'main.1', 'Click', 'cache_hit');
    collector.recordStatementSource('h3', 'main.2', 'Submit', 'original');

    const healedMap = new Map<string, ActionEntity>();
    healedMap.set('uid-3', makeEntity('click', '#new'));
    collector.recordHealedEntities(healedMap, new Map([['uid-3', 'h3']]));

    const line = collector.getConsoleSummary();
    assert.ok(line.includes('1 cached'), 'should show cache hits');
    assert.ok(line.includes('1 healed'), 'should show healed');
    assert.ok(line.includes('1 original'), 'should show original');
  });

  it('should return empty string for empty collector', () => {
    const collector = new CacheMetadataCollector();
    assert.equal(collector.getConsoleSummary(), '');
  });

  it('should ignore healed UIDs with no matching hash', () => {
    const collector = new CacheMetadataCollector();
    collector.recordStatementSource('h1', 'main.0', 'Click', 'original');

    // Healed UID has no hash mapping — should be ignored
    const healedMap = new Map<string, ActionEntity>();
    healedMap.set('unknown-uid', makeEntity('click', '#x'));
    collector.recordHealedEntities(healedMap, new Map());

    const summary = collector.getSummary();
    assert.equal(summary.original, 1);
    assert.equal(summary.healed, 0);
  });
});

describe('mergeCacheSummaries', () => {
  const summary = (over: Partial<RunCacheSummary>): RunCacheSummary => ({
    total_statements: 0,
    original: 0,
    cache_hits: 0,
    healed: 0,
    healed_from_cache: 0,
    failed: 0,
    ...over,
  });

  it('returns undefined when no shard carried a summary', () => {
    assert.equal(mergeCacheSummaries([undefined, undefined]), undefined);
  });

  it('passes a lone shard through unchanged', () => {
    const only = summary({ total_statements: 5, original: 3, cache_hits: 2 });
    assert.deepEqual(mergeCacheSummaries([undefined, only]), only);
  });

  it('does not multiply the corpus by the shard count', () => {
    // Every shard transpiles every YAML file — Playwright's --shard splits only
    // which tests EXECUTE — so summing the transpile-time buckets would report
    // a run with four times the statements it has.
    const shard = summary({ total_statements: 10, original: 4, cache_hits: 6 });
    const merged = mergeCacheSummaries([shard, shard, shard, shard])!;

    assert.equal(merged.total_statements, 10);
    assert.equal(merged.original, 4);
    assert.equal(merged.cache_hits, 6);
  });

  it('unions healing across shards, taking it out of the right bucket', () => {
    // Same corpus of 10 (4 original + 6 cached). Shard A healed one cached
    // statement, shard B healed one cached and one inline — disjoint sets,
    // because a shard can only heal what it ran.
    const a = summary({ total_statements: 10, original: 4, cache_hits: 5, healed: 1, healed_from_cache: 1 });
    const b = summary({ total_statements: 10, original: 3, cache_hits: 5, healed: 2, healed_from_cache: 1 });

    const merged = mergeCacheSummaries([a, b])!;
    assert.equal(merged.total_statements, 10);
    assert.equal(merged.healed, 3);
    assert.equal(merged.healed_from_cache, 2);
    assert.equal(merged.cache_hits, 4);
    assert.equal(merged.original, 3);
    // The buckets still account for every statement exactly once.
    assert.equal(merged.original + merged.cache_hits + merged.healed + merged.failed, 10);
  });

  it('sums shards that transpiled genuinely different corpora', () => {
    // Different totals mean the shards were each given their own file list, so
    // the statements are disjoint and a plain sum is exact.
    const a = summary({ total_statements: 4, original: 1, cache_hits: 3 });
    const b = summary({ total_statements: 6, original: 6 });

    const merged = mergeCacheSummaries([a, b])!;
    assert.equal(merged.total_statements, 10);
    assert.equal(merged.original, 7);
    assert.equal(merged.cache_hits, 3);
  });

  it('recognises the same corpus when one shard predates healed_from_cache', () => {
    // A legacy shard attributes all healing to the cache; a current shard splits
    // it. Comparing the split directly made an identical corpus look like two
    // different ones, which fell through to the sum branch and DOUBLED
    // total_statements on any merge spanning a CLI upgrade.
    const legacy = { total_statements: 10, original: 4, cache_hits: 4, healed: 2, failed: 0 } as RunCacheSummary;
    const modern = summary({ total_statements: 10, original: 4, cache_hits: 4, healed: 2, healed_from_cache: 2 });

    const merged = mergeCacheSummaries([legacy, modern])!;
    assert.equal(merged.total_statements, 10, 'corpus must not be doubled');
    assert.equal(merged.healed, 4);
    assert.equal(
      merged.original + merged.cache_hits + merged.healed + merged.failed,
      10,
      'buckets must still account for every statement exactly once',
    );
  });

  it('still sums genuinely different corpora that share a pre-heal total', () => {
    // Guard the relaxed check: differing totals must still take the sum branch.
    const a = summary({ total_statements: 4, original: 1, cache_hits: 3 });
    const b = summary({ total_statements: 6, original: 6 });
    assert.equal(mergeCacheSummaries([a, b])!.total_statements, 10);
  });

  it('sums failures across same-corpus shards rather than taking the max', () => {
    // A failure is a runtime outcome, so it is disjoint across shards the same
    // way healing is — a shard can only fail what it ran. Math.max merged
    // shards failing 2 and 1 DISTINCT statements into 2 instead of 3.
    // (`failed` is structurally 0 today and stripped from the upload, so this
    // guards the logic against the day recordFailed gains a caller.)
    const a = summary({ total_statements: 10, original: 4, cache_hits: 4, failed: 2 });
    const b = summary({ total_statements: 10, original: 4, cache_hits: 4, failed: 1 });

    assert.equal(mergeCacheSummaries([a, b])!.failed, 3);
  });

  it('attributes healing to the cache when an older shard omits the split', () => {
    // Reports written before `healed_from_cache` existed carry only `healed`,
    // which was documented as "a cache entry that did not work".
    const legacy = { total_statements: 5, original: 2, cache_hits: 2, healed: 1, failed: 0 } as RunCacheSummary;
    const merged = mergeCacheSummaries([legacy, legacy])!;

    assert.equal(merged.total_statements, 5);
    assert.equal(merged.cache_hits, 1);
    assert.equal(merged.original, 2);
    assert.equal(merged.healed, 2);
  });
});
