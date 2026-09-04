import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test the merge logic by invoking the CLI entry point as a subprocess
// so we get real end-to-end coverage including arg parsing.
import { execFileSync } from 'node:child_process';

import { buildGitHubSummary, extractTriggerOption, isReportToCloudEnabled } from './report.js';
import type { ReportTest } from '../reporter/template.js';

const CLI_PATH = join(import.meta.dirname, '..', '..', 'dist', 'cli.js');
const cliExists = existsSync(CLI_PATH);

// These suites invoke the built CLI as a subprocess. When dist/cli.js is not
// built (e.g. CI runs test:unit without building the package), skip the whole
// suite at the describe level — a per-test t.skip() does NOT halt the body, so
// the spawn would still run and fail with "Cannot find module dist/cli.js".
const skipNoBuild = cliExists
  ? false
  : ('dist/cli.js not found — run pnpm build first' as const);

function makeShardReport(dir: string, data: object) {
  const reportDir = join(dir, 'shiplight-report');
  mkdirSync(join(reportDir, 'screenshots', 'test-0'), { recursive: true });
  writeFileSync(join(reportDir, 'report-data.json'), JSON.stringify(data), 'utf-8');
  // Create a dummy screenshot
  writeFileSync(join(reportDir, 'screenshots', 'test-0', 'main-0.png'), 'fake-png');
  return reportDir;
}

function runCli(...args: string[]): string {
  return execFileSync('node', [CLI_PATH, ...args], { encoding: 'utf-8', timeout: 10000 });
}

