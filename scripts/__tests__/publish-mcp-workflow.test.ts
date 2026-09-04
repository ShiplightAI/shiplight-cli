/**
 * Guards the tarball-size gate in the MCP publish workflow.
 *
 * The gate is the only thing standing between a bundle regression and npm, and
 * it is bash inside YAML, so nothing else type-checks or exercises it. It also
 * now reads a caller-supplied input, which is the part most likely to be
 * loosened by accident: raising the default, or splicing the input straight
 * into the shell.
 *
 * publish-sdk.yml carries the same mechanism and is guarded by
 * publish-sdk-workflow.test.ts; keep the two in step.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { parse } from 'yaml';

const repoRoot = process.cwd();
const workflowPath = '.github/workflows/publish-mcp.yml';
const workflow = parse(readFileSync(path.join(repoRoot, workflowPath), 'utf8')) as {
  on: { workflow_dispatch: { inputs: Record<string, { type?: string; default?: unknown }> } };
  jobs: { publish: { steps: Array<{ name?: string; id?: string; run?: string; env?: Record<string, string> }> } };
};

const steps = workflow.jobs.publish.steps;
const stepNamed = (name: string) => steps.find((step) => step.name === name);
const sizeStep = stepNamed('Tarball size delta');

describe('publish-mcp.yml tarball size gate', () => {
  test('the approved maximum is an input that still defaults to +1%', () => {
    // The default is the gate. An unattended release must enforce +1% without
    // anyone having to remember to pass anything.
    const input = workflow.on.workflow_dispatch.inputs.max_size_increase_pct;
    assert.ok(input, 'max_size_increase_pct input is missing');
    assert.equal(input.type, 'number');
    assert.equal(input.default, 1);
  });

  test('the input reaches bash through env, never spliced into the script', () => {
    // `${{ inputs.x }}` inside run: is substituted before bash parses the
    // script, so a crafted value would execute as shell. Reading $VAR from env
    // keeps it data.
    assert.ok(sizeStep, 'size step is missing');
    assert.equal(sizeStep.env?.MAX_SIZE_INCREASE_PCT, '${{ inputs.max_size_increase_pct }}');
  });

  test('no step anywhere splices the input into its run script', () => {
    // Checked across every step, not just the gate: the summary step originally
    // interpolated it directly, and the next step to use the input would repeat
    // that unless the guard covers the whole job.
    const offenders = steps
      .filter((step) => /\$\{\{\s*inputs\.max_size_increase_pct\s*\}\}/.test(step.run ?? ''))
      .map((step) => step.name ?? '(unnamed)');
    assert.deepEqual(
      offenders,
      [],
      `these steps interpolate max_size_increase_pct into run:; pass it via env instead: ${offenders.join(', ')}`,
    );
  });

  test('every step that reads the input declares it in env', () => {
    // The mirror of the rule above: using $MAX_SIZE_INCREASE_PCT without the
    // env mapping silently reads an empty string, which the numeric validation
    // would then reject as invalid — a confusing failure far from the cause.
    const missing = steps
      .filter((step) => /\$MAX_SIZE_INCREASE_PCT\b/.test(step.run ?? ''))
      .filter((step) => step.env?.MAX_SIZE_INCREASE_PCT !== '${{ inputs.max_size_increase_pct }}')
      .map((step) => step.name ?? '(unnamed)');
    assert.deepEqual(missing, [], `these steps read $MAX_SIZE_INCREASE_PCT without declaring it in env: ${missing.join(', ')}`);
  });

  test('a non-numeric maximum is rejected rather than treated as zero', () => {
    // awk compares a non-numeric m as 0, which would make every release fail
    // rather than pass — but the operator would see a confusing size error
    // instead of "you typed the input wrong".
    assert.match(sizeStep?.run ?? '', /m ~ \/\^\[0-9\]\+\(\[\.\]\[0-9\]\+\)\?\$\//);
    assert.match(sizeStep?.run ?? '', /Invalid maximum size increase/);
  });

  test('growth beyond the approved maximum still fails the run', () => {
    const run = sizeStep?.run ?? '';
    assert.match(run, /exit \(p > m\) \? 0 : 1/, 'the comparison must be against the approved maximum');
    assert.match(run, /exit 1/, 'exceeding the maximum must fail the job, not just warn');
  });

  test('the gate runs before anything is published', () => {
    const at = (name: string) => steps.findIndex((step) => step.name === name);
    assert.ok(at('Tarball size delta') < at('npm publish'));
    assert.ok(at('Tarball size delta') < at('Publish to the MCP registry'));
  });

  test('the approved maximum is recorded in the run summary', () => {
    // Without this the run shows only the delta, so a release approved at a
    // higher maximum is indistinguishable from one that passed the default.
    const summary = stepNamed('Step summary');
    assert.match(summary?.run ?? '', /Approved size-growth maximum/);
    // It must be the real value, not a hardcoded number that would keep
    // reporting +1% after someone approved more.
    assert.match(summary?.run ?? '', /\$MAX_SIZE_INCREASE_PCT/);
  });

  test('annotations are built dynamically, not written as literals', () => {
    // Matches the repo-wide guard in github-actions-annotation-commands.test.ts.
    assert.match(sizeStep?.run ?? '', /printf '::%s::%s\\n' error/);
  });
});
