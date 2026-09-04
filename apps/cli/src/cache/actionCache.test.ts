import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createEmptyStore } from 'shiplight-types';
import type { ActionEntity, ActionEntityStore, ActionStoreEntry } from 'shiplight-types';
import { LocalActionEntityCache, escapeTestPath, unescapeTestPath } from './actionEntityCacheStore.js';
import { CacheMetadataCollector } from './cacheMetadataCollector.js';

/**
 * Behavioral tests for the action-entity cache store + metadata collector.
 *
 * Closes quality-evidence gap exp-action-cache (002-shiplightai-cli): the cache
 * client/hash were tested, but the persistence store (write -> read -> loadAll,
 * merge) and the run metadata collector were name-only. This is the local,
 * file-backed path used on dev machines for self-healing locator caching.
 */

function storeWith(entries: Record<string, ActionStoreEntry>): ActionEntityStore {
  return { ...createEmptyStore(), entries };
}

const ENTRY_A: ActionEntity = {
  action_description: 'Click login',
  action_data: { action_name: 'click', kwargs: {} },
  locator: "getByRole('button', { name: 'Login' })",
};
const ENTRY_B: ActionEntity = {
  action_description: 'Type username',
  action_data: { action_name: 'input_text', kwargs: { text: 'me' } },
  locator: "getByLabel('Username')",
};

// Cache stores hold ActionStoreEntry (action_entity + provenance), not bare entities.
function entry(a: ActionEntity): ActionStoreEntry {
  return { action_entity: a, updated_at: '2026-06-07T00:00:00.000Z', updated_by: { source: 'runner', test_run_id: 1 } };
}
const STORE_A = entry(ENTRY_A);
const STORE_B = entry(ENTRY_B);

describe('escapeTestPath / unescapeTestPath', () => {
  it('roundtrips a nested test path', () => {
    const p = 'tests/sub/login.test.yaml';
    assert.equal(escapeTestPath(p), 'tests__sub__login.test.yaml.json');
    assert.equal(unescapeTestPath(escapeTestPath(p)), p);
  });
});

describe('LocalActionEntityCache persistence', () => {
  it('writes stores and reads them back via lookup and loadAll', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'shiplight-cache-'));
    try {
      const cache = new LocalActionEntityCache(dir);
      const testPath = 'tests/login.test.yaml';

      const n = await cache.update(new Map([[testPath, storeWith({ hashA: STORE_A })]]));
      assert.equal(n, 1, 'one store written');

      const looked = await cache.lookup([testPath]);
      assert.ok(looked.has(testPath));
      assert.deepEqual(looked.get(testPath)!.entries.hashA, STORE_A);

      const all = cache.loadAll();
      assert.ok(all, 'loadAll returns a map');
      assert.equal(all!.size, 1);
      assert.deepEqual(all!.get(testPath)!.entries.hashA, STORE_A);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges new entries into an existing store across updates', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'shiplight-cache-'));
    try {
      const cache = new LocalActionEntityCache(dir);
      const testPath = 'tests/login.test.yaml';

      await cache.update(new Map([[testPath, storeWith({ hashA: STORE_A })]]));
      await cache.update(new Map([[testPath, storeWith({ hashB: STORE_B })]]));

      const looked = await cache.lookup([testPath]);
      const entries = looked.get(testPath)!.entries;
      assert.deepEqual(entries.hashA, STORE_A, 'original entry preserved');
      assert.deepEqual(entries.hashB, STORE_B, 'new entry merged in');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty/undefined when nothing is cached', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'shiplight-cache-'));
    try {
      const cache = new LocalActionEntityCache(dir);
      assert.equal((await cache.lookup(['tests/x.test.yaml'])).size, 0);
      assert.equal(cache.loadAll(), undefined);
      assert.equal(await cache.update(new Map()), 0, 'empty update is a no-op');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CacheMetadataCollector', () => {
  it('aggregates per-statement sources into a run summary', () => {
    const c = new CacheMetadataCollector();
    c.recordStatementSource('h1', 'tests/a.yaml#0', 'click', 'original', ENTRY_A);
    c.recordStatementSource('h2', 'tests/a.yaml#1', 'type', 'cache_hit', ENTRY_B, ENTRY_B);

    const summary = c.getSummary();
    assert.equal(summary.total_statements, 2);
    assert.equal(summary.original, 1);
    assert.equal(summary.cache_hits, 1);
    assert.equal(c.getStatementDetails().length, 2);
  });

  it('records healed entities with a heal reason and failures', () => {
    const c = new CacheMetadataCollector();
    c.recordStatementSource('h1', 'tests/a.yaml#0', 'click', 'original', ENTRY_A);
    c.recordStatementSource('h2', 'tests/a.yaml#1', 'type', 'original', ENTRY_B);

    // h1 heals: locator changed (same action, different locator).
    const healed: ActionEntity = {
      ...ENTRY_A,
      locator: "getByTestId('login-btn')",
    };
    c.recordHealedEntities(new Map([['uid1', healed]]), new Map([['uid1', 'h1']]));
    c.recordFailed('h2');

    const summary = c.getSummary();
    assert.equal(summary.healed, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.original, 0, 'h1 moved to healed, h2 to failed');

    const details = c.getStatementDetails();
    const h1 = details.find((d) => d.statement_hash === 'h1')!;
    assert.equal(h1.source, 'healed');
    assert.equal(h1.heal_reason, 'locator_changed');
  });

  it('produces an empty console summary when nothing was recorded', () => {
    assert.equal(new CacheMetadataCollector().getConsoleSummary(), '');
  });
});