describe('report --merge', { skip: skipNoBuild }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'report-merge-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('merges two shard reports into one', () => {
    const shard1Dir = join(tmpDir, 'shard-1');
    const shard2Dir = join(tmpDir, 'shard-2');

    const shard1Report = makeShardReport(shard1Dir, {
      tests: [
        { title: 'Test A', file: 'a.yaml.spec.ts', status: 'passed', duration: 3000, steps: [
          { stepId: 'main.0', description: 'Step A', status: 'success', screenshot: 'screenshots/test-0/main-0.png' },
        ] },
      ],
      totalDuration: 3000,
      timestamp: '2026-01-01T00:00:00Z',
    });

    const shard2Report = makeShardReport(shard2Dir, {
      tests: [
        { title: 'Test B', file: 'b.yaml.spec.ts', status: 'failed', duration: 5000, steps: [
          { stepId: 'main.0', description: 'Step B', status: 'failure', error: 'timeout', screenshot: 'screenshots/test-0/main-0.png' },
        ] },
      ],
      totalDuration: 5000,
      timestamp: '2026-01-01T00:00:00Z',
    });

    const outputDir = join(tmpDir, 'output');
    const stdout = runCli('report', '--merge', shard1Report, shard2Report, '-o', outputDir);

    assert.match(stdout, /Merged 2 tests from 2 shards/);

    // Check output files exist
    assert.ok(existsSync(join(outputDir, 'index.html')), 'index.html should exist');
    assert.ok(existsSync(join(outputDir, 'report-data.json')), 'report-data.json should exist');

    // Check merged data
    const merged = JSON.parse(readFileSync(join(outputDir, 'report-data.json'), 'utf-8'));
    assert.equal(merged.tests.length, 2);
    assert.equal(merged.totalDuration, 8000);
    assert.equal(merged.tests[0].title, 'Test A');
    assert.equal(merged.tests[1].title, 'Test B');

    // Check screenshot paths are rewritten with shard prefix
    assert.equal(merged.tests[0].steps[0].screenshot, 'screenshots/shard-0/test-0/main-0.png');
    assert.equal(merged.tests[1].steps[0].screenshot, 'screenshots/shard-1/test-0/main-0.png');

    // Check screenshot files were copied
    assert.ok(existsSync(join(outputDir, 'screenshots', 'shard-0', 'test-0', 'main-0.png')));
    assert.ok(existsSync(join(outputDir, 'screenshots', 'shard-1', 'test-0', 'main-0.png')));
  });

  it('carries the action-entity cache summary through the merge', () => {
    // The merged report is the ONLY artifact a sharded CI run uploads, and it is
    // rebuilt from an explicit field list — so a field that is not copied there
    // is silently dropped for exactly the runs the cache feature exists to
    // serve. Asserted end-to-end through the built CLI, because the drop
    // happened in the wiring, not in the merge arithmetic.
    const shardTest = (title: string) => ({
      title,
      file: `${title}.yaml.spec.ts`,
      status: 'passed',
      duration: 1000,
      steps: [{ stepId: 'main.0', description: 'Step', status: 'success' }],
    });

    // Same corpus in both shards (every shard transpiles every file; --shard
    // splits execution only), with healing disjoint across them.
    const shard1 = makeShardReport(join(tmpDir, 'c-shard-1'), {
      tests: [shardTest('A')],
      totalDuration: 1000,
      timestamp: '2026-01-01T00:00:00Z',
      cacheSummary: { total_statements: 10, original: 4, cache_hits: 5, healed: 1, healed_from_cache: 1, failed: 0 },
    });
    const shard2 = makeShardReport(join(tmpDir, 'c-shard-2'), {
      tests: [shardTest('B')],
      totalDuration: 1000,
      timestamp: '2026-01-01T00:00:00Z',
      cacheSummary: { total_statements: 10, original: 3, cache_hits: 5, healed: 2, healed_from_cache: 1, failed: 0 },
    });

    const outputDir = join(tmpDir, 'c-merged');
    runCli('report', '--merge', shard1, shard2, '-o', outputDir);

    const merged = JSON.parse(readFileSync(join(outputDir, 'report-data.json'), 'utf-8'));
    assert.ok(merged.cacheSummary, 'merged report must carry a cache summary');
    // Not 20: summing would multiply the corpus by the shard count.
    assert.equal(merged.cacheSummary.total_statements, 10);
    assert.equal(merged.cacheSummary.healed, 3);
    assert.equal(
      merged.cacheSummary.original + merged.cacheSummary.cache_hits +
        merged.cacheSummary.healed + merged.cacheSummary.failed,
      10,
      'buckets must still account for every statement exactly once',
    );
  });

  it('omits the cache summary when no shard measured one', () => {
    // Omission is what makes the platform store NULL ("not reported") rather
    // than a 0% hit rate it never observed.
    const shard = makeShardReport(join(tmpDir, 'n-shard'), {
      tests: [{ title: 'A', file: 'a.yaml.spec.ts', status: 'passed', duration: 1, steps: [] }],
      totalDuration: 1,
      timestamp: '2026-01-01T00:00:00Z',
    });
    const outputDir = join(tmpDir, 'n-merged');
    runCli('report', '--merge', shard, '-o', outputDir);

    const merged = JSON.parse(readFileSync(join(outputDir, 'report-data.json'), 'utf-8'));
    assert.equal('cacheSummary' in merged, false);
  });

  it('copies trace and video files with shard prefix', () => {
    const shardDir = join(tmpDir, 'shard-with-artifacts');
    const reportDir = makeShardReport(shardDir, {
      tests: [
        { title: 'Test C', file: 'c.yaml.spec.ts', status: 'passed', duration: 2000, steps: [],
          tracePath: 'trace.zip', videoPath: 'video.webm' },
      ],
      totalDuration: 2000,
    });

    // Create dummy trace and video
    writeFileSync(join(reportDir, 'trace.zip'), 'fake-trace');
    writeFileSync(join(reportDir, 'video.webm'), 'fake-video');

    const outputDir = join(tmpDir, 'output-artifacts');
    runCli('report', '--merge', reportDir, '-o', outputDir);

    const merged = JSON.parse(readFileSync(join(outputDir, 'report-data.json'), 'utf-8'));
    assert.equal(merged.tests[0].tracePath, 'shard-0/trace.zip');
    assert.equal(merged.tests[0].videoPath, 'shard-0/video.webm');

    assert.ok(existsSync(join(outputDir, 'shard-0', 'trace.zip')));
    assert.ok(existsSync(join(outputDir, 'shard-0', 'video.webm')));
  });

  it('carries the changed-only snapshots through the merge unaltered', () => {
    // The merge is what crashed on the run that started FR-024, and it is the
    // only artifact a sharded CI run uploads. It must pass the recorded form
    // through: re-encoding it against a fresh state, or dropping fields it does
    // not know, would ship steps whose variables decode wrong or not at all.
    const shardDir = join(tmpDir, 'delta-shard');
    mkdirSync(shardDir, { recursive: true });
    const shardReport = makeShardReport(shardDir, {
      tests: [
        {
          title: 'Delta test',
          file: 'd.yaml.spec.ts',
          status: 'passed',
          duration: 10,
          steps: [
            {
              stepId: 'main.0',
              description: 'Open',
              status: 'success',
              contextBeforeDelta: { set: { user: 'a@example.com', env: 'beta' } },
              contextAfterDelta: {},
            },
            {
              stepId: 'main.1',
              description: 'Export',
              status: 'success',
              contextBeforeDelta: {},
              contextAfterDelta: { set: { fileId: 42 }, removed: ['env'] },
            },
          ],
        },
      ],
      totalDuration: 10,
      timestamp: '2026-01-01T00:00:00Z',
    });

    const outputDir = join(tmpDir, 'delta-output');
    runCli('report', '--merge', shardReport, '-o', outputDir);

    const merged = JSON.parse(readFileSync(join(outputDir, 'report-data.json'), 'utf-8'));
    const steps = merged.tests[0].steps;
    assert.deepEqual(steps[0].contextBeforeDelta, { set: { user: 'a@example.com', env: 'beta' } });
    assert.deepEqual(steps[0].contextAfterDelta, {});
    assert.deepEqual(steps[1].contextAfterDelta, { set: { fileId: 42 }, removed: ['env'] });
    assert.equal('contextBefore' in steps[1], false, 'the merge must not re-expand the form');
  });

  it('skips directories without report-data.json', () => {
    const goodDir = join(tmpDir, 'good');
    const emptyDir = join(tmpDir, 'empty', 'shiplight-report');
    mkdirSync(emptyDir, { recursive: true });

    makeShardReport(goodDir, {
      tests: [
        { title: 'Test D', file: 'd.yaml.spec.ts', status: 'passed', duration: 1000, steps: [] },
      ],
      totalDuration: 1000,
    });

    const outputDir = join(tmpDir, 'output-skip');
    const result = execFileSync('node', [CLI_PATH, 'report', '--merge',
      join(goodDir, 'shiplight-report'), emptyDir, '-o', outputDir],
      { encoding: 'utf-8', timeout: 10000 },
    );

    // Warning goes to stderr, but merge should still succeed with the valid shard
    assert.match(result, /Merged 1 tests from 1 shards/);
  });

  it('defaults output to shiplight-report in cwd', () => {
    const shardDir = join(tmpDir, 'shard');
    const reportDir = makeShardReport(shardDir, {
      tests: [
        { title: 'Test E', file: 'e.yaml.spec.ts', status: 'passed', duration: 1000, steps: [] },
      ],
      totalDuration: 1000,
    });

    const stdout = execFileSync('node', [CLI_PATH, 'report', '--merge', reportDir], {
      encoding: 'utf-8',
      cwd: tmpDir,
      timeout: 10000,
    });

    assert.ok(existsSync(join(tmpDir, 'shiplight-report', 'index.html')));
  });

  it('exits with error when no input directories provided', () => {
    assert.throws(
      () => runCli('report', '--merge'),
      (err: any) => err.status !== 0,
    );
  });

  it('exits with error when no tests found across all shards', () => {
    const emptyDir = join(tmpDir, 'empty-shard', 'shiplight-report');
    mkdirSync(emptyDir, { recursive: true });

    assert.throws(
      () => runCli('report', '--merge', emptyDir),
      (err: any) => err.status !== 0,
    );
  });
});

