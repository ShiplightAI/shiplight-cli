import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createActionEntityCache, LocalActionEntityCache, escapeTestPath, unescapeTestPath, loadStagedActionEntityStores } from './actionEntityCacheStore.js';
import { __setShiplightEnvForTest } from '../dotenvSource.js';
import type { ActionEntityStore } from 'shiplight-types';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'action-cache-test-'));
}

function makeStore(entries: Record<string, unknown> = {}): ActionEntityStore {
  return { version: '1.0', entries } as ActionEntityStore;
}

describe('escapeTestPath / unescapeTestPath', () => {
  it('should escape slashes to double underscores', () => {
    assert.equal(escapeTestPath('tests/auth/login.test.yaml'), 'tests__auth__login.test.yaml.json');
  });

  it('should roundtrip', () => {
    const original = 'showcase/01-self-healing.test.yaml';
    assert.equal(unescapeTestPath(escapeTestPath(original)), original);
  });

  it('should handle no slashes', () => {
    assert.equal(escapeTestPath('login.test.yaml'), 'login.test.yaml.json');
    assert.equal(unescapeTestPath('login.test.yaml.json'), 'login.test.yaml');
  });
});

describe('createActionEntityCache — token comes from the .env stash, not the shell (issue #2176)', () => {
  const origCI = process.env.CI;
  const origToken = process.env.SHIPLIGHT_API_TOKEN;

  beforeEach(() => {
    process.env.CI = '1'; // cloud selection requires CI + a token
    __setShiplightEnvForTest(undefined);
  });

  afterEach(() => {
    if (origCI === undefined) delete process.env.CI;
    else process.env.CI = origCI;
    if (origToken === undefined) delete process.env.SHIPLIGHT_API_TOKEN;
    else process.env.SHIPLIGHT_API_TOKEN = origToken;
    __setShiplightEnvForTest(undefined);
  });

  it('selects the cloud cache when the stash carries a token', () => {
    __setShiplightEnvForTest({ SHIPLIGHT_API_TOKEN: 'shp_pat_from_dotenv' });
    assert.equal(createActionEntityCache(process.cwd()).isCloud, true);
  });

  it('selects local when the stash has no token, even if a stale shell token is set', () => {
    // The scenario #2176 fixes: parent used to read process.env (shell) directly.
    // The stash (mirroring .env) is authoritative; a shell-only token must NOT
    // opt a run into the cloud cache.
    process.env.SHIPLIGHT_API_TOKEN = 'shp_pat_stale_shell';
    __setShiplightEnvForTest({}); // .env declared no token
    assert.equal(createActionEntityCache(process.cwd()).isCloud, false);
  });

  it('honours the stash token over a divergent shell token', () => {
    // Stash (=.env) has a token → cloud, regardless of the shell value.
    process.env.SHIPLIGHT_API_TOKEN = 'shp_pat_stale_shell';
    __setShiplightEnvForTest({ SHIPLIGHT_API_TOKEN: 'shp_pat_real_dotenv' });
    assert.equal(createActionEntityCache(process.cwd()).isCloud, true);
  });
});

