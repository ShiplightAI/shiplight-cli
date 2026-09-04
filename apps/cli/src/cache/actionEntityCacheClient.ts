/**
 * Action Entity Cache Client
 *
 * HTTP client for the cloud-backed action entity cache.
 * Used by the CLI orchestrator to download/upload cached action stores
 * per test file. Gracefully degrades when API token is absent or API unreachable.
 */

import type { ActionEntityStore } from 'shiplight-types';
import { resolveApiBase } from '../cloudApiBase.js';
import { getShiplightEnv } from '../dotenvSource.js';

const LOOKUP_TIMEOUT_MS = 2000;
const UPDATE_TIMEOUT_MS = 5000;

/**
 * The cloud API caps each request at 100 test paths — the cloud service
 * action-entity-cache lookup/update routes reject `test_paths` / `stores` over
 * 100 with HTTP 400. A repo with more than 100 `.test.yaml` files sent in one
 * request has its WHOLE lookup discarded → cold cache → every step runs the AI
 * path. Batch larger sets so a bare `shiplight test` on a big repo still warms
 * the cache it can.
 */
const MAX_PATHS_PER_REQUEST = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function getConfig(): { apiUrl: string; apiToken: string } | null {
  const env = getShiplightEnv();
  const apiToken = env.SHIPLIGHT_API_TOKEN;
  if (!apiToken) return null;

  // shp_* tokens use the production API. SHIPLIGHT_API_URL overrides. A legacy token resolves
  // to no host since that cloud was decommissioned; treat it as no token at
  // all so the cache stays a no-op (FR-011) rather than failing the run.
  const apiUrl = resolveApiBase(apiToken, env.SHIPLIGHT_API_URL);
  if (!apiUrl) return null;
  return { apiUrl, apiToken };
}

/**
 * Download cached action stores for multiple test files.
 * Returns a map of test_path → action_store JSON.
 * Returns empty map if API token is not set or API is unreachable.
 */
export async function lookupActionStores(
  testPaths: string[],
): Promise<Map<string, ActionEntityStore>> {
  const config = getConfig();
  if (!config || testPaths.length === 0) return new Map();

  // Batch at the server's per-request cap. Each batch degrades independently: a
  // failed batch contributes no entries (cold for those paths) but never discards
  // the batches that succeeded.
  const map = new Map<string, ActionEntityStore>();
  for (const batch of chunk(testPaths, MAX_PATHS_PER_REQUEST)) {
    for (const [testPath, store] of await lookupActionStoresBatch(config, batch)) {
      map.set(testPath, store);
    }
  }
  return map;
}

async function lookupActionStoresBatch(
  config: { apiUrl: string; apiToken: string },
  testPaths: string[],
): Promise<Map<string, ActionEntityStore>> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

    const response = await fetch(`${config.apiUrl}/action-entity-cache/lookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify({ test_paths: testPaths }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[shiplight] Cache lookup failed: HTTP ${response.status}`);
      return new Map();
    }

    const data = await response.json() as { stores: Record<string, ActionEntityStore> };
    const map = new Map<string, ActionEntityStore>();
    for (const [testPath, store] of Object.entries(data.stores ?? {})) {
      map.set(testPath, store);
    }
    return map;
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      console.warn('[shiplight] Cache lookup error:', err.message);
    }
    return new Map();
  }
}

/**
 * Upload action stores for multiple test files.
 * Returns number of stores updated.
 * Silently fails if API token is not set or API is unreachable.
 */
export async function updateActionStores(
  stores: Map<string, ActionEntityStore>,
): Promise<number> {
  const config = getConfig();
  if (!config || stores.size === 0) return 0;

  // Batch at the server's per-request cap so a run that self-heals >100 test files
  // persists all of them instead of having the whole upload rejected with HTTP 400.
  let updated = 0;
  for (const batch of chunk([...stores], MAX_PATHS_PER_REQUEST)) {
    updated += await updateActionStoresBatch(config, new Map(batch));
  }
  return updated;
}

async function updateActionStoresBatch(
  config: { apiUrl: string; apiToken: string },
  stores: Map<string, ActionEntityStore>,
): Promise<number> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS);

    const storesObj: Record<string, ActionEntityStore> = {};
    for (const [testPath, store] of stores) {
      storesObj[testPath] = store;
    }

    const response = await fetch(`${config.apiUrl}/action-entity-cache/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify({ stores: storesObj }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[shiplight] Cache update failed: HTTP ${response.status}`);
      return 0;
    }

    const data = await response.json() as { updated: number };
    return data.updated ?? 0;
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      console.warn('[shiplight] Cache update error:', err.message);
    }
    return 0;
  }
}