describe('report (single)', { skip: skipNoBuild }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'report-single-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('regenerates index.html from report-data.json', () => {
    const reportDir = join(tmpDir, 'shiplight-report');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'report-data.json'), JSON.stringify({
      tests: [
        { title: 'Test F', file: 'f.yaml.spec.ts', status: 'passed', duration: 1000, steps: [] },
      ],
      totalDuration: 1000,
      timestamp: '2026-01-01T00:00:00Z',
    }), 'utf-8');

    const stdout = runCli('report', reportDir);

    assert.match(stdout, /report regenerated/);
    assert.ok(existsSync(join(reportDir, 'index.html')));

    const html = readFileSync(join(reportDir, 'index.html'), 'utf-8');
    assert.ok(html.includes('Test F'));
    assert.ok(html.includes('passed'));
  });

  it('exits with error when report-data.json is missing', () => {
    const emptyDir = join(tmpDir, 'no-report');
    mkdirSync(emptyDir, { recursive: true });

    assert.throws(
      () => runCli('report', emptyDir),
      (err: any) => err.status !== 0,
    );
  });
});

function makeTest(overrides: Partial<ReportTest>): ReportTest {
  return {
    title: 'Some test',
    file: 'tests/example.yaml.spec.ts',
    status: 'passed',
    duration: 1000,
    steps: [],
    ...overrides,
  };
}

