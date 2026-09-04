import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { ShiplightReporter } from './index.js';
import { expandStepContexts } from './contextDelta.js';
import type { ReportData } from './template.js';

/**
 * The wiring proof for FR-024: the cap and the delta encoding are only worth
 * anything if a real reporter run actually applies them on the way to
 * report-data.json. The units are covered in contextSnapshot.test.ts and
 * contextDelta.test.ts.
 */

const BIG_VALUE = 'x'.repeat(5000);

let outputDir = '';

beforeEach(() => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiplight-reporter-context-'));
});

afterEach(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

function runReporter(stepResults: Record<string, unknown>): Promise<ReportData> {
  const reporter = new ShiplightReporter({ outputFolder: outputDir, open: 'never' });
  reporter.onBegin({ projects: [] } as unknown as FullConfig, {} as Suite);

  const testCase = {
    title: 'exports a file',
    tags: [],
    location: { file: path.join(outputDir, 'export.yaml.spec.ts'), line: 1, column: 1 },
    titlePath: () => ['exports a file'],
  } as unknown as TestCase;

  const testResult = {
    status: 'passed',
    duration: 12,
    startTime: new Date('2026-08-27T00:00:00.000Z'),
    errors: [],
    stdout: [],
    stderr: [],
    steps: [],
    attachments: [
      {
        name: 'shiplight-results',
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(stepResults)),
      },
    ],
  } as unknown as TestResult;

  reporter.onTestEnd(testCase, testResult);
  return reporter
    .onEnd({ status: 'passed', duration: 12 } as FullResult)
    .then(() => JSON.parse(fs.readFileSync(path.join(outputDir, 'report-data.json'), 'utf8')) as ReportData);
}

describe('ShiplightReporter variable snapshot encoding', () => {
  it('records changes from the previous step instead of a full store copy', async () => {
    const report = await runReporter({
      'main.0': {
        description: 'Open the file',
        status: 'success',
        contextBefore: { user: 'a@example.com', env: 'beta' },
        contextAfter: { user: 'a@example.com', env: 'beta' },
      },
      'main.1': {
        description: 'Export it',
        status: 'success',
        contextBefore: { user: 'a@example.com', env: 'beta' },
        contextAfter: { user: 'a@example.com', env: 'beta', exportedName: 'notes.md' },
      },
    });

    const steps = report.tests[0].steps;
    assert.deepEqual(steps[0].contextBeforeDelta, { set: { user: 'a@example.com', env: 'beta' } });
    assert.deepEqual(steps[1].contextBeforeDelta, {}, 'nothing changed between the steps');
    assert.deepEqual(steps[1].contextAfterDelta, { set: { exportedName: 'notes.md' } });
    for (const step of steps) {
      assert.equal('contextBefore' in step, false, 'the full copy must not also be written');
      assert.equal('contextAfter' in step, false);
    }
  });

  it('caps an oversized variable value before recording it', async () => {
    const report = await runReporter({
      'main.0': {
        description: 'Export it',
        status: 'success',
        contextBefore: { exportedBuffers: BIG_VALUE },
        contextAfter: { exportedBuffers: BIG_VALUE },
      },
    });

    const recorded = report.tests[0].steps[0].contextBeforeDelta?.set?.exportedBuffers as string;
    assert.ok(recorded.endsWith('[truncated, 5000 chars]'), recorded.slice(-40));
    assert.ok(recorded.length < BIG_VALUE.length);
    assert.ok(
      JSON.stringify(report).length < BIG_VALUE.length,
      'the whole report must be smaller than the value it used to copy per step',
    );
  });

  it('encodes every attempt of a retried test from a fresh state', async () => {
    // buildReportTest runs once per attempt, so each attempt's step list is its
    // own chain. A retry re-runs from an empty store, so its first step must
    // carry the whole store again rather than continue the previous attempt's.
    const reporter = new ShiplightReporter({ outputFolder: outputDir, open: 'never' });
    reporter.onBegin({ projects: [] } as unknown as FullConfig, {} as Suite);

    const testCase = {
      title: 'flaky export',
      tags: [],
      location: { file: path.join(outputDir, 'export.yaml.spec.ts'), line: 1, column: 1 },
      titlePath: () => ['flaky export'],
    } as unknown as TestCase;

    const attemptResult = (status: string, steps: Record<string, unknown>) =>
      ({
        status,
        duration: 12,
        startTime: new Date('2026-08-27T00:00:00.000Z'),
        errors: [],
        stdout: [],
        stderr: [],
        steps: [],
        attachments: [
          { name: 'shiplight-results', contentType: 'application/json', body: Buffer.from(JSON.stringify(steps)) },
        ],
      }) as unknown as TestResult;

    const stepsFor = (fileId: number) => ({
      'main.0': {
        description: 'Open',
        status: 'success',
        contextBefore: { user: 'a@example.com' },
        contextAfter: { user: 'a@example.com' },
      },
      'main.1': {
        description: 'Export',
        status: 'success',
        contextBefore: { user: 'a@example.com' },
        contextAfter: { user: 'a@example.com', fileId },
      },
    });

    reporter.onTestEnd(testCase, attemptResult('failed', stepsFor(1)));
    reporter.onTestEnd(testCase, attemptResult('passed', stepsFor(2)));
    await reporter.onEnd({ status: 'passed', duration: 24 } as FullResult);

    const report = JSON.parse(fs.readFileSync(path.join(outputDir, 'report-data.json'), 'utf8')) as ReportData;
    const attempts = report.tests[0].attempts ?? [];
    assert.equal(attempts.length, 2);

    for (const [index, recorded] of attempts.entries()) {
      assert.deepEqual(
        recorded.steps[0].contextBeforeDelta,
        { set: { user: 'a@example.com' } },
        `attempt ${index + 1} must open with the whole store`,
      );
      assert.equal('contextBefore' in recorded.steps[0], false, `attempt ${index + 1} must be encoded`);
    }
    assert.deepEqual(attempts[0].steps[1].contextAfterDelta, { set: { fileId: 1 } });
    assert.deepEqual(attempts[1].steps[1].contextAfterDelta, { set: { fileId: 2 } });
  });

  it('round-trips through the reader back to what the run observed', async () => {
    const report = await runReporter({
      'main.0': {
        description: 'Open the file',
        status: 'success',
        contextBefore: { user: 'a@example.com' },
        contextAfter: { user: 'a@example.com', fileId: 42 },
      },
      'main.1': {
        description: 'Delete a variable',
        status: 'success',
        contextBefore: { user: 'a@example.com', fileId: 42 },
        contextAfter: { user: 'a@example.com' },
      },
    });

    const expanded = expandStepContexts(report.tests[0].steps);
    assert.deepEqual(expanded[0].contextBefore, { user: 'a@example.com' });
    assert.deepEqual(expanded[0].contextAfter, { user: 'a@example.com', fileId: 42 });
    assert.deepEqual(expanded[1].contextBefore, { user: 'a@example.com', fileId: 42 });
    assert.deepEqual(expanded[1].contextAfter, { user: 'a@example.com' });
  });
});
