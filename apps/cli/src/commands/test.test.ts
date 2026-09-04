import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applyLocatorGenerationDefault,
  buildPlaywrightSpawnOptions,
  buildTestPathsFromGitInfo,
  cloudKeyToCwdRelPath,
  extractConfigArg,
  extractShiplightFlags,
  extractVarOverrideArgs,
  loadVarsFile,
  parseVarsArg,
  postTestUpload,
  preTestDownload,
  resolveProjectRootDir,
  rewriteTestYamlArg,
} from './test.js';
import type { ActionEntityCache } from '../cache/actionEntityCacheStore.js';
import type { ActionEntityStore } from 'shiplight-types';

describe('buildTestPathsFromGitInfo', () => {
  it('should return cwd-relative paths with branch prefix when gitRoot is set', () => {
    const yamlFiles = ['tests/login.test.yaml', 'tests/cart.test.yaml'];
    const cwd = '/repo/examples/project';
    const gitRoot = '/repo';
    const branchPrefix = 'main:';

    const { testPaths, branchPrefix: bp } = buildTestPathsFromGitInfo(yamlFiles, cwd, branchPrefix, gitRoot);

    assert.equal(bp, 'main:');
    assert.deepEqual(testPaths, [
      'main:examples/project/tests/login.test.yaml',
      'main:examples/project/tests/cart.test.yaml',
    ]);
  });

  it('should return raw paths when gitRoot is null', () => {
    const yamlFiles = ['tests/login.test.yaml'];
    const cwd = '/some/dir';

    const { testPaths } = buildTestPathsFromGitInfo(yamlFiles, cwd, 'feat:', null);

    assert.deepEqual(testPaths, ['feat:tests/login.test.yaml']);
  });

  it('should return empty branchPrefix when none provided', () => {
    const yamlFiles = ['tests/login.test.yaml'];
    const cwd = '/repo/project';
    const gitRoot = '/repo';

    const { testPaths, branchPrefix } = buildTestPathsFromGitInfo(yamlFiles, cwd, '', gitRoot);

    assert.equal(branchPrefix, '');
    assert.deepEqual(testPaths, ['project/tests/login.test.yaml']);
  });

  it('should handle cwd at git root', () => {
    const yamlFiles = ['tests/login.test.yaml'];
    const cwd = '/repo';
    const gitRoot = '/repo';

    const { testPaths } = buildTestPathsFromGitInfo(yamlFiles, cwd, 'main:', gitRoot);

    assert.deepEqual(testPaths, ['main:tests/login.test.yaml']);
  });
});

describe('cloudKeyToCwdRelPath', () => {
  it('should strip branch prefix and convert git-root-relative to cwd-relative', () => {
    const result = cloudKeyToCwdRelPath(
      'main:examples/project/tests/login.test.yaml',
      'main:',
      '/repo',
      '/repo/examples/project',
    );

    assert.equal(result, 'tests/login.test.yaml');
  });

  it('should handle no branch prefix', () => {
    const result = cloudKeyToCwdRelPath(
      'examples/project/tests/login.test.yaml',
      '',
      '/repo',
      '/repo/examples/project',
    );

    assert.equal(result, 'tests/login.test.yaml');
  });

  it('should return path as-is when gitRoot is null', () => {
    const result = cloudKeyToCwdRelPath(
      'main:tests/login.test.yaml',
      'main:',
      null,
      '/some/dir',
    );

    assert.equal(result, 'tests/login.test.yaml');
  });

  it('should handle cwd at git root', () => {
    const result = cloudKeyToCwdRelPath(
      'feat/cache:tests/login.test.yaml',
      'feat/cache:',
      '/repo',
      '/repo',
    );

    assert.equal(result, 'tests/login.test.yaml');
  });

  it('should roundtrip with buildTestPathsFromGitInfo', () => {
    const cwd = '/repo/apps/web';
    const gitRoot = '/repo';
    const branchPrefix = 'main:';
    const yamlFiles = ['tests/auth/login.test.yaml'];

    // Build cloud key
    const { testPaths } = buildTestPathsFromGitInfo(yamlFiles, cwd, branchPrefix, gitRoot);
    assert.equal(testPaths[0], 'main:apps/web/tests/auth/login.test.yaml');

    // Convert back to cwd-relative
    const cwdRel = cloudKeyToCwdRelPath(testPaths[0], branchPrefix, gitRoot, cwd);
    assert.equal(cwdRel, 'tests/auth/login.test.yaml');
  });
});

