import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseYamlTestFile } from './yamlParser.js';
import { transpileYamlTest, transpileYamlSuite } from './yaml-transpiler/index.js';
import { TRANSPILER_CACHE_KEY } from './transpiler/version.js';

// Call the transpiler exactly as production does — the real function plus the
// version injection — instead of through a convenience wrapper that no shipping
// code path used. A wrapper-only test cannot catch a change to how the CLI
// actually stamps a spec.
const transpileTestFlow: typeof transpileYamlTest = (flow, options) =>
  transpileYamlTest(flow, { ...options, version: TRANSPILER_CACHE_KEY });
const transpileSuiteFile: typeof transpileYamlSuite = (suite, options) =>
  transpileYamlSuite(suite, { ...options, version: TRANSPILER_CACHE_KEY });
import { getRequestedYamlFiles, transpileAllYamlTests } from './transpile.js';
import {
  hasRunCacheMetadata,
  runCacheCollector,
  __resetRunCacheCollector,
} from './cache/runCacheMetadata.js';
import type { ActionEntityStore } from 'shiplight-types';

describe('transpile: execution control annotations', () => {
  it('should emit test.skip(true, reason) for skip string', () => {
    const parsed = parseYamlTestFile(`
skip: "Needs locator fixes"
goal: My test
statements:
  - URL: /
`);
    const code = transpileTestFlow(parsed.testFlow!, {
      skip: parsed.skip,
    });
    assert.ok(code.includes("test.skip(true, 'Needs locator fixes')"), 'skip with reason not found');
  });

  it('should emit test.skip() for skip: true', () => {
    const parsed = parseYamlTestFile(`
skip: true
goal: My test
statements:
  - URL: /
`);
    const code = transpileTestFlow(parsed.testFlow!, {
      skip: parsed.skip,
    });
    assert.ok(code.includes('test.skip()'), 'skip() not found');
  });

  it('should emit test.fail(true, reason) for fail string', () => {
    const parsed = parseYamlTestFile(`
fail: "Known bug #123"
goal: My test
statements:
  - URL: /
`);
    const code = transpileTestFlow(parsed.testFlow!, {
      fail: parsed.fail,
    });
    assert.ok(code.includes("test.fail(true, 'Known bug #123')"), 'fail with reason not found');
  });

  it('should emit test.only for only: true', () => {
    const parsed = parseYamlTestFile(`
only: true
goal: My test
statements:
  - URL: /
`);
    const code = transpileTestFlow(parsed.testFlow!, {
      only: parsed.only,
    });
    assert.ok(code.includes('test.only('), 'test.only not found');
  });

  it('should emit test.slow() for slow: true', () => {
    const parsed = parseYamlTestFile(`
slow: true
goal: My test
statements:
  - URL: /
`);
    const code = transpileTestFlow(parsed.testFlow!, {
      slow: parsed.slow,
    });
    assert.ok(code.includes('test.slow()'), 'slow() not found');
  });

  it('should emit test.setTimeout for timeout', () => {
    const parsed = parseYamlTestFile(`
timeout: 60000
goal: My test
statements:
  - URL: /
`);
    const code = transpileTestFlow(parsed.testFlow!, {
      timeout: parsed.timeout,
    });
    assert.ok(code.includes('test.setTimeout(60000)'), 'setTimeout not found');
  });

  it('should not emit annotations when none are set', () => {
    const parsed = parseYamlTestFile(`
goal: My test
statements:
  - URL: /
`);
    const code = transpileTestFlow(parsed.testFlow!, {});
    assert.ok(!code.includes('test.skip'), 'unexpected skip');
    assert.ok(!code.includes('test.fail'), 'unexpected fail');
    assert.ok(!code.includes('test.slow'), 'unexpected slow');
    assert.ok(!code.includes('test.setTimeout'), 'unexpected setTimeout');
    assert.ok(!code.includes('test.only'), 'unexpected only');
  });

  it('should emit skip in suite tests', () => {
    const parsed = parseYamlTestFile(`
suite:
  tests:
    - name: Skipped test
      skip: "Not ready"
      statements:
        - URL: /
    - name: Normal test
      statements:
        - URL: /
`);
    const code = transpileSuiteFile(parsed.suite!, {});
    assert.ok(code.includes("test.skip(true, 'Not ready')"), 'suite skip not found');
    assert.ok(code.includes("'Normal test'"), 'normal test not found');
  });
});

const VALID_YAML = `goal: Test login\nstatements:\n  - URL: /\n`;
const BROKEN_YAML = `goal: Broken\nstatements:\n  - js: "await expect(page.getByText("bad")).toBeVisible()"\n`;

