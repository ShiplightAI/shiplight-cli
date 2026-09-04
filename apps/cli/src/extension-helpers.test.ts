import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildExtensionArgs,
  buildPersistentChromiumArgs,
  buildPersistentLaunchOptions,
  loadAndExtendCookies,
  prepareExtensionLaunch,
  prepareProfileDir,
} from './extension-helpers.js';

/**
 * Unit tests for extension fixture helpers.
 * These test the actual exported functions from extension-helpers.ts.
 */

describe('loadAndExtendCookies', () => {
  const dirsToClean: string[] = [];
  afterEach(() => {
    for (const d of dirsToClean) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
    dirsToClean.length = 0;
  });

  it('should extend cookie expiration to ~1 year on all cookies', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fixture-test-'));
    dirsToClean.push(tempDir);
    const storageStatePath = join(tempDir, 'storage-state.json');
    writeFileSync(storageStatePath, JSON.stringify({
      cookies: [
        { name: 'a', value: '1', domain: '.example.com', path: '/', expires: 0 },
        { name: 'b', value: '2', domain: '.google.com', path: '/', expires: 1000 },
      ],
    }));

    const cookies = loadAndExtendCookies(storageStatePath)!;
    assert.equal(cookies.length, 2);

    const oneYearFromNow = (Date.now() + 365 * 24 * 60 * 60 * 1000) / 1000;
    for (const c of cookies) {
      assert.ok(Math.abs(c.expires - oneYearFromNow) < 2, 'Expiry should be ~1 year');
    }
    assert.equal(cookies[0].name, 'a');
    assert.equal(cookies[1].domain, '.google.com');
  });

  it('should return null and warn when file does not exist', () => {
    const result = loadAndExtendCookies(join(tmpdir(), 'nonexistent-' + Date.now() + '.json'));
    assert.equal(result, null);
  });

  it('should return null when file has no cookies key', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fixture-test-'));
    dirsToClean.push(tempDir);
    writeFileSync(join(tempDir, 'storage-state.json'), JSON.stringify({ origins: [] }));

    assert.equal(loadAndExtendCookies(join(tempDir, 'storage-state.json')), null);
  });

  it('should return null when cookies is not an array', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fixture-test-'));
    dirsToClean.push(tempDir);
    writeFileSync(join(tempDir, 'storage-state.json'), JSON.stringify({ cookies: "oops" }));

    assert.equal(loadAndExtendCookies(join(tempDir, 'storage-state.json')), null);
  });

  it('should skip malformed cookies missing name or domain', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fixture-test-'));
    dirsToClean.push(tempDir);
    writeFileSync(join(tempDir, 'storage-state.json'), JSON.stringify({
      cookies: [
        { name: 'good', value: '1', domain: '.example.com', path: '/' },
        { value: '2', domain: '.example.com' },  // missing name
        { name: 'bad' },  // missing domain
        null,  // not an object
      ],
    }));

    const cookies = loadAndExtendCookies(join(tempDir, 'storage-state.json'))!;
    assert.equal(cookies.length, 1);
    assert.equal(cookies[0].name, 'good');
  });

  it('should throw descriptive error for invalid JSON', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fixture-test-'));
    dirsToClean.push(tempDir);
    writeFileSync(join(tempDir, 'bad.json'), '{ invalid json');

    assert.throws(() => loadAndExtendCookies(join(tempDir, 'bad.json')), /Failed to parse extensionStorageState/);
  });
});

