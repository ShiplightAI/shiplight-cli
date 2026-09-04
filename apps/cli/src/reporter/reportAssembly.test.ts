import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assembleReportTest } from './reportAssembly.js';
import type { ReportAttempt, ReportTest } from './template.js';

function attempt(overrides: Partial<ReportAttempt> = {}): ReportAttempt {
  return {
    attemptNumber: 1,
    status: 'passed',
    duration: 100,
    steps: [],
    ...overrides,
  };
}

function builder(overrides: Partial<ReportTest> = {}): ReportTest {
  return {
    title: 'checkout works',
    file: 'tests/checkout.yaml.spec.ts',
    status: 'passed',
    duration: 100,
    steps: [],
    ...overrides,
  };
}

describe('assembleReportTest — fields derived by the per-attempt builder', () => {
  it('carries stdout and stderr through to the assembled test', () => {
    // The regression this function exists for: the old inline copy named each
    // field it wanted and never named these two, so `cloudUpload` uploaded an
    // empty string for every test's console output.
    const result = assembleReportTest({
      lastBuilder: builder({ stdout: 'hello from the test', stderr: 'a warning' }),
      builtAttempts: [attempt()],
      title: 'checkout works',
      file: 'tests/checkout.yaml.spec.ts',
    });

    assert.equal(result.stdout, 'hello from the test');
    assert.equal(result.stderr, 'a warning');
  });

  it('carries every YAML-enrichment field the builder resolved', () => {
    const result = assembleReportTest({
      lastBuilder: builder({
        tags: ['auth', 'smoke'],
        baseTitle: 'checkout works',
        suiteName: 'Checkout suite',
        baseUrl: 'https://example.test',
        skip: 'flaky on CI',
        slow: true,
        timeout: 60_000,
        parameterSetName: 'admin',
        actionStepsMap: { 'main.0': { description: 'click' } },
      }),
      builtAttempts: [attempt()],
      title: 'checkout works [admin]',
      file: 'tests/checkout.yaml.spec.ts',
    });

    assert.deepEqual(result.tags, ['auth', 'smoke']);
    assert.equal(result.baseTitle, 'checkout works');
    assert.equal(result.suiteName, 'Checkout suite');
    assert.equal(result.baseUrl, 'https://example.test');
    assert.equal(result.skip, 'flaky on CI');
    assert.equal(result.slow, true);
    assert.equal(result.timeout, 60_000);
    assert.equal(result.parameterSetName, 'admin');
    assert.deepEqual(result.actionStepsMap, { 'main.0': { description: 'click' } });
  });

  it('carries a field the builder sets that this function never names', () => {
    // The point of the spread: a field added to the builder later must reach the
    // report without editing this function. Asserting on a known field would
    // only prove the field list is currently right, not that it stays right.
    const invented = { llmUsage: [{ model: 'future-field' }] } as unknown as Partial<ReportTest>;
    const result = assembleReportTest({
      lastBuilder: builder(invented),
      builtAttempts: [attempt()],
      title: 'checkout works',
      file: 'tests/checkout.yaml.spec.ts',
    });

    assert.deepEqual(
      (result as unknown as Record<string, unknown>).llmUsage,
      [{ model: 'future-field' }],
    );
  });
});

describe('assembleReportTest — fields owned by the attempt sequence', () => {
  it('takes the headline result from the final attempt, not the builder', () => {
    const result = assembleReportTest({
      lastBuilder: builder({ status: 'failed', duration: 1, error: 'stale' }),
      builtAttempts: [
        attempt({ attemptNumber: 1, status: 'failed', duration: 50, error: 'first' }),
        attempt({
          attemptNumber: 2,
          status: 'passed',
          duration: 250,
          error: undefined,
          videoPath: 'v.webm',
          tracePath: 't.zip',
        }),
      ],
      title: 'checkout works',
      file: 'tests/checkout.yaml.spec.ts',
    });

    assert.equal(result.status, 'passed');
    assert.equal(result.duration, 250);
    assert.equal(result.error, undefined);
    assert.equal(result.videoPath, 'v.webm');
    assert.equal(result.tracePath, 't.zip');
  });

  it('spans the whole retry sequence, from the first start to the last end', () => {
    const result = assembleReportTest({
      lastBuilder: builder({ startTime: '2026-01-01T00:05:00Z', endTime: 'ignored' }),
      builtAttempts: [attempt(), attempt({ attemptNumber: 2 })],
      title: 'checkout works',
      file: 'tests/checkout.yaml.spec.ts',
      startTime: '2026-01-01T00:00:00Z',
      endTime: '2026-01-01T00:10:00Z',
    });

    assert.equal(result.startTime, '2026-01-01T00:00:00Z');
    assert.equal(result.endTime, '2026-01-01T00:10:00Z');
  });

  it('uses the caller-supplied title and file rather than the builder copies', () => {
    const result = assembleReportTest({
      lastBuilder: builder({ title: 'stale title', file: 'stale/path.ts' }),
      builtAttempts: [attempt()],
      title: 'checkout works [admin]',
      file: 'tests/checkout.yaml.spec.ts',
    });

    assert.equal(result.title, 'checkout works [admin]');
    assert.equal(result.file, 'tests/checkout.yaml.spec.ts');
  });
});

