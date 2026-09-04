import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { __setShiplightEnvForTest } from '../dotenvSource.js';

describe('actionEntityCacheClient', () => {
  let client: typeof import('./actionEntityCacheClient.js');
  let importCounter = 0;

  beforeEach(async () => {
    __setShiplightEnvForTest({
      SHIPLIGHT_API_TOKEN: 'test-token-123',
      SHIPLIGHT_API_URL: 'https://test-api.shiplight.ai',
    });
    client = await import(`./actionEntityCacheClient.js?v=${++importCounter}`);
  });

  afterEach(() => {
    __setShiplightEnvForTest(undefined);
  });

  describe('lookupActionStores', () => {
    it('should return empty map when API token is not set', async () => {
      __setShiplightEnvForTest({});
      client = await import(`./actionEntityCacheClient.js?v=${++importCounter}`);

      const result = await client.lookupActionStores(['tests/login.test.yaml']);
      assert.equal(result.size, 0);
    });

    it('should return empty map for empty paths', async () => {
      const result = await client.lookupActionStores([]);
      assert.equal(result.size, 0);
    });

    it('should return stores on success', async (t) => {
      const store = { version: '1.0', entries: { hash1: { action_entity: {} } } };
      t.mock.method(globalThis, 'fetch', async () => ({
        ok: true,
        json: async () => ({ stores: { 'tests/login.test.yaml': store } }),
      }));

      const result = await client.lookupActionStores(['tests/login.test.yaml']);
      assert.equal(result.size, 1);
      assert.deepEqual(result.get('tests/login.test.yaml'), store);
    });

    it('should return empty map on non-OK response', async (t) => {
      t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500 }));

      const result = await client.lookupActionStores(['tests/login.test.yaml']);
      assert.equal(result.size, 0);
    });

    it('batches >100 paths into ≤100-path requests and merges results', async (t) => {
      // Regression: the server caps test_paths at 100 (HTTP 400 otherwise). A
      // >100-file repo sent in one request had its whole lookup rejected → cold
      // cache. The client must split into ≤100-path batches and union the results.
      const paths = Array.from({ length: 150 }, (_, i) => `tests/case-${i}.test.yaml`);
      const batchSizes: number[] = [];
      t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string) as { test_paths: string[] };
        batchSizes.push(body.test_paths.length);
        // Echo one store per requested path so we can verify the union.
        const stores: Record<string, unknown> = {};
        for (const p of body.test_paths) stores[p] = { version: '1.0', entries: {} };
        return { ok: true, json: async () => ({ stores }) };
      });

      const result = await client.lookupActionStores(paths);

      assert.deepEqual(batchSizes, [100, 50]);
      assert.ok(batchSizes.every((n) => n <= 100));
      assert.equal(result.size, 150);
      assert.ok(result.has('tests/case-0.test.yaml'));
      assert.ok(result.has('tests/case-149.test.yaml'));
    });

    it('sends a single request when paths are at or below the cap', async (t) => {
      const paths = Array.from({ length: 100 }, (_, i) => `tests/case-${i}.test.yaml`);
      let calls = 0;
      t.mock.method(globalThis, 'fetch', async () => {
        calls++;
        return { ok: true, json: async () => ({ stores: {} }) };
      });

      await client.lookupActionStores(paths);
      assert.equal(calls, 1);
    });

    it('splits 101 paths into a [100, 1] trailing batch (boundary)', async (t) => {
      // 101 is the first count that crosses into a second batch — guards the
      // chunk() loop against an off-by-one that would drop or mis-size the
      // single-element remainder.
      const paths = Array.from({ length: 101 }, (_, i) => `tests/case-${i}.test.yaml`);
      const batchSizes: number[] = [];
      t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string) as { test_paths: string[] };
        batchSizes.push(body.test_paths.length);
        const stores: Record<string, unknown> = {};
        for (const p of body.test_paths) stores[p] = { version: '1.0', entries: {} };
        return { ok: true, json: async () => ({ stores }) };
      });

      const result = await client.lookupActionStores(paths);

      assert.deepEqual(batchSizes, [100, 1]);
      assert.equal(result.size, 101);
      assert.ok(result.has('tests/case-100.test.yaml'));
    });

    it('retains a succeeding batch when another batch fails (independent degradation)', async (t) => {
      // The core resilience claim: a failed batch contributes no entries but must
      // NOT discard the batches that succeeded. Fail the FIRST batch (100 paths),
      // succeed the second (50) — result must contain exactly the second batch.
      const paths = Array.from({ length: 150 }, (_, i) => `tests/case-${i}.test.yaml`);
      let call = 0;
      t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string) as { test_paths: string[] };
        call++;
        if (call === 1) return { ok: false, status: 500, json: async () => ({}) };
        const stores: Record<string, unknown> = {};
        for (const p of body.test_paths) stores[p] = { version: '1.0', entries: {} };
        return { ok: true, json: async () => ({ stores }) };
      });

      const result = await client.lookupActionStores(paths);

      assert.equal(result.size, 50);
      assert.ok(!result.has('tests/case-0.test.yaml'), 'failed batch contributes nothing');
      assert.ok(result.has('tests/case-149.test.yaml'), 'succeeding batch is retained');
    });

    it('should return empty map on network error', async (t) => {
      t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network error'); });

      const result = await client.lookupActionStores(['tests/login.test.yaml']);
      assert.equal(result.size, 0);
    });
  });

  describe('updateActionStores', () => {
    it('should return 0 when API token is not set', async () => {
      __setShiplightEnvForTest({});
      client = await import(`./actionEntityCacheClient.js?v=${++importCounter}`);

      const stores = new Map([['test.yaml', { version: '1.0' as const, entries: {} }]]);
      const result = await client.updateActionStores(stores);
      assert.equal(result, 0);
    });

    it('should return 0 for empty stores', async () => {
      const result = await client.updateActionStores(new Map());
      assert.equal(result, 0);
    });

    it('should return update count on success', async (t) => {
      t.mock.method(globalThis, 'fetch', async () => ({
        ok: true,
        json: async () => ({ updated: 2 }),
      }));

      const stores = new Map([
        ['tests/a.yaml', { version: '1.0' as const, entries: {} }],
        ['tests/b.yaml', { version: '1.0' as const, entries: {} }],
      ]);
      const result = await client.updateActionStores(stores);
      assert.equal(result, 2);
    });

    it('should return 0 on network error', async (t) => {
      t.mock.method(globalThis, 'fetch', async () => { throw new Error('Connection refused'); });

      const stores = new Map([['test.yaml', { version: '1.0' as const, entries: {} }]]);
      const result = await client.updateActionStores(stores);
      assert.equal(result, 0);
    });

    it('batches >100 stores into ≤100-path requests and sums the updated counts', async (t) => {
      // Regression: the update endpoint caps `stores` at 100. A run that self-heals
      // >100 test files had its whole persist-back rejected (HTTP 400) → nothing saved.
      const stores = new Map<string, { version: '1.0'; entries: Record<string, never> }>();
      for (let i = 0; i < 150; i++) stores.set(`tests/case-${i}.yaml`, { version: '1.0', entries: {} });

      const batchSizes: number[] = [];
      t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string) as { stores: Record<string, unknown> };
        const count = Object.keys(body.stores).length;
        batchSizes.push(count);
        return { ok: true, json: async () => ({ updated: count }) };
      });

      const updated = await client.updateActionStores(stores);

      assert.deepEqual(batchSizes, [100, 50]);
      assert.ok(batchSizes.every((n) => n <= 100));
      assert.equal(updated, 150);
    });

    it('sends a single request when stores are at or below the cap', async (t) => {
      // Mirror of the lookup single-request boundary. The update loop wraps each
      // batch in `new Map(batch)`, a distinct path from lookup, so assert exactly
      // 100 stores go out as one request with 100 keys.
      const stores = new Map<string, { version: '1.0'; entries: Record<string, never> }>();
      for (let i = 0; i < 100; i++) stores.set(`tests/case-${i}.yaml`, { version: '1.0', entries: {} });

      const batchSizes: number[] = [];
      t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string) as { stores: Record<string, unknown> };
        batchSizes.push(Object.keys(body.stores).length);
        return { ok: true, json: async () => ({ updated: Object.keys(body.stores).length }) };
      });

      const updated = await client.updateActionStores(stores);

      assert.deepEqual(batchSizes, [100]);
      assert.equal(updated, 100);
    });

    it('sums only succeeding batches when another batch fails (independent degradation)', async (t) => {
      // A failed upload batch must not sink the batches that persisted. Fail the
      // first batch (100), succeed the second (50) → count reflects only the 50.
      const stores = new Map<string, { version: '1.0'; entries: Record<string, never> }>();
      for (let i = 0; i < 150; i++) stores.set(`tests/case-${i}.yaml`, { version: '1.0', entries: {} });

      let call = 0;
      t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string) as { stores: Record<string, unknown> };
        const count = Object.keys(body.stores).length;
        call++;
        if (call === 1) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, json: async () => ({ updated: count }) };
      });

      const updated = await client.updateActionStores(stores);

      assert.equal(updated, 50);
    });

    it('ignores stale shell-level SHIPLIGHT_API_TOKEN when .env stash sets a different token', async (t) => {
      // Regression: silent shell override of .env was the original bug.
      const originalShellToken = process.env.SHIPLIGHT_API_TOKEN;
      process.env.SHIPLIGHT_API_TOKEN = 'STALE-SHELL-TOKEN-SHOULD-BE-IGNORED';
      try {
        __setShiplightEnvForTest({
          SHIPLIGHT_API_TOKEN: 'env-token-from-dotenv',
          SHIPLIGHT_API_URL: 'https://test-api.shiplight.ai',
        });
        client = await import(`./actionEntityCacheClient.js?v=${++importCounter}`);

        let observedAuthHeader: string | undefined;
        t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
          observedAuthHeader = (init?.headers as Record<string, string> | undefined)?.Authorization;
          return { ok: true, json: async () => ({ updated: 0 }) };
        });

        await client.updateActionStores(new Map([['t.yaml', { version: '1.0' as const, entries: {} }]]));
        assert.equal(observedAuthHeader, 'Bearer env-token-from-dotenv');
      } finally {
        if (originalShellToken === undefined) delete process.env.SHIPLIGHT_API_TOKEN;
        else process.env.SHIPLIGHT_API_TOKEN = originalShellToken;
      }
    });
  });

  describe('token-prefix host routing', () => {
    // The client delegates host selection to resolveApiBase in
    // apps/cli/src/cloudApiBase.ts (inlined copy of sdk-core's proxy logic
    // to avoid pulling the sdk-core barrel into cli.js). These tests guard
    // the wiring — that the right token is passed in and the resulting
    // URL hits the right host.
    //
    // We mock SHIPLIGHT_API_URL via __setShiplightEnvForTest (not process.env)
    // because the client reads it through getShiplightEnv(). cloudUpload.ts
    // reads process.env.SHIPLIGHT_API_URL directly, so cloudUpload.test.ts
    // saves/restores process.env instead — same intent, different source.
    async function captureRequestUrl(
      env: Record<string, string>,
      run: (c: typeof client) => Promise<unknown>,
    ): Promise<string> {
      __setShiplightEnvForTest(env);
      const c = await import(`./actionEntityCacheClient.js?v=${++importCounter}`);
      let observedUrl: string | undefined;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (url: string) => {
        observedUrl = url;
        return { ok: true, json: async () => ({ stores: {}, updated: 0 }) } as unknown as Response;
      }) as typeof globalThis.fetch;
      try {
        await run(c);
      } finally {
        globalThis.fetch = originalFetch;
      }
      if (!observedUrl) throw new Error('fetch was not invoked');
      return observedUrl;
    }

    it('routes shp_pat_* tokens to api.shiplight.ai', async () => {
      const url = await captureRequestUrl(
        { SHIPLIGHT_API_TOKEN: 'shp_pat_abc123' },
        (c) => c.lookupActionStores(['tests/login.test.yaml']),
      );
      assert.ok(url.startsWith('https://api.shiplight.ai/'), `got ${url}`);
    });

    it('routes shp_ctx_* tokens to api.shiplight.ai', async () => {
      const url = await captureRequestUrl(
        { SHIPLIGHT_API_TOKEN: 'shp_ctx_xyz789' },
        (c) => c.updateActionStores(new Map([['t.yaml', { version: '1.0', entries: {} }]])),
      );
      assert.ok(url.startsWith('https://api.shiplight.ai/'), `got ${url}`);
    });

    it('makes no request at all for a legacy UUID token', async () => {
      // The v1 cloud was decommissioned in August 2026, so a legacy token
      // resolves to no host. The cache degrades to a no-op (FR-011) rather
      // than calling a dead endpoint or failing the run.
      // captureRequestUrl throws when fetch is never called, which is exactly
      // the assertion here: the client must not reach the network at all.
      await assert.rejects(
        () =>
          captureRequestUrl(
            { SHIPLIGHT_API_TOKEN: '11111111-2222-3333-4444-555555555555' },
            (c) => c.lookupActionStores(['tests/login.test.yaml']),
          ),
        /fetch was not invoked/,
      );
    });

    it('honors SHIPLIGHT_API_URL override even for shp_* tokens', async () => {
      const url = await captureRequestUrl(
        {
          SHIPLIGHT_API_TOKEN: 'shp_pat_abc',
          SHIPLIGHT_API_URL: 'http://localhost:3001',
        },
        (c) => c.lookupActionStores(['tests/login.test.yaml']),
      );
      assert.ok(url.startsWith('http://localhost:3001/'), `got ${url}`);
    });
  });

});