describe('prepareProfileDir', () => {
  const dirsToClean: string[] = [];
  afterEach(() => {
    for (const d of dirsToClean) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
    dirsToClean.length = 0;
  });

  it('should create unique temp dir when no extensionUserDataDir', () => {
    const userDataDir = prepareProfileDir(undefined);
    dirsToClean.push(userDataDir);
    assert.ok(existsSync(userDataDir), 'Dir should be created');
    assert.ok(isAbsolute(userDataDir));
  });

  it('should copy base profile and remove SingletonLock', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fixture-test-'));
    dirsToClean.push(tempDir);
    const baseDir = join(tempDir, 'profile');
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, 'cookies-db'), 'data');
    writeFileSync(join(baseDir, 'SingletonLock'), '');

    const userDataDir = prepareProfileDir(baseDir);
    dirsToClean.push(userDataDir);
    assert.ok(existsSync(userDataDir));
    assert.ok(existsSync(join(userDataDir, 'cookies-db')), 'Profile data should be copied');
    assert.ok(!existsSync(join(userDataDir, 'SingletonLock')), 'SingletonLock should be removed');
  });

  it('should create dir when base profile does not exist', () => {
    const nonExistent = join(tmpdir(), 'no-such-profile-' + Date.now());
    const userDataDir = prepareProfileDir(nonExistent);
    dirsToClean.push(userDataDir);
    assert.ok(existsSync(userDataDir));
  });

  it('should generate unique dirs for parallel safety', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fixture-test-'));
    dirsToClean.push(tempDir);
    const baseDir = join(tempDir, 'profile');
    mkdirSync(baseDir, { recursive: true });

    const dir1 = prepareProfileDir(baseDir);
    const dir2 = prepareProfileDir(baseDir);
    dirsToClean.push(dir1, dir2);
    assert.notEqual(dir1, dir2, 'Each call should produce a unique dir');
  });

  it('should place profile copies under tmpdir', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fixture-test-'));
    dirsToClean.push(tempDir);
    const baseDir = join(tempDir, 'profile');
    mkdirSync(baseDir, { recursive: true });

    const userDataDir = prepareProfileDir(baseDir);
    dirsToClean.push(userDataDir);
    assert.ok(userDataDir.startsWith(tmpdir()), 'Profile copy should be under tmpdir');
  });

  it('resolves a relative profile dir against projectRoot, not process.cwd()', () => {
    // A relative userDataDir must resolve against the passed projectRoot
    // (Playwright's config.rootDir), not the dir the test runner ran from.
    const projectRoot = mkdtempSync(join(tmpdir(), 'proj-root-'));
    dirsToClean.push(projectRoot);
    const baseDir = join(projectRoot, 'profile');
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, 'cookies-db'), 'data');

    assert.notEqual(projectRoot, process.cwd());
    const userDataDir = prepareProfileDir('profile', projectRoot);
    dirsToClean.push(userDataDir);
    // Copied from <projectRoot>/profile — proves it resolved against projectRoot.
    assert.ok(existsSync(join(userDataDir, 'cookies-db')), 'Profile data should be copied from projectRoot/profile');
  });
});