describe('assembleReportTest — retries and flakiness', () => {
  it('omits retry history for a test that ran once', () => {
    const result = assembleReportTest({
      lastBuilder: builder(),
      builtAttempts: [attempt()],
      title: 'checkout works',
      file: 'tests/checkout.yaml.spec.ts',
    });

    assert.equal(result.retries, undefined);
    assert.equal(result.attempts, undefined);
    assert.equal(result.flaky, undefined);
  });

  it('records every attempt and counts retries as attempts minus one', () => {
    const attempts = [
      attempt({ attemptNumber: 1, status: 'failed' }),
      attempt({ attemptNumber: 2, status: 'failed' }),
      attempt({ attemptNumber: 3, status: 'passed' }),
    ];
    const result = assembleReportTest({
      lastBuilder: builder(),
      builtAttempts: attempts,
      title: 'checkout works',
      file: 'tests/checkout.yaml.spec.ts',
    });

    assert.equal(result.retries, 2);
    assert.deepEqual(result.attempts, attempts);
  });

  it('marks flaky when an earlier attempt failed and the last one passed', () => {
    const result = assembleReportTest({
      lastBuilder: builder(),
      builtAttempts: [
        attempt({ attemptNumber: 1, status: 'timedOut' }),
        attempt({ attemptNumber: 2, status: 'passed' }),
      ],
      title: 'checkout works',
      file: 'tests/checkout.yaml.spec.ts',
    });

    assert.equal(result.flaky, true);
  });

  it('does not mark flaky when every attempt failed', () => {
    // A test that never passed is a failure. Calling it flaky would hide it.
    const result = assembleReportTest({
      lastBuilder: builder({ status: 'failed' }),
      builtAttempts: [
        attempt({ attemptNumber: 1, status: 'failed' }),
        attempt({ attemptNumber: 2, status: 'failed' }),
      ],
      title: 'checkout works',
      file: 'tests/checkout.yaml.spec.ts',
    });

    assert.equal(result.flaky, undefined);
    assert.equal(result.status, 'failed');
  });

  it('does not mark flaky when every attempt passed', () => {
    const result = assembleReportTest({
      lastBuilder: builder(),
      builtAttempts: [
        attempt({ attemptNumber: 1, status: 'passed' }),
        attempt({ attemptNumber: 2, status: 'passed' }),
      ],
      title: 'checkout works',
      file: 'tests/checkout.yaml.spec.ts',
    });

    assert.equal(result.flaky, undefined);
  });
});

describe('assembleReportTest — missing builder', () => {
  it('still produces a valid test when no attempt build survived', () => {
    // `lastBuilder` is typed optional; spreading undefined must not throw and
    // must leave the required fields populated from the attempt.
    const result = assembleReportTest({
      lastBuilder: undefined,
      builtAttempts: [attempt({ status: 'interrupted', duration: 7 })],
      title: 'checkout works',
      file: 'tests/checkout.yaml.spec.ts',
    });

    assert.equal(result.title, 'checkout works');
    assert.equal(result.status, 'interrupted');
    assert.equal(result.duration, 7);
    assert.equal(result.tags, undefined);
  });
});

describe('assembleReportTest — per-attempt console output', () => {
  it('keeps each attempt\'s own stdout/stderr on the attempt record', () => {
    // `ReportTest.stdout` can only hold the final attempt's output, but the
    // output of a *failed* attempt is the reason to open a retried test's
    // report. cloudUpload reads these per-attempt fields.
    const result = assembleReportTest({
      lastBuilder: builder({ stdout: 'third run', stderr: '' }),
      builtAttempts: [
        attempt({ attemptNumber: 1, status: 'failed', stdout: 'first run', stderr: 'boom' }),
        attempt({ attemptNumber: 2, status: 'passed', stdout: 'third run' }),
      ],
      title: 'checkout works',
      file: 'tests/checkout.yaml.spec.ts',
    });

    assert.equal(result.attempts?.[0].stdout, 'first run');
    assert.equal(result.attempts?.[0].stderr, 'boom');
    assert.equal(result.attempts?.[1].stdout, 'third run');
  });
});