describe('getRequestedYamlFiles', () => {
  let tmpDir: string;
  let originalArgv: string[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'shiplight-test-'));
    originalArgv = process.argv;
    writeFileSync(join(tmpDir, 'a.test.yaml'), VALID_YAML);
    writeFileSync(join(tmpDir, 'b.test.yaml'), VALID_YAML);
  });

  afterEach(() => {
    process.argv = originalArgv;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no yaml files in argv', () => {
    process.argv = ['node', 'playwright', 'test', '--headed'];
    assert.equal(getRequestedYamlFiles(tmpDir), null);
  });

  it('returns matching .test.yaml file from argv', () => {
    process.argv = ['node', 'playwright', 'test', 'a.test.yaml'];
    const result = getRequestedYamlFiles(tmpDir);
    assert.deepEqual(result, ['a.test.yaml']);
  });

  it('converts .yaml.spec.ts arg to .test.yaml', () => {
    process.argv = ['node', 'playwright', 'test', 'b.yaml.spec.ts'];
    // b.yaml.spec.ts maps to b.test.yaml which exists
    const result = getRequestedYamlFiles(tmpDir);
    assert.deepEqual(result, ['b.test.yaml']);
  });

  it('skips flags and non-yaml args', () => {
    process.argv = ['node', 'playwright', 'test', '--project=web', 'a.test.yaml', '--headed'];
    const result = getRequestedYamlFiles(tmpDir);
    assert.deepEqual(result, ['a.test.yaml']);
  });

  it('ignores nonexistent files', () => {
    process.argv = ['node', 'playwright', 'test', 'nonexistent.test.yaml'];
    assert.equal(getRequestedYamlFiles(tmpDir), null);
  });

  it('uses an explicit argv when provided instead of process.argv', () => {
    // The CLI orchestrator passes its own resolved args so the pre-test cache
    // download scopes to the same files this run transpiles (commands/test.ts).
    process.argv = ['node', 'playwright', 'test', 'a.test.yaml'];
    const result = getRequestedYamlFiles(tmpDir, ['--project=web', 'b.yaml.spec.ts', '--headed']);
    assert.deepEqual(result, ['b.test.yaml']);
  });
});

describe('transpileAllYamlTests: scoped transpilation', () => {
  let tmpDir: string;
  let originalArgv: string[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'shiplight-test-'));
    originalArgv = process.argv;
    writeFileSync(join(tmpDir, 'good.test.yaml'), VALID_YAML);
    writeFileSync(join(tmpDir, 'broken.test.yaml'), BROKEN_YAML);
  });

  afterEach(() => {
    process.argv = originalArgv;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('transpiles only the requested file, skipping broken ones', () => {
    process.argv = ['node', 'playwright', 'test', 'good.test.yaml'];
    transpileAllYamlTests({ cwd: tmpDir });
    assert.ok(existsSync(join(tmpDir, 'good.yaml.spec.ts')), 'good spec should exist');
    assert.ok(!existsSync(join(tmpDir, 'broken.yaml.spec.ts')), 'broken spec should not exist');
  });

  it('transpiles all files when no specific file in argv, skipping broken ones', () => {
    process.argv = ['node', 'playwright', 'test', '--headed'];
    transpileAllYamlTests({ cwd: tmpDir });
    assert.ok(existsSync(join(tmpDir, 'good.yaml.spec.ts')), 'good spec should exist');
    assert.ok(!existsSync(join(tmpDir, 'broken.yaml.spec.ts')), 'broken spec should not exist');
  });

  it('does not throw during global scan when a file fails transpilation', () => {
    process.argv = ['node', 'playwright', 'test'];
    assert.doesNotThrow(() => transpileAllYamlTests({ cwd: tmpDir }));
  });

  it('throws when a specifically-requested file fails transpilation', () => {
    process.argv = ['node', 'playwright', 'test', 'broken.test.yaml'];
    assert.throws(() => transpileAllYamlTests({ cwd: tmpDir }), /Transpilation failed/);
  });
});