describe('buildPlaywrightSpawnOptions', () => {
  // Regression for: `shiplight test --grep '\[deluxe\]'` running every
  // parameterized case instead of just [deluxe].
  //
  // The user's shell strips the outer single quotes, so the CLI's argv contains
  // the literal 10-char string `\[deluxe\]`. The CLI must forward that string
  // verbatim to Playwright, whose --grep is a JS regex where `\[` and `\]`
  // match literal brackets. If the backslashes get stripped before reaching
  // Playwright, it instead sees `[deluxe]` — a regex character class matching
  // any of d/e/l/u/x — which matches every test name (they all contain at
  // least one of those letters).
  //
  // Skipped on win32 because spawn's `shell: true` invokes cmd.exe there,
  // which doesn't use `\` as an escape character; the bug surfaces only on
  // Unix shells (macOS, Linux, WSL) where /bin/sh consumes the backslashes.
  it(
    'forwards backslash-escaped --grep arg verbatim through spawn',
    { skip: process.platform === 'win32' },
    () => {
      const grepArg = '\\[deluxe\\]';
      const opts = buildPlaywrightSpawnOptions(process.cwd(), process.env);

      // Use a script file (not `-e`) so the JS body — which contains shell
      // metacharacters like `()` — isn't fed through /bin/sh when shell:true
      // joins the argv. We only want to observe how the shell mangles the
      // trailing `\[deluxe\]` user arg, not the test scaffolding.
      const scriptPath = path.join(
        os.tmpdir(),
        `shiplight-echo-argv-${process.pid}.mjs`,
      );
      fs.writeFileSync(scriptPath, 'process.stdout.write(process.argv[2] ?? "")');

      try {
        const result = spawnSync(
          process.execPath,
          [scriptPath, grepArg],
          { ...opts, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' },
        );

        assert.equal(
          result.stdout,
          grepArg,
          `Expected the child to receive '${grepArg}' verbatim but got ` +
            `'${result.stdout}'. The spawn options re-parse the joined command ` +
            `through a shell, which strips the regex-escape backslashes. ` +
            `Playwright then sees '[deluxe]' (regex char class matching d/e/l/u/x) ` +
            `instead of '\\[deluxe\\]' (literal '[deluxe]' substring match), ` +
            `so --grep matches every parameterized case.`,
        );
      } finally {
        fs.unlinkSync(scriptPath);
      }
    },
  );
});

describe('rewriteTestYamlArg', () => {
  it('rewrites .test.yaml to .yaml.spec.ts', () => {
    const result = rewriteTestYamlArg('tests/login.test.yaml', '/project');
    if (process.platform === 'win32') {
      assert.ok(result.startsWith('file:///') || result === 'tests/login.yaml.spec.ts');
    } else {
      assert.equal(result, 'tests/login.yaml.spec.ts');
    }
  });

  it(
    'converts non-ASCII paths to file:// URLs on Windows',
    { skip: process.platform !== 'win32' },
    () => {
      const result = rewriteTestYamlArg('tests/example-中文.test.yaml', 'C:\\work\\project');
      assert.ok(result.startsWith('file:///'), `expected file URL, got: ${result}`);
      assert.ok(result.includes('%'), `expected percent-encoded non-ASCII chars, got: ${result}`);
      assert.ok(result.endsWith('.yaml.spec.ts'), `expected .yaml.spec.ts extension, got: ${result}`);
    },
  );

  it('keeps ASCII paths as regular paths (not URLs) regardless of platform', () => {
    const result = rewriteTestYamlArg('tests/login.test.yaml', '/project');
    assert.ok(!result.startsWith('file:///'), `expected a file path, not a URL: ${result}`);
  });
});

describe('parseVarsArg', () => {
  it('parses a single KEY=VAL pair', () => {
    assert.deepEqual(parseVarsArg('SAUCE_USER=standard_user'), {
      SAUCE_USER: 'standard_user',
    });
  });

  it('parses comma-separated pairs', () => {
    assert.deepEqual(parseVarsArg('A=1,B=2,C=3'), { A: '1', B: '2', C: '3' });
  });

  it('preserves "=" inside the value', () => {
    assert.deepEqual(parseVarsArg('TOKEN=abc=def=ghi'), {
      TOKEN: 'abc=def=ghi',
    });
  });

  it('trims surrounding whitespace from pairs and keys', () => {
    // The pair is trimmed before splitting on `=`, and the key is trimmed
    // again after the split. The value keeps any whitespace adjacent to `=`.
    assert.deepEqual(parseVarsArg(' FOO = bar '), { FOO: ' bar' });
  });

  it('ignores empty segments', () => {
    assert.deepEqual(parseVarsArg('FOO=1,,BAR=2'), { FOO: '1', BAR: '2' });
  });

  it('throws on entries without "="', () => {
    assert.throws(() => parseVarsArg('FOO'), /expected KEY=VALUE/);
  });

  it('throws on empty key', () => {
    assert.throws(() => parseVarsArg('=bar'), /expected KEY=VALUE|empty key/);
  });
});

describe('loadVarsFile', () => {
  it('loads a JSON object of string values', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vars-file-'));
    const filePath = path.join(dir, 'vars.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({ SAUCE_USER: 'standard_user', SAUCE_PASS: 'secret' }),
    );
    try {
      assert.deepEqual(loadVarsFile(filePath, dir), {
        SAUCE_USER: 'standard_user',
        SAUCE_PASS: 'secret',
      });
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('resolves relative paths against cwd', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vars-file-'));
    fs.writeFileSync(path.join(dir, 'vars.json'), JSON.stringify({ X: '1' }));
    try {
      assert.deepEqual(loadVarsFile('vars.json', dir), { X: '1' });
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('throws when the file is missing', () => {
    assert.throws(() => loadVarsFile('/no/such/file.json', '/'), /not found/);
  });

  it('throws when the file is not valid JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vars-file-'));
    const filePath = path.join(dir, 'bad.json');
    fs.writeFileSync(filePath, '{ not json');
    try {
      assert.throws(() => loadVarsFile(filePath, dir), /not valid JSON/);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('throws when the root is not an object', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vars-file-'));
    const filePath = path.join(dir, 'arr.json');
    fs.writeFileSync(filePath, JSON.stringify(['a', 'b']));
    try {
      assert.throws(() => loadVarsFile(filePath, dir), /must be a JSON object/);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('throws when a value is not a string', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vars-file-'));
    const filePath = path.join(dir, 'mixed.json');
    fs.writeFileSync(filePath, JSON.stringify({ FOO: 1 }));
    try {
      assert.throws(() => loadVarsFile(filePath, dir), /must be a string/);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
});

describe('extractVarOverrideArgs', () => {
  it('returns empty extract and unchanged remaining when no flags present', () => {
    const result = extractVarOverrideArgs(['--headed', 'tests/foo.test.yaml'], '/');
    assert.deepEqual(result.extracted, {});
    assert.deepEqual(result.remaining, ['--headed', 'tests/foo.test.yaml']);
  });

  it('strips --vars and its value, leaving other args intact', () => {
    const result = extractVarOverrideArgs(
      ['--headed', '--vars', 'A=1,B=2', '--grep', 'x'],
      '/',
    );
    assert.deepEqual(result.extracted, { A: '1', B: '2' });
    assert.deepEqual(result.remaining, ['--headed', '--grep', 'x']);
  });

  it('supports the --vars=KEY=VAL form', () => {
    const result = extractVarOverrideArgs(['--vars=A=1'], '/');
    assert.deepEqual(result.extracted, { A: '1' });
    assert.deepEqual(result.remaining, []);
  });

  it('merges repeated --vars flags (later wins)', () => {
    const result = extractVarOverrideArgs(
      ['--vars', 'A=1,B=2', '--vars', 'B=overridden,C=3'],
      '/',
    );
    assert.deepEqual(result.extracted, { A: '1', B: 'overridden', C: '3' });
  });

  it('makes --vars win over --vars-file for overlapping keys', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vars-extract-'));
    const filePath = path.join(dir, 'v.json');
    fs.writeFileSync(filePath, JSON.stringify({ A: 'from-file', X: 'only-file' }));
    try {
      const result = extractVarOverrideArgs(
        ['--vars-file', filePath, '--vars', 'A=from-flag'],
        dir,
      );
      assert.deepEqual(result.extracted, { A: 'from-flag', X: 'only-file' });
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('throws when --vars has no value', () => {
    assert.throws(
      () => extractVarOverrideArgs(['--vars'], '/'),
      /requires a value/,
    );
  });

  it('throws when --vars is followed by another flag', () => {
    assert.throws(
      () => extractVarOverrideArgs(['--vars', '--headed'], '/'),
      /requires a value/,
    );
  });

  it('throws when --vars is followed by a single-dash flag', () => {
    // The shared argv walk rejects any `-` prefixed token as a value, not just
    // `--` ones. Before that unification this reached parseVarsArg and failed
    // on the key instead, so the rule is worth pinning explicitly.
    assert.throws(
      () => extractVarOverrideArgs(['--vars', '-K=v'], '/'),
      /requires a value/,
    );
  });
});

describe('extractConfigArg', () => {
  it('returns undefined when no config flag is present', () => {
    assert.equal(extractConfigArg(['--headed', 'tests/a.test.yaml']), undefined);
  });

  it('parses -c <value> and --config <value>', () => {
    assert.equal(extractConfigArg(['-c', 'sub/pw.config.ts']), 'sub/pw.config.ts');
    assert.equal(extractConfigArg(['--config', 'sub/pw.config.ts']), 'sub/pw.config.ts');
  });

  it('parses --config=value, -c=value, and -cvalue forms', () => {
    assert.equal(extractConfigArg(['--config=sub/pw.config.ts']), 'sub/pw.config.ts');
    assert.equal(extractConfigArg(['-c=sub/pw.config.ts']), 'sub/pw.config.ts');
    assert.equal(extractConfigArg(['-csub/pw.config.ts']), 'sub/pw.config.ts');
  });
});

describe('extractShiplightFlags', () => {
  it('reports both flags absent and passes argv through untouched', () => {
    const args = ['--headed', 'tests/a.test.yaml', '--grep', 'login'];
    const { hasMagic, isOffline, remaining } = extractShiplightFlags(args);
    assert.equal(hasMagic, false);
    assert.equal(isOffline, false);
    assert.deepEqual(remaining, args);
  });

  it('strips --offline before Playwright sees it — Playwright rejects unknown options', () => {
    const { isOffline, remaining } = extractShiplightFlags(['--offline', 'tests/a.test.yaml']);
    assert.equal(isOffline, true);
    assert.deepEqual(remaining, ['tests/a.test.yaml']);
  });

  it('strips --magic', () => {
    const { hasMagic, remaining } = extractShiplightFlags(['--magic', '--headed']);
    assert.equal(hasMagic, true);
    assert.deepEqual(remaining, ['--headed']);
  });

  it('strips both, in any position, without disturbing order', () => {
    const { hasMagic, isOffline, remaining } = extractShiplightFlags([
      'tests/a.test.yaml',
      '--offline',
      '--headed',
      '--magic',
      '--workers=2',
    ]);
    assert.equal(hasMagic, true);
    assert.equal(isOffline, true);
    assert.deepEqual(remaining, ['tests/a.test.yaml', '--headed', '--workers=2']);
  });

  it('leaves lookalike arguments alone', () => {
    const { isOffline, remaining } = extractShiplightFlags(['--offline-mode', '--grep', 'offline']);
    assert.equal(isOffline, false);
    assert.deepEqual(remaining, ['--offline-mode', '--grep', 'offline']);
  });
});

describe('resolveProjectRootDir', () => {
  // Mirrors Playwright's resolveConfigLocation: rootDir is the config file's
  // directory, or the directory itself when -c points at a dir; cwd otherwise.
  const dirsToClean: string[] = [];
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-root-'));
    dirsToClean.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirsToClean) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
    dirsToClean.length = 0;
  });

  it('returns cwd unchanged when no -c/--config is given (existing behavior)', () => {
    const cwd = tmp();
    assert.equal(resolveProjectRootDir(['--headed'], cwd), cwd);
  });

  it('returns the config file directory when -c points at a file', () => {
    const root = tmp();
    const sub = path.join(root, 'project');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'playwright.config.ts'), '');
    // -c value is resolved relative to cwd (root); rootDir = dirname(config) = sub
    assert.equal(resolveProjectRootDir(['-c', 'project/playwright.config.ts'], root), sub);
  });

  it('returns the directory itself when -c points at a directory', () => {
    const root = tmp();
    const sub = path.join(root, 'project');
    fs.mkdirSync(sub, { recursive: true });
    assert.equal(resolveProjectRootDir(['--config', 'project'], root), sub);
  });

  it('falls back to cwd when the -c target does not exist', () => {
    const cwd = tmp();
    assert.equal(resolveProjectRootDir(['-c', 'no/such/config.ts'], cwd), cwd);
  });
});

describe('preTestDownload: cache fetch scope', () => {
  const created: string[] = [];
  function repoWithTests(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiplight-scope-'));
    created.push(dir);
    for (const name of ['a.test.yaml', 'b.test.yaml', 'c.test.yaml']) {
      fs.writeFileSync(path.join(dir, name), 'name: x\nsteps: []\n');
    }
    return dir;
  }

  // A local (non-cloud) cache stub that records the paths each lookup requests
  // and returns nothing, so preTestDownload short-circuits before any fs writes.
  function recordingCache(lookups: string[][]): ActionEntityCache {
    return {
      isCloud: false,
      async lookup(testPaths: string[]) {
        lookups.push(testPaths);
        return new Map<string, ActionEntityStore>();
      },
      async update() { return 0; },
      loadAll() { return undefined; },
    };
  }

  afterEach(() => {
    while (created.length) {
      fs.rmSync(created.pop()!, { recursive: true, force: true });
    }
  });

  it('fetches cache ONLY for the requested test file, not the whole repo', async () => {
    // Regression: `shiplight test a.test.yaml` must not download every test's
    // cache. Before the fix, preTestDownload globbed the whole repo and looked up
    // all three; the transpiler only ever consumes the requested file's store.
    const dir = repoWithTests();
    const lookups: string[][] = [];

    await preTestDownload(dir, recordingCache(lookups), ['a.test.yaml']);

    assert.deepEqual(lookups, [['a.test.yaml']]);
  });

  it('fetches cache for exactly the requested files when several are targeted', async () => {
    // `shiplight test a.test.yaml c.test.yaml` → scope must be those two only,
    // never the untargeted b. Guards against a bug that forwarded just the first.
    const dir = repoWithTests();
    const lookups: string[][] = [];

    await preTestDownload(dir, recordingCache(lookups), ['a.test.yaml', 'c.test.yaml']);

    assert.equal(lookups.length, 1);
    assert.deepEqual(lookups[0], ['a.test.yaml', 'c.test.yaml']);
  });

  it('falls back to the whole repo when no specific file was requested', async () => {
    // Bare `shiplight test` / `--grep` → requestedYamlFiles is null → whole repo,
    // matching the transpiler's own fallback.
    const dir = repoWithTests();
    const lookups: string[][] = [];

    await preTestDownload(dir, recordingCache(lookups), null);

    assert.equal(lookups.length, 1);
    assert.deepEqual([...lookups[0]].sort(), ['a.test.yaml', 'b.test.yaml', 'c.test.yaml']);
  });
});

describe('applyLocatorGenerationDefault', () => {
  it('defaults PWDEBUG to console so healed entities get semantic locators', () => {
    // Regression: without PWDEBUG=console Playwright never injects
    // `playwright.generateLocator`, so every entity `shiplight test` writes to
    // the action cache is a positional XPath. Those XPaths keep replaying, so
    // nothing re-heals them and the entry never upgrades.
    const env = applyLocatorGenerationDefault({ PATH: '/usr/bin' });

    assert.equal(env.PWDEBUG, 'console');
  });

  it('leaves an explicit PWDEBUG=1 alone', () => {
    // `PWDEBUG=1 shiplight test` means "open the Inspector". Overwriting it with
    // `console` would silently disable the thing the user asked for.
    const env = applyLocatorGenerationDefault({ PWDEBUG: '1' });

    assert.equal(env.PWDEBUG, '1');
  });

  it('leaves an explicit PWDEBUG=0 alone', () => {
    // The documented opt-out (`--help`): PWDEBUG=console defines a
    // `window.playwright` global on every page, which a site under test can
    // fingerprint. Overriding 0 back to console would remove the only escape.
    const env = applyLocatorGenerationDefault({ PWDEBUG: '0' });

    assert.equal(env.PWDEBUG, '0');
  });

  it('leaves an explicitly emptied PWDEBUG alone', () => {
    // `PWDEBUG=` is the documented opt-out (Playwright's debugMode() treats "" as
    // off). Present-but-empty must not be treated as absent.
    const env = applyLocatorGenerationDefault({ PWDEBUG: '' });

    assert.equal(env.PWDEBUG, '');
  });

  it('mutates and returns the same object, preserving other vars', () => {
    const input: NodeJS.ProcessEnv = { SHIPLIGHT_PROJECT_ROOT: '/repo' };

    const env = applyLocatorGenerationDefault(input);

    assert.equal(env, input);
    assert.equal(env.SHIPLIGHT_PROJECT_ROOT, '/repo');
  });
});

describe('postTestUpload: run scoping', () => {
  const created: string[] = [];

  /** A repo with one YAML test, its generated spec, and an action-cache dir. */
  function repoWithOneTest(): { dir: string; uid: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiplight-upload-'));
    created.push(dir);
    const uid = '7abef884-3592-d14a-bf84-61560f414b0c';
    fs.writeFileSync(path.join(dir, 'a.test.yaml'), 'goal: x\nstatements: []\n');
    fs.writeFileSync(path.join(dir, 'a.yaml.spec.ts'), `// stmtUid: ${uid}\n`);
    return { dir, uid };
  }

  /**
   * Write a healed-entity artifact under `test-results/<subDir>/`, back-dating its
   * mtime so it reads as belonging to a run that started at `writtenAt`.
   */
  function writeRunEntities(dir: string, subDir: string, uid: string, xpath: string, writtenAt: number): void {
    const outDir = path.join(dir, 'test-results', subDir, 'a-spec-showcase');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'new-action-entities.json'),
      JSON.stringify({
        version: '1.0',
        entries: {
          [uid]: {
            action_entity: { xpath, frame_path: [], action_description: 'Click', action_data: { action_name: 'click', kwargs: {} } },
            updated_at: '2026-08-09T21:31:16.000Z',
            updated_by: { source: 'runner', test_run_id: 0 },
          },
        },
      }),
    );
    const file = path.join(outDir, 'new-action-entities.json');
    fs.utimesSync(file, new Date(writtenAt), new Date(writtenAt));
  }

  /** A cache stub that records what update() was handed. */
  function recordingCache(updates: Array<Map<string, ActionEntityStore>>): ActionEntityCache {
    return {
      isCloud: false,
      async lookup() { return new Map<string, ActionEntityStore>(); },
      async update(stores) { updates.push(stores); return stores.size; },
      loadAll() { return undefined; },
    };
  }

  afterEach(() => {
    while (created.length) {
      fs.rmSync(created.pop()!, { recursive: true, force: true });
    }
  });

  const RUN_ID = '2026-08-24T09-27-29-166';
  const STARTED_AT = Date.parse('2026-08-24T09:27:29.166Z');
  const LAST_YEAR = Date.parse('2026-08-09T21:31:16.000Z');

  it('ignores entity files left behind by previous runs', async () => {
    // Regression: `outputDir` is `test-results/<runId>` and is never cleaned, so
    // an unscoped `test-results/**` glob re-saved (and in CI re-upserted) stale
    // entities from months-old runs on every invocation — even runs that healed
    // nothing at all.
    const { dir, uid } = repoWithOneTest();
    writeRunEntities(dir, '2026-08-09T21-30-32-919', uid, 'html/body/old', LAST_YEAR);
    const updates: Array<Map<string, ActionEntityStore>> = [];

    await postTestUpload(dir, recordingCache(updates), { id: RUN_ID, startedAt: STARTED_AT });

    assert.deepEqual(updates, []);
  });

  it('saves the entities this run produced', async () => {
    const { dir, uid } = repoWithOneTest();
    writeRunEntities(dir, '2026-08-09T21-30-32-919', uid, 'html/body/old', LAST_YEAR);
    writeRunEntities(dir, RUN_ID, uid, 'html/body/new', STARTED_AT + 1000);
    const updates: Array<Map<string, ActionEntityStore>> = [];

    await postTestUpload(dir, recordingCache(updates), { id: RUN_ID, startedAt: STARTED_AT });

    assert.equal(updates.length, 1);
    const store = updates[0].get('a.test.yaml');
    assert.ok(store, 'expected a store keyed by the cwd-relative test path');
    assert.equal(store.entries[uid].action_entity.xpath, 'html/body/new');
  });

  it('still finds entities when the config overrode outputDir to test-results itself', async () => {
    // `...shiplightConfig()` followed by an explicit `outputDir`, or
    // `shiplight test --output=…`, puts the artifacts outside
    // `test-results/<runId>`. Scoping alone returned empty and silently stopped
    // writing the cache back for those projects.
    const { dir, uid } = repoWithOneTest();
    writeRunEntities(dir, 'a-spec-showcase-flat', uid, 'html/body/new', STARTED_AT + 1000);
    const updates: Array<Map<string, ActionEntityStore>> = [];

    await postTestUpload(dir, recordingCache(updates), { id: RUN_ID, startedAt: STARTED_AT });

    assert.equal(updates.length, 1);
    assert.equal(updates[0].get('a.test.yaml')?.entries[uid].action_entity.xpath, 'html/body/new');
  });

  it('keeps previous runs out of a pinned run directory', async () => {
    // A caller that exports SHIPLIGHT_RUN_ID itself reuses one directory across
    // runs, so the directory alone proves nothing about which run wrote a file.
    // The mtime stamp — not the path — is the correctness guarantee.
    const { dir, uid } = repoWithOneTest();
    writeRunEntities(dir, RUN_ID, uid, 'html/body/old', LAST_YEAR);
    const updates: Array<Map<string, ActionEntityStore>> = [];

    await postTestUpload(dir, recordingCache(updates), { id: RUN_ID, startedAt: STARTED_AT });

    assert.deepEqual(updates, []);
  });
});