describe('buildGitHubSummary', () => {
  it('renders all-passed state without Failed/Flaky sections', () => {
    const out = buildGitHubSummary([
      makeTest({ title: 'T1', file: 'tests/a.yaml.spec.ts', status: 'passed' }),
      makeTest({ title: 'T2', file: 'tests/b.yaml.spec.ts', status: 'passed' }),
    ]);
    assert.ok(out.includes('✅ All 2 tests passed'));
    assert.ok(!out.includes('### Failed'));
    assert.ok(!out.includes('### Flaky'));
    assert.ok(out.includes('<details><summary>Passed (2)</summary>'));
    assert.ok(out.includes('- tests/a.test.yaml'));
    assert.ok(out.includes('- tests/b.test.yaml'));
  });

  it('renders failed tests as commands with a combined run-all block', () => {
    const out = buildGitHubSummary([
      makeTest({ title: 'A goal\nwith multiple lines', file: 'tests/a.yaml.spec.ts', status: 'failed' }),
      makeTest({ title: 'Another one', file: 'tests/b.yaml.spec.ts', status: 'timedOut' }),
      makeTest({ title: 'Passing', file: 'tests/c.yaml.spec.ts', status: 'passed' }),
    ]);

    assert.ok(out.includes('❌ 2 failed, ⚠️ 0 flaky, ✅ 1 passed / 3 total'));

    // Per-test commands — one per line, no test titles/steps
    assert.ok(out.includes('- `npx shiplight test tests/a.test.yaml`'));
    assert.ok(out.includes('- `npx shiplight test tests/b.test.yaml`'));

    // Titles (which can be multi-line YAML goals) must not appear — that was the bug
    assert.ok(!out.includes('A goal'));
    assert.ok(!out.includes('with multiple lines'));

    // Single combined command for re-running all failed tests, paths quoted
    assert.ok(out.includes('**Run all failed tests**'));
    assert.ok(out.includes('```sh'));
    assert.ok(out.includes('npx shiplight test "tests/a.test.yaml" \\\n  "tests/b.test.yaml"'));
  });

  it('dedupes failed paths when the same file fails multiple times', () => {
    const out = buildGitHubSummary([
      makeTest({ title: 'Retry 1', file: 'tests/a.yaml.spec.ts', status: 'failed' }),
      makeTest({ title: 'Retry 2', file: 'tests/a.yaml.spec.ts', status: 'failed' }),
    ]);
    const occurrences = out.match(/- `npx shiplight test tests\/a\.test\.yaml`/g) ?? [];
    assert.equal(occurrences.length, 1);
  });

  it('filters out auth.setup infrastructure tests', () => {
    const out = buildGitHubSummary([
      makeTest({ title: 'auth', file: 'tests/auth.setup.ts', status: 'passed' }),
      makeTest({ title: 'real', file: 'tests/real.yaml.spec.ts', status: 'passed' }),
    ]);
    assert.ok(out.includes('✅ All 1 tests passed'));
    assert.ok(!out.includes('auth.setup'));
  });

  it('renders flaky section with retry-safe dedup', () => {
    const out = buildGitHubSummary([
      makeTest({ title: 'F', file: 'tests/flaky.yaml.spec.ts', status: 'passed', flaky: true, retries: 2 }),
      makeTest({ title: 'P', file: 'tests/p.yaml.spec.ts', status: 'passed' }),
    ]);
    assert.ok(out.includes('✅ 1 passed, ⚠️ 1 flaky / 2 total'));
    assert.ok(out.includes('### Flaky (1)'));
    assert.ok(out.includes('- `tests/flaky.test.yaml`'));
  });

  it('matches the expected snapshot for a mixed run', () => {
    const out = buildGitHubSummary([
      makeTest({ title: 'p1', file: 'tests/pass-one.yaml.spec.ts', status: 'passed' }),
      makeTest({ title: 'f1', file: 'tests/fail-one.yaml.spec.ts', status: 'failed' }),
      makeTest({ title: 'fl', file: 'tests/flaky-one.yaml.spec.ts', status: 'passed', flaky: true, retries: 1 }),
    ]);

    const expected = [
      '## Test Results',
      '',
      '❌ 1 failed, ⚠️ 1 flaky, ✅ 1 passed / 3 total',
      '',
      '### Failed',
      '',
      '- `npx shiplight test tests/fail-one.test.yaml`',
      '',
      '**Run all failed tests**',
      '',
      '```sh',
      'npx shiplight test "tests/fail-one.test.yaml"',
      '```',
      '',
      '### Flaky (1)',
      '',
      '- `tests/flaky-one.test.yaml`',
      '',
      '<details><summary>Passed (1)</summary>',
      '',
      '- tests/pass-one.test.yaml',
      '',
      '</details>',
      '',
    ].join('\n');

    assert.equal(out, expected);
  });
});

