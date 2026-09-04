import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import type { ActionEntity } from 'shiplight-types';
import { __resetRunCacheCollector, markRunCacheInPlay, runCacheCollector } from '../cache/runCacheMetadata.js';
import { ShiplightReporter } from './index.js';
import type { ReportData } from './template.js';

const authoredAction: ActionEntity = {
  action_description: 'Click login',
  locator: "getByRole('button', { name: 'Login' })",
};

const cachedAction: ActionEntity = {
  action_description: 'Click login',
  locator: "getByTestId('cached-login')",
};

let outputDir = '';

beforeEach(() => {
  __resetRunCacheCollector();
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiplight-reporter-cache-'));
});

afterEach(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
  __resetRunCacheCollector();
});

describe('ShiplightReporter cached action assembly', () => {
  it('joins an executed stmtUid to the cached action in report-data.json', async () => {
    markRunCacheInPlay();
    runCacheCollector().recordStatementSource(
      'statement-uid',
      'login.test.yaml',
      'Click login',
      'cache_hit',
      authoredAction,
      cachedAction,
    );

    const reporter = new ShiplightReporter({ outputFolder: outputDir, open: 'never' });
    reporter.onBegin({ projects: [] } as unknown as FullConfig, {} as Suite);

    const testCase = {
      title: 'logs in',
      tags: [],
      location: { file: path.join(outputDir, 'login.yaml.spec.ts'), line: 1, column: 1 },
      titlePath: () => ['logs in'],
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
          body: Buffer.from(
            JSON.stringify({
              'main.0': {
                description: 'Click login',
                status: 'success',
                duration: 10,
                stmtUid: 'statement-uid',
              },
            }),
          ),
        },
      ],
    } as unknown as TestResult;

    reporter.onTestEnd(testCase, testResult);
    await reporter.onEnd({ status: 'passed', duration: 12 } as FullResult);

    const report = JSON.parse(fs.readFileSync(path.join(outputDir, 'report-data.json'), 'utf8')) as ReportData;
    assert.equal(report.tests[0].steps[0].stmtUid, 'statement-uid');
    assert.deepEqual(report.tests[0].steps[0].cachedAction, cachedAction);
  });
});
