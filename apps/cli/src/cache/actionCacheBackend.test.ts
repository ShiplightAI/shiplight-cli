import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createActionEntityCache, loadStagedActionEntityStores } from './actionEntityCacheStore.js';
import { __setShiplightEnvForTest } from '../dotenvSource.js';
import type { ActionEntityStore } from 'shiplight-types';

describe('action cache backend selection', () => {
  let originalCI: string | undefined;

  beforeEach(() => {
    originalCI = process.env.CI;
    delete process.env.CI;
    __setShiplightEnvForTest({});
  });

  afterEach(() => {
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
    __setShiplightEnvForTest(undefined);
  });

  for (const backend of [undefined, 'auto']) {
    for (const ci of [false, true]) {
      for (const token of [false, true]) {
        it(`${backend ?? 'unset'}: CI=${ci}, token=${token} preserves automatic selection`, () => {
          if (ci) process.env.CI = 'true';
          __setShiplightEnvForTest({
            ...(backend && { SHIPLIGHT_ACTION_CACHE_BACKEND: backend }),
            ...(token && { SHIPLIGHT_API_TOKEN: 'shp_pat_test' }),
          });
          assert.equal(createActionEntityCache(process.cwd()).isCloud, ci && token);
        });
      }
    }
  }

  it('cloud works outside CI', () => {
    __setShiplightEnvForTest({ SHIPLIGHT_ACTION_CACHE_BACKEND: 'cloud', SHIPLIGHT_API_TOKEN: 'shp_pat_test' });
    assert.equal(createActionEntityCache(process.cwd()).isCloud, true);
  });

  it('cloud requires a token', () => {
    __setShiplightEnvForTest({ SHIPLIGHT_ACTION_CACHE_BACKEND: 'cloud' });
    assert.throws(() => createActionEntityCache(process.cwd()), /cloud.*requires SHIPLIGHT_API_TOKEN/);
  });

  for (const token of ['', '   ']) {
    it(`cloud rejects a blank token (${JSON.stringify(token)})`, () => {
      __setShiplightEnvForTest({ SHIPLIGHT_ACTION_CACHE_BACKEND: 'cloud', SHIPLIGHT_API_TOKEN: token });
      assert.throws(() => createActionEntityCache(process.cwd()), /cloud.*requires SHIPLIGHT_API_TOKEN/);
    });
  }

  it('rejects unknown modes', () => {
    __setShiplightEnvForTest({ SHIPLIGHT_ACTION_CACHE_BACKEND: 'clodu' });
    assert.throws(() => createActionEntityCache(process.cwd()), /SHIPLIGHT_ACTION_CACHE_BACKEND.*auto.*local.*cloud/);
  });

  it('honours a shell-injected backend when no dotenv stash is loaded', (t) => {
    __setShiplightEnvForTest(undefined);
    const keys = ['SHIPLIGHT_ACTION_CACHE_BACKEND', 'SHIPLIGHT_API_TOKEN'] as const;
    const previous = keys.map((key) => process.env[key]);
    t.after(() => keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    }));
    process.env.SHIPLIGHT_ACTION_CACHE_BACKEND = 'local';
    process.env.SHIPLIGHT_API_TOKEN = 'shp_pat_test';
    process.env.CI = 'true';
    assert.equal(createActionEntityCache(process.cwd()).isCloud, false);
  });

  it('CI local mode persists and merges across runs without HTTP, even with a token', async (t) => {
    process.env.CI = 'true';
    __setShiplightEnvForTest({ SHIPLIGHT_ACTION_CACHE_BACKEND: 'local', SHIPLIGHT_API_TOKEN: 'shp_pat_test' });
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('Local cache must not make HTTP requests');
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-backend-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const testPath = 'tests/login.test.yaml';
    const store: ActionEntityStore = {
      version: '1.0',
      entries: {
        first: {
          action_entity: { action_description: 'Click login', action_data: { action_name: 'click', kwargs: {} }, locator: '#login' },
          updated_at: '2026-09-17T00:00:00.000Z',
          updated_by: { source: 'runner', test_run_id: 0 },
          source_fingerprint: 'original',
        },
      },
    };
    const cache = createActionEntityCache(dir);
    assert.equal(cache.isCloud, false);
    assert.equal(await cache.update(new Map([[testPath, store]])), 1);
    const nextRun = createActionEntityCache(dir);
    assert.deepEqual((await nextRun.lookup([testPath])).get(testPath), store);
    const second = { ...store.entries.first!, source_fingerprint: 'second' };
    await nextRun.update(new Map([[testPath, { version: '1.0', entries: { second } }]]));
    assert.deepEqual(loadStagedActionEntityStores(dir)?.get(testPath)?.entries, { ...store.entries, second });
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});
