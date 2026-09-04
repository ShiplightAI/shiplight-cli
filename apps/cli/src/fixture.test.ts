import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyVarsOverride,
  createTestContext,
  isDeclaredSensitive,
  parseVarsOverrideEnv,
  resolveAuthState,
  resolveProjectRoot,
  resolveTestDataDir,
  resolveTestPage,
  resolveUserPath,
  type AuthSpec,
} from './fixture.js';
import type { VariableStore } from 'shiplight-types';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';

/** Minimal VariableStore mock matching the interface createTestContext expects */
function createMockVariableStore(): VariableStore & { isSensitive(key: string): boolean } {
  const store = new Map<string, { value: any; sensitive: boolean }>();
  return {
    get(key: string) { return store.get(key)?.value; },
    set(key: string, value: any, sensitive = false) { store.set(key, { value, sensitive }); },
    has(key: string) { return store.has(key); },
    isSensitive(key: string) { return store.get(key)?.sensitive ?? false; },
    getAll() {
      const result: Record<string, any> = {};
      for (const [k, v] of store) result[k] = v.value;
      return result;
    },
  } as unknown as VariableStore & { isSensitive(key: string): boolean };
}

describe('resolveTestPage', () => {
  it('reuses the initial page created by a persistent context', async () => {
    const initialPage = { url: () => 'about:blank' } as Page;
    let newPageCalls = 0;
    const context = {
      pages: () => [initialPage],
      newPage: async () => {
        newPageCalls += 1;
        return { url: () => 'about:blank' } as Page;
      },
    } as unknown as BrowserContext;

    const page = await resolveTestPage(context);

    assert.equal(page, initialPage);
    assert.equal(newPageCalls, 0);
  });

  it('creates a page when the context starts without one', async () => {
    const createdPage = { url: () => 'about:blank' } as Page;
    let newPageCalls = 0;
    const context = {
      pages: () => [],
      newPage: async () => {
        newPageCalls += 1;
        return createdPage;
      },
    } as unknown as BrowserContext;

    const page = await resolveTestPage(context);

    assert.equal(page, createdPage);
    assert.equal(newPageCalls, 1);
  });
});

