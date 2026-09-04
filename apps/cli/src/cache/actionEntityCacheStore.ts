/**
 * Action Entity Cache — Abstraction Layer
 *
 * Interface for reading/writing cached action entity stores per test file.
 * Two implementations:
 * - LocalActionEntityCache: reads/writes .shiplight/cache/ on local filesystem
 * - CloudActionEntityCache: calls Shiplight API backed by Supabase DB
 *
 * Selection:
 * - NODE_ENV=production + SHIPLIGHT_API_TOKEN → CloudActionEntityCache
 * - Otherwise → LocalActionEntityCache
 */

import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';
import type { ActionEntityStore } from 'shiplight-types';
import { createEmptyStore } from 'shiplight-types';
import { getShiplightEnv } from '../dotenvSource.js';

export interface ActionEntityCache {
  /** Whether this cache uses cloud storage (affects key format). */
  readonly isCloud: boolean;

  /**
   * Load cached action stores for the given test paths.
   * Returns a map of test path → ActionEntityStore.
   */
  lookup(testPaths: string[]): Promise<Map<string, ActionEntityStore>>;

  /**
   * Save action stores for the given test paths.
   * Returns the number of stores successfully saved.
   */
  update(stores: Map<string, ActionEntityStore>): Promise<number>;

  /**
   * Load all cached stores (used by transpiler at config time).
   * Returns undefined if no cached stores exist.
   */
  loadAll(): Map<string, ActionEntityStore> | undefined;
}

/**
 * Create the appropriate cache based on environment.
 * - CI + SHIPLIGHT_API_TOKEN → CloudActionEntityCache
 * - Otherwise → LocalActionEntityCache
 *
 * Uses the CI env var (set by GitHub Actions, CircleCI, etc.) rather than
 * NODE_ENV, since NODE_ENV=production is commonly set on dev machines.
 */
export function createActionEntityCache(cwd: string): ActionEntityCache {
  // `CI` is injected by the CI platform itself, not user config — it cannot
  // live in `.env`, so it stays on process.env. The token is user config and
  // comes from the .env stash (so a stale shell-level token doesn't
  // accidentally opt a dev machine into the cloud cache).
  const apiToken = getShiplightEnv().SHIPLIGHT_API_TOKEN;
  if (process.env.CI && apiToken) {
    return new CloudActionEntityCache();
  }
  return new LocalActionEntityCache(cwd);
}

// ============================================================================
// Local Action Entity Cache
// ============================================================================

const CACHE_DIR = '.shiplight/action-cache';

/**
 * Escape a test path for use as a filename: slashes → double underscores.
 */