describe('buildExtensionArgs', () => {
  const dirsToClean: string[] = [];
  afterEach(() => {
    for (const d of dirsToClean) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
    dirsToClean.length = 0;
  });

  /** Create a directory that looks like a real unpacked extension. */
  function makeExtensionDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ext-'));
    dirsToClean.push(dir);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'x', version: '1' }));
    return dir;
  }

  it('should produce correct Chromium flags', () => {
    const extPath = makeExtensionDir();
    const args = buildExtensionArgs(extPath);

    assert.equal(args.length, 4);
    assert.equal(args[0], `--disable-extensions-except=${extPath}`);
    assert.equal(args[1], `--load-extension=${extPath}`);
    assert.equal(args[2], '--no-first-run');
    assert.equal(args[3], '--disable-default-apps');
  });

  it('should handle resolved absolute path', () => {
    const extDir = makeExtensionDir();
    const resolved = resolve(process.cwd(), extDir);
    const args = buildExtensionArgs(resolved);

    assert.ok(isAbsolute(resolved));
    assert.ok(args[0].includes(resolved));
    assert.ok(args[1].includes(resolved));
  });

  /**
   * Regression for issue #2208 — a bad extensionDir used to reach Chromium
   * unchecked. Verified against a real browser: both a missing directory and a
   * directory with no manifest.json make Chromium sit on a blocking
   * "could not load extension" dialog, so launchPersistentContext never
   * resolves and the run dies at the Playwright test timeout with no mention of
   * the extension or the path. Fail fast instead, naming the resolved path.
   */
  describe('validation (issue #2208)', () => {
    it('throws naming the resolved absolute path when the directory is missing', () => {
      const missing = join(tmpdir(), 'no-such-extension-' + Date.now());

      assert.throws(
        () => buildExtensionArgs(missing),
        (err: Error) => {
          assert.ok(err.message.includes(missing), 'must name the resolved absolute path');
          assert.ok(/does not exist/i.test(err.message), 'must say the path does not exist');
          return true;
        },
      );
    });

    it('quotes the value as the user wrote it, next to what it resolved to', () => {
      const missing = join(tmpdir(), 'no-such-extension-' + Date.now());

      assert.throws(
        () => buildExtensionArgs(missing, './dist'),
        (err: Error) => {
          assert.ok(err.message.includes('"./dist"'), 'must echo the configured value');
          assert.ok(err.message.includes(missing), 'must name the resolved absolute path');
          return true;
        },
      );
    });

    it('throws when the path exists but is a file, not a directory', () => {
      const dir = mkdtempSync(join(tmpdir(), 'ext-'));
      dirsToClean.push(dir);
      const filePath = join(dir, 'extension.zip');
      writeFileSync(filePath, 'not a directory');

      assert.throws(
        () => buildExtensionArgs(filePath),
        (err: Error) => {
          assert.ok(err.message.includes(filePath));
          assert.ok(/not a directory/i.test(err.message));
          return true;
        },
      );
    });

    it('reports the underlying error when stat fails for a reason other than ENOENT', () => {
      // A directory whose parent is not traversable: statSync throws EACCES,
      // not ENOENT. Reporting "does not exist" sends the user off rebuilding a
      // path that is perfectly correct.
      const parent = mkdtempSync(join(tmpdir(), 'ext-noperm-'));
      dirsToClean.push(parent);
      const extDir = join(parent, 'dist');
      mkdirSync(extDir);
      writeFileSync(join(extDir, 'manifest.json'), '{}');
      chmodSync(parent, 0o000);

      try {
        assert.throws(
          () => buildExtensionArgs(extDir),
          (err: Error) => {
            assert.ok(err.message.includes(extDir), 'must name the path');
            assert.ok(/EACCES|permission/i.test(err.message), 'must surface the real stat error');
            assert.doesNotMatch(err.message, /does not exist/i, 'must not claim the path is missing');
            return true;
          },
        );
      } finally {
        chmodSync(parent, 0o700);
      }
    });

    it('throws when the directory has no manifest.json', () => {
      const dir = mkdtempSync(join(tmpdir(), 'ext-no-manifest-'));
      dirsToClean.push(dir);

      assert.throws(
        () => buildExtensionArgs(dir),
        (err: Error) => {
          assert.ok(err.message.includes(dir));
          assert.ok(err.message.includes('manifest.json'), 'must name the missing manifest');
          return true;
        },
      );
    });
  });
});

describe('buildPersistentChromiumArgs', () => {
  it('preserves extension flags, appends caller flags, and enables popup discovery', () => {
    assert.deepEqual(
      buildPersistentChromiumArgs(
        ['--load-extension=/tmp/ext', '--no-first-run'],
        ['--auto-select-screen-capture-source', '--use-fake-ui-for-media-stream'],
      ),
      [
        '--load-extension=/tmp/ext',
        '--no-first-run',
        '--auto-select-screen-capture-source',
        '--use-fake-ui-for-media-stream',
        '--remote-debugging-port=0',
      ],
    );
  });

  it('does not enable a CDP port for a profile-only persistent context', () => {
    assert.deepEqual(
      buildPersistentChromiumArgs([], ['--disable-notifications']),
      ['--disable-notifications'],
    );
  });

  for (const reserved of [
    '--load-extension=/other',
    '--disable-extensions-except=/other',
    '--user-data-dir=/tmp/profile',
    '--remote-debugging-port=9222',
    '--remote-debugging-pipe',
  ]) {
    it(`rejects fixture-owned argument ${reserved}`, () => {
      assert.throws(
        () => buildPersistentChromiumArgs(['--load-extension=/tmp/ext'], [reserved]),
        /launchOptions\.args.*reserved by the Shiplight extension fixture/,
      );
    });
  }
});