describe('isReportToCloudEnabled', () => {
  const { SHIPLIGHT_REPORT_TO_CLOUD, REPORT_TO_CLOUD } = process.env;

  afterEach(() => {
    // Restore the original env so tests don't leak into one another.
    restoreEnv('SHIPLIGHT_REPORT_TO_CLOUD', SHIPLIGHT_REPORT_TO_CLOUD);
    restoreEnv('REPORT_TO_CLOUD', REPORT_TO_CLOUD);
  });

  function restoreEnv(key: string, value: string | undefined) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it('returns false when neither var is set', () => {
    delete process.env.SHIPLIGHT_REPORT_TO_CLOUD;
    delete process.env.REPORT_TO_CLOUD;
    assert.equal(isReportToCloudEnabled(), false);
  });

  for (const v of ['true', '1', 'yes', 'on', 'TRUE', ' Yes ']) {
    it(`treats SHIPLIGHT_REPORT_TO_CLOUD=${JSON.stringify(v)} as enabled`, () => {
      delete process.env.REPORT_TO_CLOUD;
      process.env.SHIPLIGHT_REPORT_TO_CLOUD = v;
      assert.equal(isReportToCloudEnabled(), true);
    });
  }

  for (const v of ['false', '0', 'no', '']) {
    it(`treats SHIPLIGHT_REPORT_TO_CLOUD=${JSON.stringify(v)} as disabled`, () => {
      delete process.env.REPORT_TO_CLOUD;
      process.env.SHIPLIGHT_REPORT_TO_CLOUD = v;
      assert.equal(isReportToCloudEnabled(), false);
    });
  }

  it('falls back to legacy REPORT_TO_CLOUD when the new var is unset', () => {
    delete process.env.SHIPLIGHT_REPORT_TO_CLOUD;
    process.env.REPORT_TO_CLOUD = 'true';
    assert.equal(isReportToCloudEnabled(), true);
  });

  it('applies the same truthy parsing to legacy REPORT_TO_CLOUD=1', () => {
    delete process.env.SHIPLIGHT_REPORT_TO_CLOUD;
    process.env.REPORT_TO_CLOUD = '1';
    assert.equal(isReportToCloudEnabled(), true);
  });

  it('treats legacy REPORT_TO_CLOUD=0 as disabled', () => {
    delete process.env.SHIPLIGHT_REPORT_TO_CLOUD;
    process.env.REPORT_TO_CLOUD = '0';
    assert.equal(isReportToCloudEnabled(), false);
  });

  it('lets SHIPLIGHT_REPORT_TO_CLOUD=false override REPORT_TO_CLOUD=true', () => {
    process.env.SHIPLIGHT_REPORT_TO_CLOUD = 'false';
    process.env.REPORT_TO_CLOUD = 'true';
    assert.equal(isReportToCloudEnabled(), false);
  });
});