export function escapeTestPath(testPath: string): string {
  return testPath.replace(/\//g, '__') + '.json';
}

/**
 * Reverse escapeTestPath: double underscores → slashes, strip .json.
 */
export function unescapeTestPath(fileName: string): string {
  return fileName.replace(/\.json$/, '').replace(/__/g, '/');
}

/**
 * File-based cache for dev environments.
 * Reads/writes JSON files in .shiplight/cache/{escaped_path}.json.
 * Persistent across runs on the same machine.
 */
class LocalActionEntityCache implements ActionEntityCache {
  readonly isCloud = false;
  private cacheDir: string;

  constructor(private cwd: string) {
    this.cacheDir = path.join(cwd, CACHE_DIR);
  }

  async lookup(testPaths: string[]): Promise<Map<string, ActionEntityStore>> {
    const stores = new Map<string, ActionEntityStore>();
    if (testPaths.length === 0 || !fs.existsSync(this.cacheDir)) return stores;

    for (const testPath of testPaths) {
      const cachePath = path.join(this.cacheDir, escapeTestPath(testPath));
      try {
        if (fs.existsSync(cachePath)) {
          const content = fs.readFileSync(cachePath, 'utf-8');
          stores.set(testPath, JSON.parse(content) as ActionEntityStore);
        }
      } catch {
        // Skip invalid files
      }
    }

    return stores;
  }

  async update(stores: Map<string, ActionEntityStore>): Promise<number> {
    if (stores.size === 0) return 0;

    fs.mkdirSync(this.cacheDir, { recursive: true });

    let count = 0;
    for (const [testPath, store] of stores) {
      try {
        const cachePath = path.join(this.cacheDir, escapeTestPath(testPath));
        // Merge with existing store (new entries override old)
        let existing = createEmptyStore();
        if (fs.existsSync(cachePath)) {
          try {
            existing = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
          } catch { /* ignore */ }
        }

        const merged: ActionEntityStore = {
          ...existing,
          entries: { ...existing.entries, ...store.entries },
        };
        fs.writeFileSync(cachePath, JSON.stringify(merged, null, 2));
        count++;
      } catch {
        // Skip write failures
      }
    }

    return count;
  }

  /**
   * Load all cached stores from the cache directory.
   * Used by the transpiler at config time (reads all files, not specific paths).
   */
  loadAll(): Map<string, ActionEntityStore> | undefined {
    if (!fs.existsSync(this.cacheDir)) return undefined;

    const cacheFiles = globSync('*.json', { cwd: this.cacheDir });
    if (cacheFiles.length === 0) return undefined;

    const stores = new Map<string, ActionEntityStore>();
    let totalEntries = 0;

    for (const file of cacheFiles) {
      try {
        const content = fs.readFileSync(path.join(this.cacheDir, file), 'utf-8');
        const store = JSON.parse(content) as ActionEntityStore;
        const relPath = unescapeTestPath(file);
        stores.set(relPath, store);
        totalEntries += Object.keys(store.entries ?? {}).length;
      } catch {
        // Skip invalid files
      }
    }

    if (stores.size === 0) return undefined;

    console.log(`[shiplight] Cache: loaded ${totalEntries} cached action entit${totalEntries === 1 ? 'y' : 'ies'} for ${stores.size} test file${stores.size !== 1 ? 's' : ''}`);
    return stores;
  }
}

// ============================================================================
// Cloud Action Entity Cache
// ============================================================================

/**
 * Cloud-backed cache for production/CI environments.
 * Delegates to the HTTP client (actionEntityCacheClient).
 */
class CloudActionEntityCache implements ActionEntityCache {
  readonly isCloud = true;

  async lookup(testPaths: string[]): Promise<Map<string, ActionEntityStore>> {
    const { lookupActionStores } = await import('./actionEntityCacheClient.js');
    return lookupActionStores(testPaths);
  }

  async update(stores: Map<string, ActionEntityStore>): Promise<number> {
    const { updateActionStores } = await import('./actionEntityCacheClient.js');
    return updateActionStores(stores);
  }

  /** Cloud cache does not support loadAll — use lookup() with specific paths. */
  loadAll(): Map<string, ActionEntityStore> | undefined {
    return undefined;
  }
}

export { LocalActionEntityCache, CloudActionEntityCache };

/**
 * Read every action-entity store staged under `<cwd>/.shiplight/action-cache/`.
 *
 * This is what the transpiler needs at config time, and it is deliberately NOT
 * `createActionEntityCache(cwd).loadAll()`: in CI with a token that returns
 * `CloudActionEntityCache`, whose `loadAll()` is `undefined` by design (a
 * network backend cannot enumerate without paths). The orchestrator's
 * `preTestDownload` has already written whatever it fetched — cloud or local —
 * into that directory precisely so the spawned Playwright process can read it
 * off disk, so routing this through the backend meant CI runs applied none of
 * the entities they had just downloaded and reported a 0% hit rate for a cache
 * that was fully populated.
 */
export function loadStagedActionEntityStores(cwd: string): Map<string, ActionEntityStore> | undefined {
  return new LocalActionEntityCache(cwd).loadAll();
}