describe('resolveAuthState', () => {
  it('should call login(args) and return the state file path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
    const authFile = join(dir, 'auth.login.mjs');
    writeFileSync(authFile, `
      export async function login(args) {
        return '/tmp/state-' + args.username + '.json';
      }
    `);
    try {
      const result = await resolveAuthState({ auth: authFile, args: { username: 'admin' } });
      assert.equal(result, '/tmp/state-admin.json');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('resolves a relative auth path against projectRoot, not process.cwd()', async () => {
    // Auth path is relative; it must resolve against the passed projectRoot
    // (Playwright's config.rootDir) rather than the dir the test runner ran from.
    const dir = mkdtempSync(join(tmpdir(), 'auth-root-'));
    writeFileSync(join(dir, 'auth.login.mjs'), `
      export async function login() { return '/tmp/state-rooted.json'; }
    `);
    try {
      assert.notEqual(dir, process.cwd());
      const result = await resolveAuthState(
        { auth: 'auth.login.mjs' }, undefined, undefined, dir,
      );
      assert.equal(result, '/tmp/state-rooted.json');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('should pass empty object when args is undefined', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
    const authFile = join(dir, 'auth.login.mjs');
    writeFileSync(authFile, `
      export async function login(args) {
        return '/tmp/state-' + Object.keys(args).length + '.json';
      }
    `);
    try {
      const result = await resolveAuthState({ auth: authFile });
      assert.equal(result, '/tmp/state-0.json');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('should support default export', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
    const authFile = join(dir, 'auth.login.mjs');
    writeFileSync(authFile, `
      export default async function(args) {
        return '/tmp/default-state.json';
      }
    `);
    try {
      const result = await resolveAuthState({ auth: authFile });
      assert.equal(result, '/tmp/default-state.json');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('should throw if module does not export login function', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
    const authFile = join(dir, 'auth.login.mjs');
    writeFileSync(authFile, `export const notAFunction = 42;`);
    try {
      await assert.rejects(
        () => resolveAuthState({ auth: authFile }),
        (err: Error) => {
          assert.ok(err.message.includes('must export a login(args, browser?) function'));
          return true;
        }
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('should throw if login does not return a string', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
    const authFile = join(dir, 'auth.login.mjs');
    writeFileSync(authFile, `
      export async function login(args) {
        return 42;
      }
    `);
    try {
      await assert.rejects(
        () => resolveAuthState({ auth: authFile }),
        (err: Error) => {
          assert.ok(err.message.includes('must return a storageState file path'));
          return true;
        }
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('should throw if auth module does not exist', async () => {
    await assert.rejects(
      () => resolveAuthState({ auth: '/nonexistent/auth.login.ts' }),
    );
  });

  it('should pass all args fields to the login function', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
    const authFile = join(dir, 'auth.login.mjs');
    writeFileSync(authFile, `
      export async function login(args) {
        return JSON.stringify(args);
      }
    `);
    try {
      const result = await resolveAuthState({
        auth: authFile,
        args: { username: 'user', password: 'pass', totp_secret: 'ABC' },
      });
      const parsed = JSON.parse(result);
      assert.equal(parsed.username, 'user');
      assert.equal(parsed.password, 'pass');
      assert.equal(parsed.totp_secret, 'ABC');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('should inject baseURL into args when spec.args is undefined', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
    const authFile = join(dir, 'auth.login.mjs');
    writeFileSync(authFile, `
      export async function login(args) {
        return JSON.stringify(args);
      }
    `);
    try {
      const result = await resolveAuthState(
        { auth: authFile },
        undefined,
        'https://example.com',
      );
      const parsed = JSON.parse(result);
      assert.equal(parsed.baseUrl, 'https://example.com');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('should inject baseURL into args when not already set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
    const authFile = join(dir, 'auth.login.mjs');
    writeFileSync(authFile, `
      export async function login(args) {
        return JSON.stringify(args);
      }
    `);
    try {
      const result = await resolveAuthState(
        { auth: authFile, args: { username: 'user' } },
        undefined,
        'https://example.com',
      );
      const parsed = JSON.parse(result);
      assert.equal(parsed.baseUrl, 'https://example.com');
      assert.equal(parsed.username, 'user');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('should inject baseURL when args has baseUrl: undefined', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
    const authFile = join(dir, 'auth.login.mjs');
    writeFileSync(authFile, `
      export async function login(args) {
        return JSON.stringify(args);
      }
    `);
    try {
      const result = await resolveAuthState(
        { auth: authFile, args: { baseUrl: undefined } },
        undefined,
        'https://example.com',
      );
      const parsed = JSON.parse(result);
      assert.equal(parsed.baseUrl, 'https://example.com');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('should not override explicit baseUrl in args', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
    const authFile = join(dir, 'auth.login.mjs');
    writeFileSync(authFile, `
      export async function login(args) {
        return JSON.stringify(args);
      }
    `);
    try {
      const result = await resolveAuthState(
        { auth: authFile, args: { baseUrl: 'https://custom.com' } },
        undefined,
        'https://example.com',
      );
      const parsed = JSON.parse(result);
      assert.equal(parsed.baseUrl, 'https://custom.com');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

});

describe('createTestContext', () => {
  it('should support property-style get/set (testContext.myVar)', () => {
    const store = createMockVariableStore();
    const ctx = createTestContext(store);

    ctx.username = 'alice';
    assert.equal(ctx.username, 'alice');
    assert.equal(store.get('username'), 'alice');
  });

  it('should support explicit get/set methods', () => {
    const store = createMockVariableStore();
    const ctx = createTestContext(store);

    ctx.set('token', 'abc123', true);
    assert.equal(ctx.get('token'), 'abc123');
    assert.equal(store.get('token'), 'abc123');
  });

  it('should return undefined for unset variables', () => {
    const store = createMockVariableStore();
    const ctx = createTestContext(store);

    assert.equal(ctx.nonexistent, undefined);
    assert.equal(ctx.get('nonexistent'), undefined);
  });

  it('should share state with the underlying VariableStore', () => {
    const store = createMockVariableStore();
    const ctx = createTestContext(store);

    // Set via store, read via ctx
    store.set('fromStore', 'value1');
    assert.equal(ctx.fromStore, 'value1');

    // Set via ctx, read via store
    ctx.fromCtx = 'value2';
    assert.equal(store.get('fromCtx'), 'value2');
  });

  it('should expose __variableStore for agent integration', () => {
    const store = createMockVariableStore();
    const ctx = createTestContext(store);

    assert.strictEqual((ctx as any).__variableStore, store);
  });

  it('should support getAll()', () => {
    const store = createMockVariableStore();
    const ctx = createTestContext(store);

    ctx.a = '1';
    ctx.b = '2';
    const all = ctx.getAll();
    assert.equal(all.a, '1');
    assert.equal(all.b, '2');
  });

  it('$ and ctx aliases should be the same object', () => {
    const store = createMockVariableStore();
    const testContext = createTestContext(store);
    // Simulate what the fixture does
    const $ = testContext;
    const ctx = testContext;

    $.email = 'test@example.com';
    assert.equal(testContext.email, 'test@example.com');
    assert.equal(ctx.email, 'test@example.com');

    ctx.count = 42;
    assert.equal($.count, 42);
    assert.equal(testContext.count, 42);
  });

  it('should not allow overwriting built-in methods via property access', () => {
    const store = createMockVariableStore();
    const ctx = createTestContext(store);

    // get/set/getAll should remain functions even after property-style set
    ctx.someVar = 'test';
    assert.equal(typeof ctx.get, 'function');
    assert.equal(typeof ctx.set, 'function');
    assert.equal(typeof ctx.getAll, 'function');
  });

  it('should support "in" operator for variable check', () => {
    const store = createMockVariableStore();
    const ctx = createTestContext(store);

    ctx.exists = 'yes';
    assert.ok('exists' in ctx);
    assert.ok(!('missing' in ctx));
  });

  it('should handle Symbol property access without throwing', () => {
    const store = createMockVariableStore();
    const ctx = createTestContext(store);

    // Symbols are used internally by JS (e.g., Symbol.toPrimitive, Symbol.iterator)
    // The set trap must not return false for Symbols (throws in strict mode)
    const sym = Symbol('test');
    assert.doesNotThrow(() => { (ctx as any)[sym] = 'value'; });
    assert.equal((ctx as any)[sym], 'value');
  });
});

describe('parseVarsOverrideEnv', () => {
  it('returns null for undefined / empty', () => {
    assert.equal(parseVarsOverrideEnv(undefined), null);
    assert.equal(parseVarsOverrideEnv(''), null);
  });

  it('parses a valid JSON object', () => {
    assert.deepEqual(parseVarsOverrideEnv('{"A":"1","B":"two"}'), {
      A: '1',
      B: 'two',
    });
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parseVarsOverrideEnv('{not json'), /not valid JSON/);
  });

  it('throws on a non-object root', () => {
    assert.throws(() => parseVarsOverrideEnv('["a"]'), /must be a JSON object/);
    assert.throws(() => parseVarsOverrideEnv('"hi"'), /must be a JSON object/);
  });

  it('throws when a value is not a string', () => {
    assert.throws(() => parseVarsOverrideEnv('{"A":1}'), /must be a string/);
  });
});

describe('isDeclaredSensitive', () => {
  it('returns false when key is not declared anywhere', () => {
    assert.equal(isDeclaredSensitive('X', { Y: 'val' }, undefined), false);
  });

  it('returns false for a string-form declaration', () => {
    assert.equal(isDeclaredSensitive('X', { X: 'val' }, undefined), false);
  });

  it('returns true when project declares sensitive', () => {
    assert.equal(
      isDeclaredSensitive('X', { X: { value: 'v', sensitive: true } }, undefined),
      true,
    );
  });

  it('lets test-level declaration override project-level', () => {
    // Test declares non-sensitive; should win over project sensitive
    assert.equal(
      isDeclaredSensitive(
        'X',
        { X: { value: 'p', sensitive: true } },
        { X: 'overridden-not-sensitive' },
      ),
      false,
    );
    // Test declares sensitive; project missing
    assert.equal(
      isDeclaredSensitive(
        'X',
        undefined,
        { X: { value: 't', sensitive: true } },
      ),
      true,
    );
  });
});

describe('applyVarsOverride', () => {
  it('does nothing when env var is not set', () => {
    const store = createMockVariableStore();
    store.set('A', 'original', false);
    applyVarsOverride(store, { A: 'declared' }, undefined, undefined);
    assert.equal(store.get('A'), 'original');
  });

  it('overrides existing values with env values', () => {
    const store = createMockVariableStore();
    store.set('A', 'original', false);
    applyVarsOverride(
      store,
      { A: 'declared' },
      undefined,
      '{"A":"from-cli"}',
    );
    assert.equal(store.get('A'), 'from-cli');
  });

  it('inherits sensitive flag from project declaration', () => {
    const store = createMockVariableStore();
    applyVarsOverride(
      store,
      { SECRET: { value: 'orig', sensitive: true } },
      undefined,
      '{"SECRET":"new-secret"}',
    );
    assert.equal(store.get('SECRET'), 'new-secret');
    assert.equal(store.isSensitive('SECRET'), true);
  });

  it('marks undeclared keys as non-sensitive', () => {
    const store = createMockVariableStore();
    applyVarsOverride(store, undefined, undefined, '{"NEW":"val"}');
    assert.equal(store.get('NEW'), 'val');
    assert.equal(store.isSensitive('NEW'), false);
  });

  it('throws on invalid env var content', () => {
    const store = createMockVariableStore();
    assert.throws(
      () => applyVarsOverride(store, undefined, undefined, '{bad'),
      /not valid JSON/,
    );
  });
});

describe('resolveProjectRoot', () => {
  // The upload_file action joins relative `paths` against the agent context's
  // testDataDir; the fixture anchors that to the project root, NOT process.cwd(),
  // so uploads keep working when the test run is launched from a different dir
  // (e.g. `playwright test --config sub/playwright.config.ts` from a parent).
  const fakeTestInfo = (rootDir?: string, configFile?: string) =>
    ({
      config: {
        ...(rootDir === undefined ? {} : { rootDir }),
        ...(configFile === undefined ? {} : { configFile }),
      },
    } as unknown as TestInfo);

  it("returns Playwright's config.rootDir, not process.cwd()", () => {
    const root = '/repo/apps/frontend';
    assert.notEqual(root, process.cwd());
    assert.equal(resolveProjectRoot(fakeTestInfo(root)), root);
  });

  it('falls back to process.cwd() when rootDir is unavailable', () => {
    assert.equal(resolveProjectRoot(fakeTestInfo(undefined)), process.cwd());
  });

  it('falls back to process.cwd() when config is missing', () => {
    assert.equal(resolveProjectRoot({} as unknown as TestInfo), process.cwd());
  });

  /**
   * Regression for issue #2208 — `config.rootDir` is NOT the project root.
   * Playwright computes it as `path.resolve(configDir, userConfig.testDir) || configDir`,
   * so any config with the conventional `testDir: './tests'` makes rootDir the
   * *test* directory. Anchoring user paths there resolved `extensionDir: ./dist`
   * to `<root>/tests/dist`. The directory holding playwright.config.* is the
   * project root, which is what the docs and the examples imply.
   */
  it('prefers the directory holding playwright.config.* over rootDir', () => {
    const info = fakeTestInfo('/repo/tests/e2e', '/repo/playwright.config.ts');
    assert.equal(resolveProjectRoot(info), '/repo');
  });

  it('still returns rootDir when no config file was used', () => {
    assert.equal(resolveProjectRoot(fakeTestInfo('/repo/tests')), '/repo/tests');
  });

  it('ignores an empty configFile, which Playwright uses to mean "no config"', () => {
    assert.equal(resolveProjectRoot(fakeTestInfo('/repo/tests', '')), '/repo/tests');
  });
});

/**
 * Regression guard for the anchor move in issue #2208. resolveProjectRoot moved
 * from rootDir to the config directory, and every consumer that resolves a
 * FILE got the resolveUserPath fallback. `testDataDir` resolves a DIRECTORY —
 * upload_file joins relative paths against it later, inside sdk-core, so there
 * is nothing to probe at fixture time and the fallback cannot apply. It stays
 * on the old anchor so this change does not silently relocate upload fixtures.
 */
describe('resolveTestDataDir', () => {
  const fakeTestInfo = (rootDir?: string, configFile?: string) =>
    ({
      config: {
        ...(rootDir === undefined ? {} : { rootDir }),
        ...(configFile === undefined ? {} : { configFile }),
      },
    } as unknown as TestInfo);

  it('keeps the rootDir anchor even when it differs from the project root', () => {
    const info = fakeTestInfo('/repo/tests', '/repo/playwright.config.ts');
    assert.equal(resolveTestDataDir(info), '/repo/tests');
    assert.notEqual(resolveTestDataDir(info), resolveProjectRoot(info));
  });

  it('agrees with the project root when no testDir is configured', () => {
    // Playwright sets rootDir = configDir when testDir is unset, so the two
    // anchors coincide and nothing about uploads changes for those projects.
    const info = fakeTestInfo('/repo', '/repo/playwright.config.ts');
    assert.equal(resolveTestDataDir(info), resolveProjectRoot(info));
  });

  it('falls back to process.cwd() when rootDir is unavailable', () => {
    assert.equal(resolveTestDataDir(fakeTestInfo(undefined)), process.cwd());
  });
});

/**
 * Moving the anchor from rootDir to the config directory would silently break
 * any project that had its auth script, storage state or profile living under
 * testDir — those resolved correctly before and would now 404. resolveUserPath
 * keeps them working: the new anchor is authoritative, the old one is consulted
 * only when the file is genuinely not at the new location.
 */
describe('resolveUserPath', () => {
  const dirsToClean: string[] = [];
  afterEach(() => {
    for (const d of dirsToClean) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
    dirsToClean.length = 0;
  });

  /** Build `<tmp>/repo` (project root) and `<tmp>/repo/tests` (legacy rootDir). */
  function makeRoots() {
    const projectRoot = mkdtempSync(join(tmpdir(), 'proj-'));
    dirsToClean.push(projectRoot);
    const legacyRoot = join(projectRoot, 'tests');
    mkdirSync(legacyRoot, { recursive: true });
    return { projectRoot, legacyRoot };
  }

  it('resolves against the project root when the file is there', () => {
    const { projectRoot, legacyRoot } = makeRoots();
    writeFileSync(join(projectRoot, 'auth.login.ts'), '');

    assert.equal(
      resolveUserPath('./auth.login.ts', projectRoot, legacyRoot),
      join(projectRoot, 'auth.login.ts'),
    );
  });

  it('falls back to the legacy rootDir when the file only exists there', () => {
    const { projectRoot, legacyRoot } = makeRoots();
    writeFileSync(join(legacyRoot, 'auth.login.ts'), '');

    assert.equal(
      resolveUserPath('./auth.login.ts', projectRoot, legacyRoot),
      join(legacyRoot, 'auth.login.ts'),
    );
  });

  it('prefers the project root when the file exists at BOTH locations', () => {
    const { projectRoot, legacyRoot } = makeRoots();
    writeFileSync(join(projectRoot, 'auth.login.ts'), '');
    writeFileSync(join(legacyRoot, 'auth.login.ts'), '');

    assert.equal(
      resolveUserPath('./auth.login.ts', projectRoot, legacyRoot),
      join(projectRoot, 'auth.login.ts'),
    );
  });

  it('returns the project-root path when the file exists at neither, so errors name the expected location', () => {
    const { projectRoot, legacyRoot } = makeRoots();

    assert.equal(
      resolveUserPath('./missing.ts', projectRoot, legacyRoot),
      join(projectRoot, 'missing.ts'),
    );
  });

  it('does not consult the legacy root when the two are the same directory', () => {
    const { projectRoot } = makeRoots();
    assert.equal(
      resolveUserPath('./missing.ts', projectRoot, projectRoot),
      join(projectRoot, 'missing.ts'),
    );
  });

  it('leaves an absolute path untouched', () => {
    const { projectRoot, legacyRoot } = makeRoots();
    const abs = join(legacyRoot, 'somewhere.json');
    assert.equal(resolveUserPath(abs, projectRoot, legacyRoot), abs);
  });
});