describe('extractTriggerOption', () => {
  it('returns no trigger when the flag is absent', () => {
    const { trigger, rest, warnings } = extractTriggerOption(['--open']);
    assert.equal(trigger, undefined);
    assert.deepEqual(warnings, []);
    assert.deepEqual(rest, ['--open']);
  });

  it('reads --trigger <value> and removes both tokens', () => {
    // The value must not survive in rest: runSingleReport takes the first
    // non-flag arg as the report folder, so "Jenkins" would become a folder.
    const { trigger, rest, warnings } = extractTriggerOption(['--trigger', 'Jenkins', '--open']);
    assert.equal(trigger, 'Jenkins');
    assert.deepEqual(warnings, []);
    assert.deepEqual(rest, ['--open']);
  });

  it('reads the --trigger=<value> form', () => {
    const { trigger, rest } = extractTriggerOption(['--trigger=Buildkite', '--open']);
    assert.equal(trigger, 'Buildkite');
    assert.deepEqual(rest, ['--open']);
  });

  it('keeps the report folder intact alongside the flag', () => {
    const { trigger, rest } = extractTriggerOption(['my-report', '--trigger', 'Jenkins']);
    assert.equal(trigger, 'Jenkins');
    assert.deepEqual(rest, ['my-report']);
  });

  it('keeps every merge input directory intact', () => {
    // runMergeReport treats each non-flag arg as an input dir; swallowing one
    // would silently drop a shard from the merged report.
    const { trigger, rest } = extractTriggerOption([
      '--merge', 'shard-0/', 'shard-1/', '--trigger', 'Jenkins', '-o', 'combined/',
    ]);
    assert.equal(trigger, 'Jenkins');
    assert.deepEqual(rest, ['--merge', 'shard-0/', 'shard-1/', '-o', 'combined/']);
  });

  it('accepts a value with spaces', () => {
    const { trigger } = extractTriggerOption(['--trigger', 'Nightly Regression']);
    assert.equal(trigger, 'Nightly Regression');
  });

  it('trims surrounding whitespace', () => {
    const { trigger } = extractTriggerOption(['--trigger', '  Jenkins  ']);
    assert.equal(trigger, 'Jenkins');
  });

  it('warns and falls back to detection when the value is missing at the end of the args', () => {
    // `--trigger $VAR` unquoted with VAR unset drops the argument entirely.
    // Failing here would cost the whole report over a cosmetic label.
    const { trigger, warnings } = extractTriggerOption(['--trigger']);
    assert.equal(trigger, undefined);
    assert.match(warnings[0] ?? '', /falling back to CI auto-detection/);
  });

  it('warns when the next token is another flag, and still honors that flag', () => {
    // `--trigger --open` is a typo, not a request to name the run "--open".
    const { trigger, rest, warnings } = extractTriggerOption(['--trigger', '--open']);
    assert.equal(trigger, undefined);
    assert.match(warnings[0] ?? '', /falling back to CI auto-detection/);
    assert.deepEqual(rest, ['--open'], 'the following flag must still be honored');
  });

  it('warns on a blank value rather than blanking the trigger', () => {
    // `--trigger "$VAR"` with VAR unset — the quoted spelling of the same slip.
    const { trigger, warnings } = extractTriggerOption(['--trigger', '   ']);
    assert.equal(trigger, undefined);
    assert.match(warnings[0] ?? '', /falling back to CI auto-detection/);
  });

  it('consumes a blank value instead of leaving it in rest', () => {
    // Left behind, the empty string would be picked up as the report folder.
    const { rest } = extractTriggerOption(['--trigger', '', 'my-report']);
    assert.deepEqual(rest, ['my-report']);
  });

  it('warns on an empty --trigger= value', () => {
    const { trigger, warnings } = extractTriggerOption(['--trigger=']);
    assert.equal(trigger, undefined);
    assert.match(warnings[0] ?? '', /falling back to CI auto-detection/);
  });

  it('takes the last value when the flag is repeated', () => {
    const { trigger, rest, warnings } = extractTriggerOption(['--trigger', 'First', '--trigger=Second']);
    assert.equal(trigger, 'Second');
    assert.deepEqual(warnings, []);
    assert.deepEqual(rest, []);
  });

  it('keeps a valid value supplied after a malformed occurrence', () => {
    // A malformed occurrence must not discard a good value given later.
    const { trigger, rest, warnings } = extractTriggerOption(['--trigger', '--open', '--trigger=Jenkins']);
    assert.equal(trigger, 'Jenkins');
    assert.match(warnings[0] ?? '', /using "Jenkins"/, 'the typo is still worth reporting');
    assert.deepEqual(rest, ['--open']);
  });

  it('keeps a valid value supplied before a malformed occurrence', () => {
    const { trigger, warnings } = extractTriggerOption(['--trigger=Jenkins', '--trigger']);
    assert.equal(trigger, 'Jenkins');
    assert.match(warnings[0] ?? '', /using "Jenkins"/);
  });

  it('leaves a single-dash token in rest rather than swallowing a real flag', () => {
    // `-o` is a real report flag. Consuming it as the trigger value would
    // silently drop the output directory it introduces.
    const { trigger, rest, warnings } = extractTriggerOption(['--trigger', '-o', 'combined/']);
    assert.equal(trigger, undefined);
    assert.match(warnings[0] ?? '', /falling back to CI auto-detection/);
    assert.deepEqual(rest, ['-o', 'combined/'], '-o must survive for the output parser');
  });

  it('takes a dash-prefixed value through the inline spelling', () => {
    // The escape hatch for a label that really does start with a dash.
    const { trigger, rest, warnings } = extractTriggerOption(['--trigger=-nightly']);
    assert.equal(trigger, '-nightly');
    assert.deepEqual(warnings, []);
    assert.deepEqual(rest, []);
  });

  it('warns when the consumed value names an existing directory', () => {
    // `--trigger $VAR my-report` with VAR unset arrives as `--trigger my-report`.
    // Parsing cannot tell that from a label, but an existing directory is a
    // strong enough signal to say so out loud.
    const { trigger, warnings } = extractTriggerOption(['--trigger', 'my-report'], (c) => c === 'my-report');
    assert.equal(trigger, 'my-report');
    assert.match(warnings[0] ?? '', /not as the report folder/);
  });

  it('does not warn about a directory-like value in the inline spelling', () => {
    // `--trigger=my-report` is unambiguous — the folder was plainly not meant.
    const { trigger, warnings } = extractTriggerOption(['--trigger=my-report'], () => true);
    assert.equal(trigger, 'my-report');
    assert.deepEqual(warnings, []);
  });

  it('does not warn when an explicit folder was also given', () => {
    // `dirExists` says yes to everything, so only the surviving folder in rest
    // can suppress the warning — the value cannot have swallowed a folder that
    // is plainly still there.
    const { trigger, rest, warnings } = extractTriggerOption(['--trigger', 'Jenkins', 'my-report'], () => true);
    assert.equal(trigger, 'Jenkins');
    assert.deepEqual(rest, ['my-report']);
    assert.deepEqual(warnings, []);
  });

  it('does not warn when shard directories survive in merge mode', () => {
    const { trigger, warnings } = extractTriggerOption(
      ['--merge', 'shard-0/', 'shard-1/', '--trigger', 'nightly'],
      () => true,
    );
    assert.equal(trigger, 'nightly');
    assert.deepEqual(warnings, []);
  });

  it('still warns when the swallowed value is the only path-like token', () => {
    const { trigger, rest, warnings } = extractTriggerOption(['--trigger', 'my-report', '--open'], () => true);
    assert.equal(trigger, 'my-report');
    assert.deepEqual(rest, ['--open'], 'a flag is not a folder, so the warning must survive');
    assert.match(warnings[0] ?? '', /not as the report folder/);
  });

  it('reports both the missing-value and swallowed-path warnings together', () => {
    const { trigger, warnings } = extractTriggerOption(
      ['--trigger', '--open', '--trigger', 'my-report'],
      () => true,
    );
    assert.equal(trigger, 'my-report');
    assert.equal(warnings.length, 2);
  });
});