describe('buildPersistentLaunchOptions', () => {
  it('preserves standard Playwright launch options while merging args', () => {
    assert.deepEqual(
      buildPersistentLaunchOptions(
        ['--load-extension=/tmp/ext'],
        {
          args: ['--auto-select-screen-capture-source'],
          channel: 'chrome',
          slowMo: 25,
          timeout: 30_000,
        },
      ),
      {
        args: [
          '--load-extension=/tmp/ext',
          '--auto-select-screen-capture-source',
          '--remote-debugging-port=0',
        ],
        channel: 'chrome',
        slowMo: 25,
        timeout: 30_000,
      },
    );
  });
});

/**
 * Regression for the follow-up to issue #2208 — the extension-dir validation
 * was added AFTER the temp profile directory was created, so the new throw
 * escaped before the caller's try/finally cleanup and leaked a full Chrome
 * profile copy on every test that hit the bad path.
 */
describe('prepareExtensionLaunch', () => {
  const dirsToClean: string[] = [];
  afterEach(() => {
    for (const d of dirsToClean) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
    dirsToClean.length = 0;
  });

  /**
   * Names of the `ext-profile-*` directories currently under tmpdir().
   *
   * Compared as a SET difference rather than a count. A count breaks whenever
   * anything else on the machine removes one of these between the two reads —
   * node:test runs test files in parallel processes, and a stray `shiplight`
   * run cleans them up too — which would fail the test for a reason unrelated
   * to what it is checking. A set difference only reacts to directories that
   * genuinely appeared.
   */
  function profileDirs(): Set<string> {
    return new Set(readdirSync(tmpdir()).filter(n => n.startsWith('ext-profile-')));
  }

  /** Directories that appeared since `before` was captured. */
  function dirsAddedSince(before: Set<string>): string[] {
    return [...profileDirs()].filter(name => !before.has(name));
  }

  function makeExtensionDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ext-'));
    dirsToClean.push(dir);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'x', version: '1' }));
    return dir;
  }

  it('creates no profile directory when the extension dir is invalid', () => {
    const before = profileDirs();

    assert.throws(() => prepareExtensionLaunch(
      join(tmpdir(), 'no-such-extension-' + Date.now()),
      './dist',
      undefined,
    ));

    assert.deepEqual(dirsAddedSince(before), [], 'must not leak a temp profile dir on validation failure');
  });

  it('does not copy the base profile when the extension dir is invalid', () => {
    const baseProfile = mkdtempSync(join(tmpdir(), 'base-profile-'));
    dirsToClean.push(baseProfile);
    // A marker unique to this test, so the assertion below identifies OUR copy
    // specifically rather than trusting that nothing else touched tmpdir.
    const marker = `marker-${randomUUID()}`;
    writeFileSync(join(baseProfile, marker), 'data');
    const before = profileDirs();

    assert.throws(() => prepareExtensionLaunch(
      join(tmpdir(), 'no-such-extension-' + Date.now()),
      './dist',
      baseProfile,
    ));

    const added = dirsAddedSince(before);
    for (const name of added) {
      dirsToClean.push(join(tmpdir(), name));
    }
    assert.deepEqual(added, [], 'must not create a temp profile dir before validating');
    assert.ok(
      !added.some(name => existsSync(join(tmpdir(), name, marker))),
      'must not cpSync the base profile before validating',
    );
  });

  it('returns args and a profile dir when the extension dir is valid', () => {
    const extDir = makeExtensionDir();
    const { extensionArgs, resolvedProfileDir } = prepareExtensionLaunch(extDir, './dist', undefined);
    dirsToClean.push(resolvedProfileDir);

    assert.ok(extensionArgs.some(a => a.includes(extDir)));
    assert.ok(existsSync(resolvedProfileDir));
  });

  it('still allocates a profile dir when no extension is configured', () => {
    const { extensionArgs, resolvedProfileDir } = prepareExtensionLaunch(undefined, undefined, undefined);
    dirsToClean.push(resolvedProfileDir);

    assert.deepEqual(extensionArgs, []);
    assert.ok(existsSync(resolvedProfileDir));
  });
});