describe('LocalActionEntityCache', () => {
  let tmpDir: string;
  let cache: LocalActionEntityCache;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    cache = new LocalActionEntityCache(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('isCloud', () => {
    it('should be false', () => {
      assert.equal(cache.isCloud, false);
    });
  });

  describe('lookup', () => {
    it('should return empty map when cache dir does not exist', async () => {
      const result = await cache.lookup(['tests/login.test.yaml']);
      assert.equal(result.size, 0);
    });

    it('should return empty map for empty paths', async () => {
      const result = await cache.lookup([]);
      assert.equal(result.size, 0);
    });

    it('should return stored entries', async () => {
      const store = makeStore({ uid1: { action_entity: { xpath: '//button' } } });
      const cacheDir = path.join(tmpDir, '.shiplight', 'action-cache');
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'tests__login.test.yaml.json'), JSON.stringify(store));

      const result = await cache.lookup(['tests/login.test.yaml']);
      assert.equal(result.size, 1);
      assert.deepEqual(result.get('tests/login.test.yaml'), store);
    });

    it('should skip missing paths', async () => {
      const store = makeStore({ uid1: {} });
      const cacheDir = path.join(tmpDir, '.shiplight', 'action-cache');
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'tests__a.test.yaml.json'), JSON.stringify(store));

      const result = await cache.lookup(['tests/a.test.yaml', 'tests/b.test.yaml']);
      assert.equal(result.size, 1);
      assert.ok(result.has('tests/a.test.yaml'));
      assert.ok(!result.has('tests/b.test.yaml'));
    });

    it('should skip invalid JSON files', async () => {
      const cacheDir = path.join(tmpDir, '.shiplight', 'action-cache');
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'tests__bad.test.yaml.json'), 'not json');

      const result = await cache.lookup(['tests/bad.test.yaml']);
      assert.equal(result.size, 0);
    });
  });

  describe('update', () => {
    it('should return 0 for empty stores', async () => {
      const result = await cache.update(new Map());
      assert.equal(result, 0);
    });

    it('should write store files', async () => {
      const store = makeStore({ uid1: { action_entity: { xpath: '//a' } } });
      const stores = new Map([['tests/login.test.yaml', store]]);

      const result = await cache.update(stores);
      assert.equal(result, 1);

      const written = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.shiplight', 'action-cache', 'tests__login.test.yaml.json'), 'utf-8'),
      );
      assert.deepEqual(written.entries.uid1, store.entries.uid1);
    });

    it('should merge with existing entries', async () => {
      const cacheDir = path.join(tmpDir, '.shiplight', 'action-cache');
      fs.mkdirSync(cacheDir, { recursive: true });

      // Write existing
      const existing = makeStore({ uid1: { action_entity: { xpath: '//old' } } });
      fs.writeFileSync(path.join(cacheDir, 'tests__login.test.yaml.json'), JSON.stringify(existing));

      // Update with new entry
      const newStore = makeStore({ uid2: { action_entity: { xpath: '//new' } } });
      await cache.update(new Map([['tests/login.test.yaml', newStore]]));

      const merged = JSON.parse(
        fs.readFileSync(path.join(cacheDir, 'tests__login.test.yaml.json'), 'utf-8'),
      );
      assert.ok(merged.entries.uid1, 'should keep existing entry');
      assert.ok(merged.entries.uid2, 'should add new entry');
    });

    it('should override existing entries with same UID', async () => {
      const cacheDir = path.join(tmpDir, '.shiplight', 'action-cache');
      fs.mkdirSync(cacheDir, { recursive: true });

      const existing = makeStore({ uid1: { action_entity: { xpath: '//old' } } });
      fs.writeFileSync(path.join(cacheDir, 'tests__login.test.yaml.json'), JSON.stringify(existing));

      const updated = makeStore({ uid1: { action_entity: { xpath: '//healed' } } });
      await cache.update(new Map([['tests/login.test.yaml', updated]]));

      const result = JSON.parse(
        fs.readFileSync(path.join(cacheDir, 'tests__login.test.yaml.json'), 'utf-8'),
      );
      assert.equal(result.entries.uid1.action_entity.xpath, '//healed');
    });
  });

  describe('loadAll', () => {
    it('should return undefined when cache dir does not exist', () => {
      assert.equal(cache.loadAll(), undefined);
    });

    it('should return undefined when cache dir is empty', () => {
      fs.mkdirSync(path.join(tmpDir, '.shiplight', 'action-cache'), { recursive: true });
      assert.equal(cache.loadAll(), undefined);
    });

    it('should load all stores with unescaped keys', () => {
      const cacheDir = path.join(tmpDir, '.shiplight', 'action-cache');
      fs.mkdirSync(cacheDir, { recursive: true });

      const store1 = makeStore({ uid1: { action_entity: {} } });
      const store2 = makeStore({ uid2: { action_entity: {} }, uid3: { action_entity: {} } });
      fs.writeFileSync(path.join(cacheDir, 'tests__login.test.yaml.json'), JSON.stringify(store1));
      fs.writeFileSync(path.join(cacheDir, 'showcase__heal.test.yaml.json'), JSON.stringify(store2));

      const result = cache.loadAll();
      assert.ok(result);
      assert.equal(result.size, 2);
      assert.ok(result.has('tests/login.test.yaml'));
      assert.ok(result.has('showcase/heal.test.yaml'));
      assert.equal(Object.keys(result.get('showcase/heal.test.yaml')!.entries).length, 2);
    });

    it('should skip invalid JSON files', () => {
      const cacheDir = path.join(tmpDir, '.shiplight', 'action-cache');
      fs.mkdirSync(cacheDir, { recursive: true });

      fs.writeFileSync(path.join(cacheDir, 'valid.test.yaml.json'), JSON.stringify(makeStore({ uid1: {} })));
      fs.writeFileSync(path.join(cacheDir, 'bad.test.yaml.json'), '{broken');

      const result = cache.loadAll();
      assert.ok(result);
      assert.equal(result.size, 1);
    });
  });
});

describe('loadStagedActionEntityStores — the transpiler reads the staged dir, not the backend', () => {
  const origCI = process.env.CI;
  let tmpDir: string;

  function stage(entries: Record<string, unknown>) {
    const cacheDir = path.join(tmpDir, '.shiplight', 'action-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, 'tests__login.test.yaml.json'),
      JSON.stringify(makeStore(entries)),
    );
  }

  beforeEach(() => {
    tmpDir = makeTmpDir();
    __setShiplightEnvForTest(undefined);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (origCI === undefined) delete process.env.CI;
    else process.env.CI = origCI;
    __setShiplightEnvForTest(undefined);
  });

  it('reads the staged stores in CI with a token — where the backend cannot', () => {
    // The regression this guards: config.ts used to call
    // createActionEntityCache(cwd).loadAll(). In CI with a token that is
    // CloudActionEntityCache, whose loadAll() is unconditionally undefined
    // (a network backend cannot enumerate without paths) — so the entities
    // preTestDownload had just written to .shiplight/action-cache/ were never
    // read and NO cached entity was applied to any CI run.
    process.env.CI = '1';
    __setShiplightEnvForTest({ SHIPLIGHT_API_TOKEN: 'shp_pat_ci' });
    stage({ uid1: { action_entity: {} } });

    const backend = createActionEntityCache(tmpDir);
    assert.equal(backend.isCloud, true, 'precondition: this env selects the cloud backend');
    assert.equal(backend.loadAll(), undefined, 'precondition: the cloud backend cannot enumerate');

    const staged = loadStagedActionEntityStores(tmpDir);
    assert.ok(staged, 'staged stores must still be readable');
    assert.ok(staged.has('tests/login.test.yaml'));
  });

  it('reads the same stores on a local dev run with no token', () => {
    delete process.env.CI;
    __setShiplightEnvForTest({});
    stage({ uid1: { action_entity: {} } });

    const staged = loadStagedActionEntityStores(tmpDir);
    assert.ok(staged);
    assert.equal(staged.size, 1);
  });

  it('returns undefined when nothing has been staged', () => {
    // Distinct from "an empty cache": undefined is what tells the transpiler the
    // cache feature is not in play for this run, which gates the cache summary.
    assert.equal(loadStagedActionEntityStores(tmpDir), undefined);
  });
});