describe('transpileAllYamlTests: cache measurement', () => {
  let tmpDir: string;
  let originalArgv: string[];

  const ACTION_YAML = `goal: Login
statements:
  - intent: Click login
    action: click
    locator: "getByRole('button', { name: 'Login' })"
`;

  /** An empty-but-present store map: the cache feature is on, nothing cached yet. */
  const emptyStores = () => new Map<string, ActionEntityStore>();

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'shiplight-cachemeta-'));
    originalArgv = process.argv;
    process.argv = ['node', 'playwright', 'test'];
    __resetRunCacheCollector();
  });

  afterEach(() => {
    process.argv = originalArgv;
    rmSync(tmpDir, { recursive: true, force: true });
    __resetRunCacheCollector();
  });

  it('reports nothing when the run has no action-entity cache', () => {
    writeFileSync(join(tmpDir, 'a.test.yaml'), ACTION_YAML);
    transpileAllYamlTests({ cwd: tmpDir });

    // The transpiler still ran; there is simply nothing to say about a cache
    // the user never enabled.
    assert.ok(existsSync(join(tmpDir, 'a.yaml.spec.ts')));
    assert.equal(hasRunCacheMetadata(), false);
  });

  it('measures every file, not just the stale ones, once a cache is in play', () => {
    writeFileSync(join(tmpDir, 'a.test.yaml'), ACTION_YAML);
    writeFileSync(join(tmpDir, 'b.test.yaml'), ACTION_YAML);

    // First pass writes both specs, so a second pass would find them up to date.
    transpileAllYamlTests({ cwd: tmpDir, actionEntityStores: emptyStores() });
    const first = runCacheCollector().getSummary().total_statements;
    assert.equal(first, 2);

    __resetRunCacheCollector();
    transpileAllYamlTests({ cwd: tmpDir, actionEntityStores: emptyStores() });

    // The mtime skip must not silently shrink the denominator: a summary over
    // whichever files happened to be stale reads as a measurement of the run.
    assert.equal(hasRunCacheMetadata(), true);
    assert.equal(runCacheCollector().getSummary().total_statements, 2);
  });

  it('keeps the mtime skip when no cache is in play', () => {
    writeFileSync(join(tmpDir, 'a.test.yaml'), ACTION_YAML);
    transpileAllYamlTests({ cwd: tmpDir });
    const specPath = join(tmpDir, 'a.yaml.spec.ts');

    // A sentinel appended after the first pass survives only if the second pass
    // really skipped the file — mtime alone would be an unreliable witness at
    // this timescale.
    const sentinel = `${readFileSync(specPath, 'utf-8')}\n// sentinel\n`;
    writeFileSync(specPath, sentinel);

    transpileAllYamlTests({ cwd: tmpDir });
    assert.equal(readFileSync(specPath, 'utf-8'), sentinel, 'up-to-date spec should not be rewritten');
  });

  it('starts clean on each pass, so a second run in one process is not additive', () => {
    // Playwright watch/UI mode re-evaluates the config in the SAME process.
    writeFileSync(join(tmpDir, 'a.test.yaml'), ACTION_YAML);
    transpileAllYamlTests({ cwd: tmpDir, actionEntityStores: emptyStores() });
    transpileAllYamlTests({ cwd: tmpDir, actionEntityStores: emptyStores() });

    assert.equal(runCacheCollector().getSummary().total_statements, 1);
  });

  it('discards the whole summary when a file fails to transpile', () => {
    // The failed file still RUNS — from whatever stale spec a previous pass
    // left behind — so its statements are unobservable, and a rate over the
    // rest would look measured while covering an unknown fraction of the run.
    writeFileSync(join(tmpDir, 'a.test.yaml'), ACTION_YAML);
    writeFileSync(join(tmpDir, 'broken.test.yaml'), BROKEN_YAML);

    transpileAllYamlTests({ cwd: tmpDir, actionEntityStores: emptyStores() });
    assert.equal(hasRunCacheMetadata(), false);
  });

  it('does not record statements from a file whose spec was never written', () => {
    writeFileSync(join(tmpDir, 'broken.test.yaml'), BROKEN_YAML.replace(
      'statements:',
      `statements:
  - intent: Click login
    action: click
    locator: "getByRole('button', { name: 'Login' })"`,
    ));

    transpileAllYamlTests({ cwd: tmpDir, actionEntityStores: emptyStores() });

    // The observer fires while walking actions, but the syntax check and the
    // write happen afterwards — so the walk must not be committed until the
    // spec that embeds those entities actually exists.
    assert.ok(!existsSync(join(tmpDir, 'broken.yaml.spec.ts')));
    assert.equal(runCacheCollector().getSummary().total_statements, 0);
  });
});

describe('transpileAllYamlTests: inline fingerprint map location', () => {
  let scanDir: string;
  let projectRoot: string;
  let originalArgv: string[];

  const ACTION_YAML = `goal: Login
statements:
  - intent: Click login
    action: click
    locator: "getByRole('button', { name: 'Login' })"
`;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'shiplight-fproot-'));
    scanDir = join(projectRoot, 'e2e');
    mkdirSync(scanDir, { recursive: true });
    originalArgv = process.argv;
    process.argv = ['node', 'playwright', 'test'];
    __resetRunCacheCollector();
  });

  afterEach(() => {
    process.argv = originalArgv;
    rmSync(projectRoot, { recursive: true, force: true });
    __resetRunCacheCollector();
  });

  it('writes the map where the post-run write-back reads it, not under scanDir', () => {
    // `shiplightConfig` passes `cwd: scanDir`, which an explicit `scanDir` option narrows
    // to a subfolder, while `postTestUpload` reads from projectRoot. Anchoring the map to
    // cwd would leave every healed entry unstamped — and therefore grandfathered — for
    // exactly the projects that configure a scanDir.
    writeFileSync(join(scanDir, 'a.test.yaml'), ACTION_YAML);
    transpileAllYamlTests({ cwd: scanDir, projectRoot });

    assert.ok(
      existsSync(join(projectRoot, '.shiplight', 'inline-fingerprints.json')),
      'the map must land at projectRoot, where the write-back looks',
    );
    assert.ok(
      !existsSync(join(scanDir, '.shiplight', 'inline-fingerprints.json')),
      'the map must not be stranded under scanDir',
    );
  });

  it('falls back to cwd when no projectRoot is given', () => {
    writeFileSync(join(scanDir, 'a.test.yaml'), ACTION_YAML);
    transpileAllYamlTests({ cwd: scanDir });

    assert.ok(existsSync(join(scanDir, '.shiplight', 'inline-fingerprints.json')));
  });
});
