import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ActionEntity } from 'shiplight-types';
import {
  cachedActionEntitiesByStatementUid,
  cacheServedStatementUids,
  isRunMeasurementIncomplete,
  runCacheCollector,
  hasRunCacheMetadata,
  markRunCacheInPlay,
  markRunMeasurementIncomplete,
  recordRunHealedEntities,
  __resetRunCacheCollector,
} from './runCacheMetadata.js';

const entity = (locator: string): ActionEntity => ({
  action_description: 'click it',
  locator,
});

describe('run cache metadata', () => {
  beforeEach(() => __resetRunCacheCollector());

  it('reports nothing measured until a statement is recorded', () => {
    // A run whose specs were all up to date transpiles nothing. Emitting a
    // summary there would claim a measured 0% hit rate where nothing was
    // measured — the caller must be able to omit the field entirely.
    markRunCacheInPlay();
    assert.equal(hasRunCacheMetadata(), false);

    runCacheCollector().recordStatementSource('main.0', 'a.yaml', 'click', 'original', entity('#a'));
    assert.equal(hasRunCacheMetadata(), true);
  });

  it('reports nothing when the run had no action-entity cache at all', () => {
    // Without this gate a developer who never enabled the cache gets an
    // "Action Entity Cache" panel reading only "N original" on every report,
    // and the platform stores a cacheSummary it cannot tell apart from a run
    // whose cache is merely cold.
    runCacheCollector().recordStatementSource('main.0', 'a.yaml', 'click', 'original', entity('#a'));
    assert.equal(hasRunCacheMetadata(), false);
  });

  it('reports nothing when part of the run went unobserved', () => {
    // A file that failed to transpile still runs — from whatever stale spec a
    // previous transpile left behind. A rate measured over the remaining files
    // would look measured while covering an unknown fraction of the run.
    markRunCacheInPlay();
    runCacheCollector().recordStatementSource('main.0', 'a.yaml', 'click', 'cache_hit', entity('#a'), entity('#a2'));
    assert.equal(hasRunCacheMetadata(), true);

    markRunMeasurementIncomplete();
    assert.equal(hasRunCacheMetadata(), false);
  });

  it('drops everything on reset, so a second run in one process starts clean', () => {
    // Playwright's watch/UI mode re-evaluates the config in the SAME process.
    // Without a reset the second run would report the first run's statements
    // alongside its own and undo any heal the first run recorded.
    markRunCacheInPlay();
    runCacheCollector().recordStatementSource('main.0', 'a.yaml', 'x', 'cache_hit', entity('#a'), entity('#a'));
    recordRunHealedEntities(new Map([['main.0', entity('#new')]]));
    assert.equal(runCacheCollector().getSummary().healed, 1);

    __resetRunCacheCollector();
    assert.equal(hasRunCacheMetadata(), false);
    assert.equal(runCacheCollector().getSummary().total_statements, 0);
  });

  it('counts cache hits separately from originals', () => {
    const c = runCacheCollector();
    c.recordStatementSource('main.0', 'a.yaml', 'one', 'cache_hit', entity('#a'), entity('#a2'));
    c.recordStatementSource('main.1', 'a.yaml', 'two', 'cache_hit', entity('#b'), entity('#b2'));
    c.recordStatementSource('main.2', 'a.yaml', 'three', 'original', entity('#c'));

    const s = c.getSummary();
    assert.equal(s.total_statements, 3);
    assert.equal(s.cache_hits, 2);
    assert.equal(s.original, 1);
    assert.equal(s.healed, 0);
  });

  it('promotes a statement to healed when the run produced a new entity for it', () => {
    const c = runCacheCollector();
    c.recordStatementSource('main.0', 'a.yaml', 'one', 'cache_hit', entity('#old'), entity('#old'));
    c.recordStatementSource('main.1', 'a.yaml', 'two', 'original', entity('#fine'));

    recordRunHealedEntities(new Map([['main.0', entity('#new')]]));

    const s = c.getSummary();
    // The healed statement leaves the cache_hit bucket rather than being counted
    // twice — total is unchanged, and a heal is precisely a cache entry that
    // did NOT work.
    assert.equal(s.total_statements, 2);
    assert.equal(s.healed, 1);
    assert.equal(s.cache_hits, 0);
    assert.equal(s.original, 1);
  });

  it('ignores healed entities for statements it never saw', () => {
    const c = runCacheCollector();
    c.recordStatementSource('main.0', 'a.yaml', 'one', 'original', entity('#a'));

    // Healing recorded against a uid from a spec that was not transpiled this
    // run (up to date, so never recorded) must not invent a record.
    recordRunHealedEntities(new Map([['main.99', entity('#x')]]));

    assert.equal(c.getSummary().total_statements, 1);
    assert.equal(c.getSummary().healed, 0);
  });

  it('is a single run-scoped instance, not a per-caller one', () => {
    // The transpiler and the reporter each reach for it independently; two
    // instances would each hold half a summary and report it as whole.
    runCacheCollector().recordStatementSource('main.0', 'a.yaml', 'x', 'original', entity('#a'));
    assert.equal(runCacheCollector().getSummary().total_statements, 1);
  });

  it('shares state with a second, independently loaded copy of this module', () => {
    // The real deployment has exactly two copies. tsup builds src/index.ts (the
    // writer, via config.ts -> transpile.ts) and src/reporter.ts (the reader)
    // as separate entries with splitting:false, so this module is INLINED once
    // per bundle. A module-level `let` would give each bundle its own collector
    // and the reporter's would always be empty — the whole summary silently
    // absent from every published build while a single-module-graph test like
    // the ones above passes. A second dynamic import with a distinct specifier
    // is the same situation this process can reproduce.
    // Typed as `string` so tsc does not try to resolve the query-suffixed
    // specifier — it is a runtime cache-buster, not a real module path.
    const secondCopy: string = './runCacheMetadata.js?second-bundle';
    return (import(secondCopy) as Promise<typeof import('./runCacheMetadata.js')>).then((other) => {
      other.markRunCacheInPlay();
      other.runCacheCollector().recordStatementSource('main.0', 'a.yaml', 'x', 'cache_hit', entity('#a'), entity('#a'));

      assert.notEqual(other.runCacheCollector, runCacheCollector, 'expected a genuinely separate module instance');
      assert.equal(hasRunCacheMetadata(), true, 'reader must see what the other copy recorded');
      assert.equal(runCacheCollector().getSummary().cache_hits, 1);

      // …and healing folded in from this copy must reach the other one's records.
      recordRunHealedEntities(new Map([['main.0', entity('#new')]]));
      assert.equal(other.runCacheCollector().getSummary().healed, 1);
    });
  });

  it('tolerates an empty heal map', () => {
    runCacheCollector().recordStatementSource('main.0', 'a.yaml', 'x', 'original', entity('#a'));
    recordRunHealedEntities(new Map());
    assert.equal(runCacheCollector().getSummary().healed, 0);
  });

  describe('cacheServedStatementUids', () => {
    it('returns only the statements the transpiler took from the cache', () => {
      runCacheCollector().recordStatementSource('u1', 'a.yaml', 'x', 'cache_hit', entity('#a'), entity('#b'));
      runCacheCollector().recordStatementSource('u2', 'a.yaml', 'y', 'original', entity('#c'));
      assert.deepEqual([...cacheServedStatementUids()], ['u1']);
    });

    it('still reports a stale cache entry as cache-served after healing is folded in', () => {
      // The whole reason this is a separate snapshot: recordHealedEntities
      // overwrites `source` to 'healed', after which a cache entry that went stale
      // is indistinguishable from a statement that never had one. Callers must take
      // the snapshot BEFORE folding heals — this asserts the pre-heal answer is what
      // they get, so healed_from_cache can be attributed.
      runCacheCollector().recordStatementSource('u1', 'a.yaml', 'x', 'cache_hit', entity('#a'), entity('#b'));
      const before = cacheServedStatementUids();
      recordRunHealedEntities(new Map([['u1', entity('#new')]]));

      assert.deepEqual([...before], ['u1'], 'the snapshot must not be affected by later healing');
      assert.deepEqual([...cacheServedStatementUids()], [], 'after healing the record no longer reads as cache_hit');
    });

    it('is empty when no cache was in play', () => {
      assert.equal(cacheServedStatementUids().size, 0);
    });
  });

  describe('cachedActionEntitiesByStatementUid', () => {
    it('returns the action entity the transpiler actually selected from cache', () => {
      const authored = entity('#authored');
      const cached = entity('#cached');
      runCacheCollector().recordStatementSource('u1', 'a.yaml', 'x', 'cache_hit', authored, cached);

      assert.deepEqual(cachedActionEntitiesByStatementUid().get('u1'), cached);
    });

    it('returns undefined for an authored statement and an unknown statement', () => {
      runCacheCollector().recordStatementSource('u1', 'a.yaml', 'x', 'original', entity('#authored'));

      const actions = cachedActionEntitiesByStatementUid();
      assert.equal(actions.get('u1'), undefined);
      assert.equal(actions.get('missing'), undefined);
    });

    it('retains the cached attempt after that action goes stale and self-heals', () => {
      const cached = entity('#cached');
      runCacheCollector().recordStatementSource('u1', 'a.yaml', 'x', 'cache_hit', entity('#authored'), cached);
      recordRunHealedEntities(new Map([['u1', entity('#healed')]]));

      assert.deepEqual(cachedActionEntitiesByStatementUid().get('u1'), cached);
    });
  });

  describe('isRunMeasurementIncomplete', () => {
    it('is false for a run that observed everything', () => {
      markRunCacheInPlay();
      runCacheCollector().recordStatementSource('u1', 'a.yaml', 'x', 'original', entity('#a'));
      assert.equal(isRunMeasurementIncomplete(), false);
    });

    it('is true once a file failed to transpile', () => {
      // The execution-scoped summary reads this half of the gate on its own: a file
      // that failed to transpile still RUNS (Playwright executes the stale spec from
      // the previous transpile), so its statements inflate `executed` while carrying
      // UIDs the collector never saw and can never match as cache-served.
      markRunCacheInPlay();
      runCacheCollector().recordStatementSource('u1', 'a.yaml', 'x', 'original', entity('#a'));
      markRunMeasurementIncomplete();
      assert.equal(isRunMeasurementIncomplete(), true);
    });

    it('is independent of whether a cache was in play', () => {
      // A run with no cache must still report its auto-heal baseline, so the two
      // halves of the old gate cannot be collapsed into one flag.
      markRunMeasurementIncomplete();
      assert.equal(isRunMeasurementIncomplete(), true);
      assert.equal(hasRunCacheMetadata(), false);
    });

    it('is cleared by the per-run reset', () => {
      markRunMeasurementIncomplete();
      __resetRunCacheCollector();
      assert.equal(isRunMeasurementIncomplete(), false);
    });
  });
});
