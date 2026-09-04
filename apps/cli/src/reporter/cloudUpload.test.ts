import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios, { type AxiosRequestConfig } from 'axios';
import { summarizeUploadError, uploadToCloud, __testing } from './cloudUpload.js';
import type { ReportAttempt, ReportData, ReportStep, ReportTest } from './template.js';

const { absoluteReportUrl, apiToWebBase, getCloudUploadConcurrency, buildCloudUploadConfigLog, buildReportV2, buildStepResultJson, buildVersionMeta, sumTestLlmUsage, runCapturedLlmUsage, uploadableCacheSummary } = __testing;

// Empty-tests ReportData → uploadToCloud only makes the create-run POST and
// the complete PUT. Both hit baseUrl directly, which is what we want to
// assert: that baseUrl is resolved from the token prefix, not hardcoded.
function emptyReport(): ReportData {
  return {
    tests: [],
    totalDuration: 0,
    timestamp: '2026-01-01T00:00:00Z',
  };
}

function reportWithScreenshots(outputDir: string, testCount = 4, stepsPerTest = 4): ReportData {
  const tests: ReportData['tests'] = [];

  for (let testIndex = 0; testIndex < testCount; testIndex++) {
    const steps = [];
    for (let stepIndex = 0; stepIndex < stepsPerTest; stepIndex++) {
      const screenshotPath = join(outputDir, `test-${testIndex}-step-${stepIndex}.png`);
      writeFileSync(screenshotPath, `fake-png-${testIndex}-${stepIndex}`);
      steps.push({
        stepId: `main.${stepIndex}`,
        description: `Step ${stepIndex}`,
        status: 'success' as const,
        screenshot: screenshotPath,
      });
    }

    tests.push({
      title: `test-${testIndex}`,
      file: `tests/test-${testIndex}.yaml.spec.ts`,
      status: 'passed',
      duration: 100,
      steps,
      startTime: `2026-01-01T00:00:0${testIndex}Z`,
      endTime: `2026-01-01T00:00:1${testIndex}Z`,
    });
  }

  return {
    tests,
    totalDuration: testCount * 100,
    timestamp: '2026-01-01T00:00:00Z',
  };
}

async function captureFirstPostUrl(token: string, override?: string): Promise<string> {
  // Stand up minimal axios stubs. We replace post/put methods on the singleton
  // and restore them in a finally. Avoids pulling in module-mocking flags.
  const observed: { post?: string; put?: string } = {};
  const originalPost = axios.post;
  const originalPut = axios.put;
  const originalUrl = process.env.SHIPLIGHT_API_URL;

  axios.post = (async (url: string) => {
    observed.post ??= url;
    return { data: { testRunId: 1, testCaseResults: [] } };
  }) as typeof axios.post;
  axios.put = (async (url: string) => {
    observed.put ??= url;
    return { data: { reportUrl: 'https://example.test/run/1' } };
  }) as typeof axios.put;

  if (override === undefined) delete process.env.SHIPLIGHT_API_URL;
  else process.env.SHIPLIGHT_API_URL = override;

  try {
    await uploadToCloud(emptyReport(), '/tmp/nonexistent', '2026-01-01T00:00:00Z', token);
  } finally {
    axios.post = originalPost;
    axios.put = originalPut;
    if (originalUrl === undefined) delete process.env.SHIPLIGHT_API_URL;
    else process.env.SHIPLIGHT_API_URL = originalUrl;
  }

  if (!observed.post) throw new Error('axios.post was not invoked');
  return observed.post;
}

describe('cloudUpload uploadToCloud — token-prefix host routing', () => {
  it('routes shp_pat_* tokens to api.shiplight.ai', async () => {
    const url = await captureFirstPostUrl('shp_pat_abc123');
    assert.equal(url, 'https://api.shiplight.ai/v1/local-runs');
  });

  it('routes shp_ctx_* tokens to api.shiplight.ai', async () => {
    const url = await captureFirstPostUrl('shp_ctx_xyz789');
    assert.equal(url, 'https://api.shiplight.ai/v1/local-runs');
  });

  it('skips the upload entirely for a legacy UUID token', async () => {
    // The v1 cloud was decommissioned in August 2026. Rather than posting to a
    // dead host — or failing a run that already produced its results — the
    // upload is skipped with a message, so no request is ever made.
    await assert.rejects(
      () => captureFirstPostUrl('11111111-2222-3333-4444-555555555555'),
      /axios\.post was not invoked/,
    );
  });

  it('honors SHIPLIGHT_API_URL override even for shp_* tokens', async () => {
    const url = await captureFirstPostUrl('shp_pat_abc', 'http://localhost:3001');
    assert.equal(url, 'http://localhost:3001/v1/local-runs');
  });
});

describe('cloudUpload — run-level tier provenance in /complete', () => {
  // Empty-tests report → only create-run POST and complete PUT fire.
  async function captureCompleteBody(reportData: ReportData): Promise<Record<string, unknown>> {
    const originalPost = axios.post;
    const originalPut = axios.put;
    let completeBody: Record<string, unknown> | undefined;

    axios.post = (async () => ({ data: { testRunId: 7, testCaseResults: [] } })) as typeof axios.post;
    axios.put = (async (url: string, body?: unknown) => {
      if (url.includes('/complete')) completeBody = body as Record<string, unknown>;
      return { data: { reportUrl: 'https://example.test/run/7' } };
    }) as typeof axios.put;

    try {
      await uploadToCloud(reportData, '/tmp/nonexistent', '2026-01-01T00:00:00Z', 'shp_pat_testtoken');
    } finally {
      axios.post = originalPost;
      axios.put = originalPut;
    }
    if (!completeBody) throw new Error('/complete PUT was not invoked');
    return completeBody;
  }

  it('forwards modelTierProvenance when the report carries it', async () => {
    const provenance = {
      tier: 'pro' as const,
      tierSource: 'env' as const,
      mapSource: 'server' as const,
      webagentPrimary: 'anthropic:claude-opus-4-8',
      computerUsePrimary: 'google:gemini-3-flash-preview',
    };
    const body = await captureCompleteBody({
      tests: [],
      totalDuration: 0,
      timestamp: '2026-01-01T00:00:00Z',
      modelTierProvenance: provenance,
    });
    assert.deepEqual(body.modelTierProvenance, provenance);
  });

  it('omits modelTierProvenance for a BYOK / non-tier run', async () => {
    const body = await captureCompleteBody({
      tests: [],
      totalDuration: 0,
      timestamp: '2026-01-01T00:00:00Z',
    });
    assert.equal('modelTierProvenance' in body, false);
  });
});

describe('cloudUpload absoluteReportUrl — promote path-only responses to absolute', () => {
  // The API can return reportUrl as a path (e.g. "/run-results/38") or an
  // absolute URL. These tests guard the promotion: relative → absolute via
  // an api-host → web-host mapping, absolute → unchanged.
  it('passes absolute URLs through unchanged (v1 cloud behavior)', () => {
    assert.equal(
      absoluteReportUrl('https://app.shiplight.ai/run-results/42', 'https://api.shiplight.ai'),
      'https://app.shiplight.ai/run-results/42',
    );
  });

  it('promotes path-only response to app.shiplight.ai when API base is api.shiplight.ai', () => {
    assert.equal(
      absoluteReportUrl('/run-results/12', 'https://api.shiplight.ai'),
      'https://app.shiplight.ai/run-results/12',
    );
  });

  it('falls back to the API base for unknown hosts (staging / localhost / self-hosted)', () => {
    assert.equal(
      absoluteReportUrl('/run-results/7', 'http://localhost:3001'),
      'http://localhost:3001/run-results/7',
    );
    assert.equal(
      absoluteReportUrl('/run-results/7', 'https://staging.shiplight.ai/'),
      'https://staging.shiplight.ai/run-results/7',
    );
  });

  it('prepends a leading slash if the server omits it', () => {
    assert.equal(
      absoluteReportUrl('run-results/9', 'https://api.shiplight.ai'),
      'https://app.shiplight.ai/run-results/9',
    );
  });

  it('apiToWebBase maps known hosts and passes overrides through', () => {
    assert.equal(apiToWebBase('https://api.shiplight.ai'), 'https://app.shiplight.ai');
    assert.equal(apiToWebBase('http://localhost:3001'), 'http://localhost:3001');
    assert.equal(apiToWebBase('https://staging.shiplight.ai/'), 'https://staging.shiplight.ai');
  });

  it('apiToWebBase still maps known hosts when they carry a trailing slash', () => {
    // Regression: previously, strict equality fired before the slash-strip,
    // so a configured base like "https://api.shiplight.ai/" silently fell
    // through to the override branch and the printed URL pointed at the
    // API host instead of the UI host.
    assert.equal(apiToWebBase('https://api.shiplight.ai/'), 'https://app.shiplight.ai');
  });
});

describe('cloudUpload upload concurrency', () => {
  it('formats an explicit per-run config log with defaults', () => {
    const originalConcurrency = process.env.SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS;
    delete process.env.SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS;
    try {
      const line = buildCloudUploadConfigLog(4, getCloudUploadConcurrency());
      assert.equal(
        line,
        '[reporter] [config] Cloud upload settings for 4 test(s): ' +
          'presignedPutCap=6 (default), screenshotUrlWorkers=8, testUploadWorkers=5, perTestAssetWorkers=10',
      );
    } finally {
      if (originalConcurrency === undefined) delete process.env.SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS;
      else process.env.SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS = originalConcurrency;
    }
  });

  it('labels the put cap as (default) when the env override is set but invalid', () => {
    const originalConcurrency = process.env.SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS;
    process.env.SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS = 'not-a-number';
    try {
      const concurrency = getCloudUploadConcurrency();
      // Invalid override falls back to the default value...
      assert.equal(concurrency.maxConcurrentPutUploads, 6);
      // ...and the log must not attribute that fallback to the env var.
      assert.match(buildCloudUploadConfigLog(4, concurrency), /presignedPutCap=6 \(default\)/);
    } finally {
      if (originalConcurrency === undefined) delete process.env.SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS;
      else process.env.SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS = originalConcurrency;
    }
  });

  it('caps presigned PUT uploads across all tests with a single process-wide limit', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'shiplight-cloud-upload-'));
    const reportData = reportWithScreenshots(tempDir, 4, 4);
    const originalPost = axios.post;
    const originalPut = axios.put;
    const originalConsoleLog = console.log;
    const originalConcurrency = process.env.SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS;

    let activeUploadPuts = 0;
    let maxActiveUploadPuts = 0;
    let reportCounter = 0;
    const logLines: string[] = [];

    process.env.SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS = '3';
    console.log = ((message?: unknown, ...args: unknown[]) => {
      logLines.push([message, ...args].map((value) => String(value)).join(' '));
    }) as typeof console.log;

    axios.post = (async (url: string, body?: unknown) => {
      if (url.endsWith('/v1/local-runs')) {
        return {
          data: {
            testRunId: 101,
            testCaseResults: reportData.tests.map((test, index) => ({
              testCaseName: test.title,
              testCaseResultId: index + 1,
              uploadUrls: {
                video: `https://upload.test/video/${index + 1}`,
                trace: `https://upload.test/trace/${index + 1}`,
                screenshots: {},
              },
              s3Uris: {
                video: `s3://bucket/video/${index + 1}`,
                trace: `s3://bucket/trace/${index + 1}`,
              },
              screenshotS3Uris: {},
            })),
          },
        };
      }

      if (url.includes('/screenshot-urls')) {
        const { stepIds } = body as { stepIds: string[] };
        return {
          data: {
            screenshots: Object.fromEntries(stepIds.map((stepId) => [stepId, `https://upload.test/screenshot/${encodeURIComponent(stepId)}`])),
            screenshotS3Uris: Object.fromEntries(stepIds.map((stepId) => [stepId, `s3://bucket/screenshots/${stepId}`])),
          },
        };
      }

      if (url.includes('/report-url')) {
        reportCounter += 1;
        return {
          data: {
            reportUrl: `https://upload.test/report/${reportCounter}`,
            reportS3Uri: `s3://bucket/report/${reportCounter}`,
          },
        };
      }

      throw new Error(`Unexpected POST ${url}`);
    }) as typeof axios.post;

    axios.put = (async (url: string) => {
      if (url.startsWith('https://upload.test/')) {
        activeUploadPuts += 1;
        maxActiveUploadPuts = Math.max(maxActiveUploadPuts, activeUploadPuts);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeUploadPuts -= 1;
        return { data: {} };
      }

      return { data: { reportUrl: 'https://example.test/run/101' } };
    }) as typeof axios.put;

    try {
      await uploadToCloud(reportData, tempDir, '2026-01-01T00:00:00Z', 'shp_pat_testtoken');
      assert.equal(getCloudUploadConcurrency().maxConcurrentPutUploads, 3);
      assert.equal(maxActiveUploadPuts, 3);
      assert.ok(
        logLines.includes(
          '[reporter] [config] Cloud upload settings for 4 test(s): ' +
            'presignedPutCap=3 (env:SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS), ' +
            'screenshotUrlWorkers=8, testUploadWorkers=5, perTestAssetWorkers=10',
        ),
      );
    } finally {
      axios.post = originalPost;
      axios.put = originalPut;
      console.log = originalConsoleLog;
      if (originalConcurrency === undefined) delete process.env.SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS;
      else process.env.SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS = originalConcurrency;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('cloudUpload — one test\'s report-url failure does not abort the run', () => {
  // Regression test: a backend 500 on POST .../report-url for one test used to
  // throw uncaught out of the per-test worker, which fail-fast-rejected the
  // shared withConcurrency() Promise.all for ALL tests and skipped [4/4]
  // finalising the run entirely — silently dropping every other in-flight
  // test's upload with no warning. The report-url call must now be caught
  // locally, skip only the failing test, and still finalise the run.
  it('excludes the failing test but still finalises the run for the rest', async () => {
    const originalPost = axios.post;
    const originalPut = axios.put;
    const originalConsoleWarn = console.warn;
    const warnLines: string[] = [];
    console.warn = ((...args: unknown[]) => {
      warnLines.push(args.map((value) => String(value)).join(' '));
    }) as typeof console.warn;

    const reportData: ReportData = {
      tests: [
        { title: 'test-ok-1', file: 'tests/a.yaml.spec.ts', status: 'passed', duration: 10, steps: [] },
        { title: 'test-fails', file: 'tests/b.yaml.spec.ts', status: 'passed', duration: 10, steps: [] },
        { title: 'test-ok-2', file: 'tests/c.yaml.spec.ts', status: 'passed', duration: 10, steps: [] },
      ],
      totalDuration: 30,
      timestamp: '2026-01-01T00:00:00Z',
    };

    let completeCalled = false;
    let completeResultsCount = -1;

    axios.post = (async (url: string) => {
      if (url.endsWith('/v1/local-runs')) {
        return {
          data: {
            testRunId: 202,
            testCaseResults: reportData.tests.map((test, index) => ({
              testCaseName: test.title,
              testCaseResultId: index + 1,
              uploadUrls: { video: '', trace: '', screenshots: {} },
              s3Uris: { video: '', trace: '' },
              screenshotS3Uris: {},
            })),
          },
        };
      }
      if (url.includes('/report-url')) {
        if (url.includes('/results/2/')) {
          const err = new Error('Request failed with status code 500') as Error & {
            isAxiosError: boolean;
            config: { method: string; url: string };
            response: { status: number; data: unknown };
          };
          err.isAxiosError = true;
          err.config = { method: 'post', url };
          err.response = { status: 500, data: { error: 'Internal server error' } };
          throw err;
        }
        return { data: { reportUrl: 'https://upload.test/report', reportS3Uri: 's3://bucket/report' } };
      }
      throw new Error(`Unexpected POST ${url}`);
    }) as typeof axios.post;

    axios.put = (async (url: string, body?: unknown) => {
      if (url.startsWith('https://upload.test/')) return { data: {} };
      if (url.includes('/complete')) {
        completeCalled = true;
        completeResultsCount = (body as { results: unknown[] }).results.length;
        return { data: { reportUrl: 'https://example.test/run/202' } };
      }
      throw new Error(`Unexpected PUT ${url}`);
    }) as typeof axios.put;

    try {
      await uploadToCloud(reportData, '/tmp/nonexistent', '2026-01-01T00:00:00Z', 'shp_pat_testtoken');

      // The whole call must resolve, not reject, despite one test's failure.
      assert.equal(completeCalled, true);
      // Only the 2 successful tests are included in the finalize payload.
      assert.equal(completeResultsCount, 2);
      assert.ok(
        warnLines.some((line) => line.includes('Report upload failed for "test-fails"') && line.includes('500')),
      );
    } finally {
      axios.post = originalPost;
      axios.put = originalPut;
      console.warn = originalConsoleWarn;
    }
  });

  // Regression test: reportS3Uri used to be assigned right after the report-url
  // POST resolved, BEFORE the presigned PUT that actually uploads the report body
  // had completed. If that PUT then failed, the catch block logged a warning but
  // reportS3Uri was already set, so the `if (!reportS3Uri)` guard passed and the
  // test was still included in /complete with a URI pointing at data that was
  // never uploaded. reportS3Uri must only be assigned after the PUT succeeds.
  it('excludes a test whose presigned report PUT fails, even though report-url succeeded', async () => {
    const originalPost = axios.post;
    const originalPut = axios.put;
    const originalConsoleWarn = console.warn;
    console.warn = (() => {}) as typeof console.warn;

    const reportData: ReportData = {
      tests: [
        { title: 'test-ok-1', file: 'tests/a.yaml.spec.ts', status: 'passed', duration: 10, steps: [] },
        { title: 'test-put-fails', file: 'tests/b.yaml.spec.ts', status: 'passed', duration: 10, steps: [] },
        { title: 'test-ok-2', file: 'tests/c.yaml.spec.ts', status: 'passed', duration: 10, steps: [] },
      ],
      totalDuration: 30,
      timestamp: '2026-01-01T00:00:00Z',
    };

    let completeResultsCount = -1;

    axios.post = (async (url: string) => {
      if (url.endsWith('/v1/local-runs')) {
        return {
          data: {
            testRunId: 303,
            testCaseResults: reportData.tests.map((test, index) => ({
              testCaseName: test.title,
              testCaseResultId: index + 1,
              uploadUrls: { video: '', trace: '', screenshots: {} },
              s3Uris: { video: '', trace: '' },
              screenshotS3Uris: {},
            })),
          },
        };
      }
      if (url.includes('/report-url')) {
        // report-url itself always succeeds — the failure happens on the
        // subsequent presigned PUT for testCaseResultId 2.
        return {
          data: {
            reportUrl: url.includes('/results/2/')
              ? 'https://upload.test/report/failing'
              : 'https://upload.test/report/ok',
            reportS3Uri: 's3://bucket/report',
          },
        };
      }
      throw new Error(`Unexpected POST ${url}`);
    }) as typeof axios.post;

    axios.put = (async (url: string, body?: unknown) => {
      if (url === 'https://upload.test/report/failing') {
        throw new Error('PUT failed: connection reset');
      }
      if (url.startsWith('https://upload.test/')) return { data: {} };
      if (url.includes('/complete')) {
        completeResultsCount = (body as { results: unknown[] }).results.length;
        return { data: { reportUrl: 'https://example.test/run/303' } };
      }
      throw new Error(`Unexpected PUT ${url}`);
    }) as typeof axios.put;

    try {
      await uploadToCloud(reportData, '/tmp/nonexistent', '2026-01-01T00:00:00Z', 'shp_pat_testtoken');
      // Only the 2 tests whose report body actually uploaded are completed.
      assert.equal(completeResultsCount, 2);
    } finally {
      axios.post = originalPost;
      axios.put = originalPut;
      console.warn = originalConsoleWarn;
    }
  });
});

describe('summarizeUploadError', () => {
  it('reduces an axios error to method, URL, status, and body', () => {
    const err = new Error('boom') as Error & {
      isAxiosError: boolean;
      config: { method: string; url: string };
      response: { status: number; data: unknown };
    };
    err.isAxiosError = true;
    err.config = { method: 'post', url: 'https://api.test/v1/local-runs/1/results/2/report-url' };
    err.response = { status: 500, data: { error: 'Internal server error' } };

    assert.equal(
      summarizeUploadError(err),
      'POST https://api.test/v1/local-runs/1/results/2/report-url -> 500 {"error":"Internal server error"}',
    );
  });

  it('falls back to the error message for non-axios errors', () => {
    assert.equal(summarizeUploadError(new Error('plain failure')), 'plain failure');
  });

  it('falls back to String() for non-Error, non-axios values', () => {
    assert.equal(summarizeUploadError('weird throw'), 'weird throw');
  });
});

describe('buildStepResultJson', () => {
  function baseStep(overrides: Partial<ReportStep> = {}): ReportStep {
    return {
      stepId: '1',
      description: 'Click login',
      status: 'success',
      duration: 500,
      ...overrides,
    };
  }

  it('includes base fields', () => {
    const result = buildStepResultJson([baseStep()], { '1': 'https://s3/screenshot.png' });
    const step = result['1'] as Record<string, unknown>;
    assert.equal(step.description, 'Click login');
    assert.equal(step.status, 'success');
    assert.equal(step.duration, 500);
    assert.equal(step.screenshotS3Uri, 'https://s3/screenshot.png');
  });

  it('uses error as message when present, falls back to message', () => {
    const withError = buildStepResultJson([baseStep({ error: 'boom', message: 'ok' })], {});
    assert.equal((withError['1'] as Record<string, unknown>).message, 'boom');

    const withMessage = buildStepResultJson([baseStep({ message: 'ok' })], {});
    assert.equal((withMessage['1'] as Record<string, unknown>).message, 'ok');
  });

  it('includes type when present', () => {
    const result = buildStepResultJson([baseStep({ type: 'assert' })], {});
    assert.equal((result['1'] as Record<string, unknown>).type, 'assert');
  });

  it('includes code when present', () => {
    const result = buildStepResultJson([baseStep({ code: 'await page.click("button")' })], {});
    assert.equal((result['1'] as Record<string, unknown>).code, 'await page.click("button")');
  });

  it('includes startTime when present', () => {
    const result = buildStepResultJson([baseStep({ startTime: 1718100000000 })], {});
    assert.equal((result['1'] as Record<string, unknown>).startTime, 1718100000000);
  });

  it('includes autoHealed when true', () => {
    const result = buildStepResultJson([baseStep({ autoHealed: true })], {});
    assert.equal((result['1'] as Record<string, unknown>).autoHealed, true);
  });

  it('includes healedAction when present', () => {
    const healedAction = { action_description: 'Click submit button' };
    const result = buildStepResultJson([baseStep({ healedAction })], {});
    assert.deepEqual((result['1'] as Record<string, unknown>).healedAction, healedAction);
  });

  it('includes the cached action actually selected for execution', () => {
    const cachedAction = {
      action_description: 'Click login',
      locator: "getByTestId('cached-login')",
    };
    const result = buildStepResultJson([baseStep({ cachedAction })], {});

    assert.deepEqual((result['1'] as Record<string, unknown>).cachedAction, cachedAction);
  });

  it('includes dismissedModalActions when non-empty', () => {
    const actions = [{ action_description: 'Dismiss cookie popup' }];
    const result = buildStepResultJson([baseStep({ dismissedModalActions: actions })], {});
    assert.deepEqual((result['1'] as Record<string, unknown>).dismissedModalActions, actions);
  });

  it('includes contextBefore and contextAfter when present', () => {
    const before = { username: 'admin', password: '***' };
    const after = { username: 'admin', password: '***', token: 'abc' };
    const result = buildStepResultJson([baseStep({ contextBefore: before, contextAfter: after })], {});
    const step = result['1'] as Record<string, unknown>;
    assert.deepEqual(step.contextBefore, before);
    assert.deepEqual(step.contextAfter, after);
  });

  it('carries the changed-only snapshot form the reporter records', () => {
    // FR-024: the reporter writes deltas, so the upload must carry them or the
    // cloud loses the variables entirely.
    const result = buildStepResultJson(
      [
        baseStep({
          contextBeforeDelta: { set: { username: 'admin' } },
          contextAfterDelta: { set: { token: 'abc' }, removed: ['username'] },
        }),
      ],
      {},
    );
    const step = result['1'] as Record<string, unknown>;
    assert.deepEqual(step.contextBeforeDelta, { set: { username: 'admin' } });
    assert.deepEqual(step.contextAfterDelta, { set: { token: 'abc' }, removed: ['username'] });
  });

  it('stamps each entry with its recorded position', () => {
    // R2: the cloud reader looks step ids up from actionStepsMap, by phase, as a
    // tree — it never walks resultJson in document order. Without `seq` the
    // delta chain would resolve in whatever order that reader happens to use.
    const result = buildStepResultJson(
      [baseStep({ stepId: 'main.0' }), baseStep({ stepId: 'main.1' }), baseStep({ stepId: 'main.1.2' })],
      {},
    );
    assert.deepEqual(
      Object.entries(result).map(([stepId, entry]) => [stepId, (entry as Record<string, unknown>).seq]),
      [['main.0', 0], ['main.1', 1], ['main.1.2', 2]],
    );
  });

  it('omits optional fields when absent', () => {
    const result = buildStepResultJson([baseStep()], {});
    const step = result['1'] as Record<string, unknown>;
    assert.equal('type' in step, false);
    assert.equal('code' in step, false);
    assert.equal('startTime' in step, false);
    assert.equal('autoHealed' in step, false);
    assert.equal('cachedAction' in step, false);
    assert.equal('healedAction' in step, false);
    assert.equal('dismissedModalActions' in step, false);
    assert.equal('contextBefore' in step, false);
    assert.equal('contextAfter' in step, false);
    assert.equal('contextBeforeDelta' in step, false);
    assert.equal('contextAfterDelta' in step, false);
  });

  it('omits dismissedModalActions when empty array', () => {
    const result = buildStepResultJson([baseStep({ dismissedModalActions: [] })], {});
    assert.equal('dismissedModalActions' in (result['1'] as Record<string, unknown>), false);
  });
});

describe('buildVersionMeta — CLI version in run-level metadata', () => {
  it('includes shiplightVersion for a published build', () => {
    // Regression: run metadata (test_runs.metadata) carried nodeVersion but not
    // the shiplightai runner version, so "which version is this customer on?"
    // required minting a token to read their lockfile instead of a SQL query.
    assert.deepEqual(buildVersionMeta('0.1.92'), { shiplightVersion: '0.1.92' });
  });

  it('omits shiplightVersion for dev builds (undefined) so the "dev" sentinel never lands in an ingested payload', () => {
    assert.deepEqual(buildVersionMeta(undefined), {});
  });
});

describe('sumTestLlmUsage', () => {
  const step = (tokens: number[]): ReportStep =>
    ({
      stepId: 'main.1',
      description: 'x',
      status: 'success',
      llmUsage: tokens.map((t) => ({ model: 'm', promptTokens: t - 10, completionTokens: 10, totalTokens: t })),
    }) as ReportStep;

  it('sums calls and tokens across a single attempt', () => {
    const test = { steps: [step([100, 200]), step([50])] } as unknown as ReportTest;
    assert.deepEqual(sumTestLlmUsage(test), { llmCalls: 3, llmTokens: 350 });
  });

  it('counts every attempt without double-counting the last one', () => {
    // reportTest.steps IS the final attempt's step list, and `attempts` already
    // contains that same final attempt. Reading both would bill the last try
    // twice for every retried test.
    const finalSteps = [step([300])];
    const test = {
      steps: finalSteps,
      attempts: [{ steps: [step([100])] }, { steps: finalSteps }],
    } as unknown as ReportTest;
    assert.deepEqual(sumTestLlmUsage(test), { llmCalls: 2, llmTokens: 400 });
  });

  it('returns zeros for a test that made no model call', () => {
    const test = { steps: [{ stepId: 'main.0', description: 'go', status: 'success' }] } as unknown as ReportTest;
    assert.deepEqual(sumTestLlmUsage(test), { llmCalls: 0, llmTokens: 0 });
  });

  it('tolerates a missing step list', () => {
    assert.deepEqual(sumTestLlmUsage({} as unknown as ReportTest), { llmCalls: 0, llmTokens: 0 });
  });
});

describe('runCapturedLlmUsage', () => {
  const usedStep = (): ReportStep =>
    ({
      stepId: 'main.1',
      description: 'x',
      status: 'success',
      llmUsage: [{ model: 'm', promptTokens: 1, completionTokens: 1, totalTokens: 2 }],
    }) as ReportStep;
  const bareStep = (): ReportStep =>
    ({ stepId: 'main.0', description: 'go', status: 'success' }) as ReportStep;

  it('is true when the run-level summary is present', () => {
    const report = { tests: [], usageSummary: { by_operation: [] } } as unknown as ReportData;
    assert.equal(runCapturedLlmUsage(report), true);
  });

  it('is true from the steps alone when the run-level summary is missing', () => {
    // The gate must not be `reportData.usageSummary` alone: that summary comes
    // from globbing the run's output directories, so a user-supplied outputDir
    // (or a regenerate from another cwd) leaves it undefined while every step
    // still carries real usage off its Playwright attachment. Discarding it
    // would lose the per-test cost permanently — those columns outlive the
    // report artifact.
    const report = { tests: [{ steps: [bareStep(), usedStep()] }] } as unknown as ReportData;
    assert.equal(runCapturedLlmUsage(report), true);
  });

  it('finds usage that only an earlier attempt recorded', () => {
    const report = {
      tests: [{ steps: [bareStep()], attempts: [{ steps: [usedStep()] }, { steps: [bareStep()] }] }],
    } as unknown as ReportData;
    assert.equal(runCapturedLlmUsage(report), true);
  });

  it('is false for a run with no instrumentation anywhere', () => {
    // Only then may the columns be omitted, so the platform stores NULL
    // ("not reported") instead of a fabricated 0.
    const report = { tests: [{ steps: [bareStep()] }] } as unknown as ReportData;
    assert.equal(runCapturedLlmUsage(report), false);
    assert.equal(runCapturedLlmUsage({ tests: [] } as unknown as ReportData), false);
  });
});

describe('uploadableCacheSummary', () => {
  const summary = {
    total_statements: 10,
    original: 4,
    cache_hits: 5,
    healed: 1,
    healed_from_cache: 1,
    failed: 0,
  };

  it('omits the structurally-zero failed bucket', () => {
    // recordFailed() has no production caller, so `failed` is always 0. Sending
    // it would tell the platform "we measured zero failures" when the truth is
    // "we never tracked this" — the same fabricated zero every other field on
    // this payload is careful to omit.
    const uploaded = uploadableCacheSummary(summary);
    assert.equal('failed' in uploaded, false);
  });

  it('preserves every bucket that IS measured', () => {
    assert.deepEqual(uploadableCacheSummary(summary), {
      total_statements: 10,
      original: 4,
      cache_hits: 5,
      healed: 1,
      healed_from_cache: 1,
    });
  });

  it('does not mutate the summary the local report keeps', () => {
    // report-data.json still carries `failed`; only the uploaded shape drops it.
    const input = { ...summary };
    uploadableCacheSummary(input);
    assert.equal(input.failed, 0);
    assert.equal('failed' in input, true);
  });
});

describe('cloudUpload /complete payload — the new metric fields reach the wire', () => {
  // The helpers are unit-tested in isolation above, but nothing asserted the
  // SPREADS that put their output on the HTTP body. Removing either spread would
  // have left every one of those unit tests green while silently dropping the
  // metric from every upload — the same wiring-level failure mode that dropped
  // cacheSummary from `report --merge`, which is why that path got an
  // integration test too.
  async function captureComplete(reportData: ReportData): Promise<Record<string, unknown>> {
    const originalPost = axios.post;
    const originalPut = axios.put;
    let completeBody: Record<string, unknown> | undefined;

    axios.post = (async (url: string) => {
      if (url.endsWith('/report-url')) {
        return { data: { reportUrl: 'https://s3.test/put/report', reportS3Uri: 's3://bucket/report.json' } };
      }
      // create-run: one slot per test, matched by title.
      return {
        data: {
          testRunId: 7,
          testCaseResults: reportData.tests.map((t, i) => ({
            testCaseName: t.title,
            testCaseResultId: 100 + i,
            uploadUrls: { video: '', trace: '', screenshots: {} },
            s3Uris: { video: '', trace: '' },
            screenshotS3Uris: {},
          })),
        },
      };
    }) as typeof axios.post;

    axios.put = (async (url: string, body?: unknown) => {
      if (url.includes('/complete')) completeBody = body as Record<string, unknown>;
      return { data: { reportUrl: 'https://example.test/run/7' } };
    }) as typeof axios.put;

    try {
      await uploadToCloud(reportData, '/tmp/nonexistent', '2026-01-01T00:00:00Z', 'shp_pat_testtoken');
    } finally {
      axios.post = originalPost;
      axios.put = originalPut;
    }
    if (!completeBody) throw new Error('/complete PUT was not invoked');
    return completeBody;
  }

  const testWithUsage = () => ({
    title: 'T',
    file: 't.yaml.spec.ts',
    status: 'passed',
    duration: 1,
    steps: [
      {
        stepId: 'main.0',
        description: 'x',
        status: 'success',
        llmUsage: [
          { model: 'm', promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          { model: 'm', promptTokens: 20, completionTokens: 5, totalTokens: 25 },
        ],
      },
    ],
  });

  it('carries per-test llmCalls/llmTokens on each result', async () => {
    const body = await captureComplete({
      tests: [testWithUsage()],
      totalDuration: 1,
      timestamp: '2026-01-01T00:00:00Z',
    } as unknown as ReportData);

    const results = body.results as Array<Record<string, unknown>>;
    assert.equal(results.length, 1);
    assert.equal(results[0].llmCalls, 2);
    assert.equal(results[0].llmTokens, 40);
  });

  it('omits llmCalls/llmTokens entirely when the run captured no usage', async () => {
    // Omission is what makes the platform store NULL rather than a fabricated 0.
    const body = await captureComplete({
      tests: [{ title: 'T', file: 't.yaml.spec.ts', status: 'passed', duration: 1, steps: [{ stepId: 'main.0', description: 'x', status: 'success' }] }],
      totalDuration: 1,
      timestamp: '2026-01-01T00:00:00Z',
    } as unknown as ReportData);

    const results = body.results as Array<Record<string, unknown>>;
    assert.equal('llmCalls' in results[0], false);
    assert.equal('llmTokens' in results[0], false);
  });

  it('carries cacheSummary on the run-complete PUT, with failed stripped', async () => {
    const body = await captureComplete({
      tests: [],
      totalDuration: 0,
      timestamp: '2026-01-01T00:00:00Z',
      cacheSummary: {
        total_statements: 10,
        original: 4,
        cache_hits: 5,
        healed: 1,
        healed_from_cache: 1,
        failed: 0,
      },
    } as unknown as ReportData);

    assert.deepEqual(body.cacheSummary, {
      total_statements: 10,
      original: 4,
      cache_hits: 5,
      healed: 1,
      healed_from_cache: 1,
    });
  });

  it('omits cacheSummary when the run measured nothing', async () => {
    const body = await captureComplete({
      tests: [],
      totalDuration: 0,
      timestamp: '2026-01-01T00:00:00Z',
    } as unknown as ReportData);

    assert.equal('cacheSummary' in body, false);
  });
});

describe('cloudUpload /complete — optional analytics must never cost the run its finalization', () => {
  // Regression for the upload failure introduced by c16e33aa2 (unreleased —
  // published 0.1.95 predates it and still sends `cacheSummary.failed`):
  //   PUT /v1/local-runs/720/complete -> 400 {"error":"Required"}
  //
  // The platform's schema required `cacheSummary.failed`; this reporter had
  // stopped sending it. The rejection was total — the run never finalized, it
  // stayed `running` in the cloud forever, no report URL was printed, and every
  // per-test report/video/trace already pushed to S3 was orphaned. All of that
  // for an analytics blob that the run's outcome does not depend on.
  //
  // The platform states this rule for itself (a malformed usageSummary is
  // dropped, not rejected) but can only apply it to shapes it anticipated. This
  // is the client-side half: if the platform rejects the body, retry once
  // carrying only the fields run finalization actually needs. A schema skew in
  // an optional metric must degrade to "analytics lost", never to "run lost".
  const ANALYTICS_FIELDS = ['cacheSummary', 'usageSummary', 'modelTierProvenance'];
  const FINALIZATION_FIELDS = ['status', 'endTime', 'totalDuration', 'results'];

  // Carries a real test, not an empty run: the whole point of the fallback is
  // that already-uploaded per-test artifacts stay claimed, so `results` has to
  // be non-empty or every assertion about it compares [] to [].
  function reportWithAnalytics(): ReportData {
    return {
      tests: [
        {
          title: 'checkout flow',
          file: 'checkout.yaml.spec.ts',
          status: 'passed',
          duration: 1234,
          steps: [{ stepId: 'main.0', description: 'open the cart', status: 'success' }],
        },
      ],
      totalDuration: 1234,
      timestamp: '2026-01-01T00:00:00Z',
      cacheSummary: { total_statements: 10, original: 4, cache_hits: 4, healed: 2, failed: 0 },
      usageSummary: {
        by_operation: [
          {
            operation: 'action',
            provider: 'google',
            model: 'gemini-3.5-flash',
            routing: 'proxy',
            calls: 1,
            input_tokens: 10,
            output_tokens: 5,
            thinking_tokens: 0,
            cache_read_tokens: 0,
          },
        ],
      },
      modelTierProvenance: {
        tier: 'standard',
        tierSource: 'org-default',
        mapSource: 'server',
        webagentPrimary: 'google:gemini-3.5-flash',
        computerUsePrimary: 'google:gemini-3-flash-preview',
      },
    } as unknown as ReportData;
  }

  function axiosFailure(status: number | undefined, data?: unknown): Error {
    const err = new Error(`Request failed with status code ${status ?? 'none'}`) as Error & {
      isAxiosError: boolean;
      config: { method: string; url: string };
      response?: { status: number; data: unknown };
    };
    err.isAxiosError = true;
    err.config = { method: 'put', url: '/complete' };
    // No `response` at all models a transport-level axios failure, which is the
    // case that exercises the `err.response?.status` optional chain.
    if (status !== undefined) err.response = { status, data };
    return err;
  }

  const reject400 = () => {
    throw axiosFailure(400, { error: 'Required' });
  };

  type CompleteAttempt = { url: string; body: Record<string, unknown>; config?: AxiosRequestConfig };

  // Drives a full `uploadToCloud`. `onComplete` stands in for the platform's
  // handling of the /complete PUT — it receives the 1-based attempt number and
  // throws to reject, returns to accept. The POST stub is URL-aware so a report
  // with real tests actually gets an S3 URI back; without that the per-test
  // result is silently dropped and `results` arrives empty.
  async function runUpload(
    onComplete: (attempt: number, body: Record<string, unknown>) => void = () => {},
    report: ReportData = reportWithAnalytics(),
  ): Promise<{ attempts: CompleteAttempt[]; warnLines: string[]; threw: unknown }> {
    const originalPost = axios.post;
    const originalPut = axios.put;
    const originalWarn = console.warn;
    const attempts: CompleteAttempt[] = [];
    const warnLines: string[] = [];

    console.warn = (...args: unknown[]) => {
      warnLines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };

    axios.post = (async (url: string) => {
      if (url.includes('/report-url')) {
        return { data: { reportUrl: 'https://s3.test/put/report', reportS3Uri: 's3://bucket/report.json' } };
      }
      return {
        data: {
          testRunId: 720,
          testCaseResults: report.tests.map((test, index) => ({
            testCaseName: test.title,
            testCaseResultId: 900 + index,
            uploadUrls: { video: '', trace: '', screenshots: {} },
            s3Uris: { video: '', trace: '' },
            screenshotS3Uris: {},
          })),
        },
      };
    }) as typeof axios.post;

    axios.put = (async (url: string, body?: unknown, config?: AxiosRequestConfig) => {
      if (!url.includes('/complete')) return { data: {} };
      attempts.push({ url, body: body as Record<string, unknown>, config });
      onComplete(attempts.length, body as Record<string, unknown>);
      return { data: { reportUrl: '/run-results/720' } };
    }) as typeof axios.put;

    let threw: unknown;
    try {
      await uploadToCloud(report, '/tmp/nonexistent', '2026-01-01T00:00:00Z', 'shp_pat_testtoken');
    } catch (err) {
      threw = err;
    } finally {
      axios.post = originalPost;
      axios.put = originalPut;
      console.warn = originalWarn;
    }
    return { attempts, warnLines, threw };
  }

  it('keeps ANALYTICS_FIELDS in step with what the uploader actually sends', async () => {
    // Without this, adding a fourth metric silently drops it out of every
    // assertion below — and the newest field is the likeliest to skew next.
    const { attempts } = await runUpload();
    const sent = Object.keys(attempts[0]!.body).filter((key) => !FINALIZATION_FIELDS.includes(key));
    assert.deepEqual(
      sent.sort(),
      [...ANALYTICS_FIELDS].sort(),
      'the uploader sends a metric this suite does not know about — add it to ANALYTICS_FIELDS',
    );
  });

  it('finalises the run without the analytics fields when the platform rejects them', async () => {
    const { attempts, threw } = await runUpload((attempt) => {
      if (attempt === 1) reject400();
    });

    assert.equal(threw, undefined, 'a rejected analytics blob must not fail the upload');
    assert.equal(attempts.length, 2, 'expected a first attempt with analytics and one retry without');

    const [first, retry] = attempts as [CompleteAttempt, CompleteAttempt];
    for (const field of ANALYTICS_FIELDS) {
      assert.ok(field in first.body, `fixture must actually send ${field} or the drop proves nothing`);
      assert.equal(field in retry.body, false, `retry must not resend ${field}`);
    }

    // The retry still has to be a real completion — status, endTime and the
    // per-test results are what actually flips the run out of `running`.
    assert.equal(retry.url, first.url, 'the retry must target the same completion endpoint');
    assert.equal(retry.body.status, first.body.status);
    assert.equal(retry.body.totalDuration, first.body.totalDuration);
    // endTime is measured once, before the first attempt. Re-clocking it inside
    // the retry would inflate every fallback run's recorded wall-clock by the
    // failed round-trip.
    assert.equal(retry.body.endTime, first.body.endTime, 'the retry must not re-clock endTime');

    const firstResults = first.body.results as Array<Record<string, unknown>>;
    assert.equal(firstResults.length, 1, 'fixture must carry a real per-test result');
    assert.equal(firstResults[0]!.testCaseResultId, 900);
    assert.deepEqual(
      retry.body.results,
      first.body.results,
      'every artifact already pushed to S3 must still be claimed by the retry',
    );

    // A retry that lost the bearer token would 401 and strand the run — the
    // exact outcome this fallback exists to prevent.
    const authOf = (attempt: CompleteAttempt) => (attempt.config?.headers as Record<string, string> | undefined)?.Authorization;
    assert.match(String(authOf(first)), /^Bearer shp_pat_/);
    assert.equal(authOf(retry), authOf(first), 'the retry must be authenticated like the first attempt');
  });

  it('warns loudly that the metrics were dropped, naming both the rejection and the fields', async () => {
    // Silently degrading would hide the contract skew until someone noticed the
    // cache columns were all NULL. The run survives; the skew must still surface,
    // and it has to name WHICH metric drifted or the warning is undiagnosable.
    const { warnLines } = await runUpload((attempt) => {
      if (attempt === 1) reject400();
    });

    const line = warnLines.find((entry) => entry.includes('Retrying without'));
    assert.ok(line, `expected a "Retrying without" line, got: ${JSON.stringify(warnLines)}`);
    for (const field of ANALYTICS_FIELDS) {
      assert.ok(line.includes(field), `the warning must name ${field}`);
    }
    assert.ok(line.includes('400') && line.includes('Required'), 'the warning must echo the platform rejection');
  });

  it('does not retry when the first attempt succeeds', async () => {
    // The retry is a fallback, not a second upload on the happy path.
    const { attempts, threw } = await runUpload();

    assert.equal(threw, undefined);
    assert.equal(attempts.length, 1);
    assert.ok('cacheSummary' in attempts[0]!.body, 'the happy path still uploads the metrics');
  });

  for (const status of [500, 401, 404]) {
    it(`does not retry a ${status} — only a 400 means the body was rejected`, async () => {
      // Retrying these buys a second full PUT that cannot succeed, and tells the
      // user their metrics are at fault when the real problem is an outage or an
      // expired token.
      const { attempts, warnLines, threw } = await runUpload((attempt) => {
        if (attempt === 1) throw axiosFailure(status, { error: 'nope' });
      });

      assert.equal(attempts.length, 1, `status ${status} must not be retried`);
      assert.ok(threw, `status ${status} must propagate`);
      assert.deepEqual(
        warnLines.filter((line) => line.includes('Retrying without')),
        [],
        'must not claim metrics were dropped when nothing was dropped',
      );
    });
  }

  it('does not retry a transport failure that carries no response at all', async () => {
    // Exercises the `err.response?.status` optional chain: a socket-level axios
    // error has no `response`, so the schema-rejection gate must read false.
    const { attempts, threw } = await runUpload((attempt) => {
      if (attempt === 1) throw axiosFailure(undefined);
    });

    assert.equal(attempts.length, 1);
    assert.ok(threw);
  });

  it('rethrows without retrying when the body carried no analytics at all', async () => {
    // Nothing to drop means the retry would re-send a byte-identical body for
    // the same 400 — a guaranteed-useless duplicate PUT, and a warning naming no
    // fields whatsoever.
    const { attempts, warnLines, threw } = await runUpload(reject400, emptyReport());

    assert.equal(attempts.length, 1, 'nothing to drop -> nothing to retry');
    assert.ok(threw, 'a 400 with no analytics in the body is a real error');
    assert.deepEqual(
      warnLines.filter((line) => line.includes('Retrying without')),
      [],
      'must not claim metrics were lost when none were sent',
    );
  });

  it('gives up after exactly one retry, and reports both rejections when the retry fails too', async () => {
    // Happens when the 400 came from `finalization` itself. The first rejection
    // is the one whose body names the offending field, so it must not be lost.
    const { attempts, threw } = await runUpload((attempt) => {
      if (attempt === 1) reject400();
      throw axiosFailure(400, { error: 'Invalid enum value at results.0.result' });
    });

    assert.equal(attempts.length, 2, 'exactly one retry — never a loop');
    assert.ok(threw instanceof Error);
    assert.match(threw.message, /Required/, 'the first rejection must survive');
    assert.match(threw.message, /Invalid enum value/, "the retry's rejection must be reported too");
    assert.ok(threw.cause, 'the retry error must be chained as cause');
  });
});

// ---------------------------------------------------------------------------
// CI detection + trigger resolution
// ---------------------------------------------------------------------------

// Every env var these tests care about. They must all be cleared before each
// case: the suite itself runs under GitHub Actions in CI, so a leaked
// GITHUB_ACTIONS would make the "no CI detected" assertions pass locally and
// fail on the very provider they describe. SHIPLIGHT_TRIGGER is listed even
// though the code no longer reads it — the tests below set it deliberately to
// prove it is ignored, which only means something from a known-clean baseline.
const TRIGGER_ENV_VARS = ['GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'SHIPLIGHT_TRIGGER'] as const;

/** Clear the CI vars, apply `overrides`, and return a restore function. */
function pushCleanCiEnv(overrides: Record<string, string>): () => void {
  const saved = new Map<string, string | undefined>();
  for (const key of TRIGGER_ENV_VARS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function withCleanCiEnv<T>(overrides: Record<string, string>, fn: () => T): T {
  const restore = pushCleanCiEnv(overrides);
  try {
    return fn();
  } finally {
    restore();
  }
}

describe('cloudUpload detectCi', () => {
  const { detectCi } = __testing;

  it('maps GitHub Actions to the GITHUB_ACTION trigger, not the display label', () => {
    // Regression: the CLI used to send 'GitHub Action', which the cloud's exact
    // `in ("trigger", ...)` filter never matches.
    assert.deepEqual(detectCi({ GITHUB_ACTIONS: 'true' }), {
      trigger: 'GITHUB_ACTION',
      label: 'GitHub Action',
    });
  });

  it('maps GitLab CI to GITLAB_CI', () => {
    assert.deepEqual(detectCi({ GITLAB_CI: 'true' }), { trigger: 'GITLAB_CI', label: 'GitLab CI' });
  });

  it('maps CircleCI to CIRCLECI', () => {
    assert.deepEqual(detectCi({ CIRCLECI: 'true' }), { trigger: 'CIRCLECI', label: 'CircleCI' });
  });

  it('falls back to Local when no supported provider is present', () => {
    assert.deepEqual(detectCi({}), { trigger: 'Local', label: 'Local' });
  });

  it('files an undetectable CI provider as Local', () => {
    // Jenkins/Buildkite/etc. — the reason --trigger exists.
    assert.deepEqual(detectCi({ JENKINS_URL: 'https://jenkins.example', BUILDKITE: 'true' }), {
      trigger: 'Local',
      label: 'Local',
    });
  });

  it('prefers GitHub Actions when several provider vars are set', () => {
    // Detection order is fixed, so a nested/emulated environment stays stable.
    assert.equal(detectCi({ GITHUB_ACTIONS: 'true', GITLAB_CI: 'true', CIRCLECI: 'true' }).trigger, 'GITHUB_ACTION');
  });

  it('ignores provider vars set to an empty string', () => {
    assert.equal(detectCi({ GITHUB_ACTIONS: '' }).trigger, 'Local');
  });

  it('never returns a trigger that the cloud enum cannot represent', () => {
    // Mirrors TestRunTrigger in packages/common/constants.ts. If a provider is
    // added here without an enum member, its runs become unfilterable.
    const known = new Set(['GITHUB_ACTION', 'GITLAB_CI', 'CIRCLECI', 'Local']);
    for (const env of [{ GITHUB_ACTIONS: '1' }, { GITLAB_CI: '1' }, { CIRCLECI: '1' }, {}]) {
      assert.ok(known.has(detectCi(env).trigger), `unexpected trigger for ${JSON.stringify(env)}`);
    }
  });
});

describe('cloudUpload resolveTrigger', () => {
  const { resolveTrigger } = __testing;

  it('uses auto-detection when nothing is overridden', () => {
    assert.equal(resolveTrigger(undefined, { CIRCLECI: 'true' }), 'CIRCLECI');
  });

  it('lets an explicit override replace a detected provider', () => {
    assert.equal(resolveTrigger('Nightly', { GITHUB_ACTIONS: 'true' }), 'Nightly');
  });

  it('accepts an arbitrary provider name for CI we cannot detect', () => {
    assert.equal(resolveTrigger('Buildkite', {}), 'Buildkite');
  });

  it('ignores SHIPLIGHT_TRIGGER — --trigger is the only override', () => {
    // Deliberately unsupported: an env var would let a run be filed under a
    // trigger that is invisible in the command that produced it.
    assert.equal(resolveTrigger(undefined, { SHIPLIGHT_TRIGGER: 'Jenkins' }), 'Local');
  });

  it('ignores SHIPLIGHT_TRIGGER even when it would beat detection', () => {
    assert.equal(resolveTrigger(undefined, { SHIPLIGHT_TRIGGER: 'Jenkins', GITHUB_ACTIONS: 'true' }), 'GITHUB_ACTION');
  });

  it('trims surrounding whitespace from an override', () => {
    assert.equal(resolveTrigger('  Jenkins  ', {}), 'Jenkins');
  });

  it('falls back to detection when the override is blank', () => {
    // A CI expression that evaluated to nothing must not blank out the trigger.
    assert.equal(resolveTrigger('   ', { GITLAB_CI: 'true' }), 'GITLAB_CI');
  });

  it('falls back to detection when the override is undefined', () => {
    assert.equal(resolveTrigger(undefined, { GITHUB_ACTIONS: 'true' }), 'GITHUB_ACTION');
  });
});

describe('cloudUpload collectMetadata — ciProvider label', () => {
  const { collectMetadata, detectCi } = __testing;

  // ciProvider is hoisted out of the per-provider branches; these guard against
  // a branch losing its label, which would render the run's build link as "CI".
  for (const [envVar, expected] of [
    ['GITHUB_ACTIONS', 'GitHub Action'],
    ['GITLAB_CI', 'GitLab CI'],
    ['CIRCLECI', 'CircleCI'],
  ] as const) {
    it(`labels a ${expected} run as "${expected}"`, () => {
      const meta = withCleanCiEnv({ [envVar]: 'true' }, () => collectMetadata());
      assert.equal(meta.ciProvider, expected);
    });
  }

  it('labels a run with no detected provider as "Local"', () => {
    const meta = withCleanCiEnv({}, () => collectMetadata());
    assert.equal(meta.ciProvider, 'Local');
  });

  it('keeps the label in step with the detected trigger', () => {
    const meta = withCleanCiEnv({ GITHUB_ACTIONS: 'true' }, () => collectMetadata());
    assert.equal(meta.ciProvider, detectCi({ GITHUB_ACTIONS: 'true' }).label);
  });
});

/**
 * Capture the create-run POST body, JSON round-tripped so assertions see what
 * the backend actually receives rather than the in-memory object: keys whose
 * value is `undefined` are dropped by `JSON.stringify`, and a test that reads
 * the raw object cannot tell an absent field from an undefined one.
 *
 * Shared by every create-run payload assertion — nine near-identical
 * axios monkey-patch helpers had accumulated in this file, so any change to
 * `uploadToCloud`'s request sequence had to be mirrored nine times.
 */
async function captureCreateRunBody(
  reportData: ReportData,
  options: {
    triggerOverride?: string;
    env?: Record<string, string>;
    testCaseResults?: (tests: ReportTest[]) => unknown[];
  } = {},
): Promise<Record<string, unknown>> {
  const originalPost = axios.post;
  const originalPut = axios.put;
  let body: Record<string, unknown> | undefined;

  axios.post = (async (url: string, payload?: unknown) => {
    if (url.endsWith('/v1/local-runs')) body ??= payload as Record<string, unknown>;
    return {
      data: {
        testRunId: 3,
        testCaseResults: options.testCaseResults?.(reportData.tests) ?? [],
      },
    };
  }) as typeof axios.post;
  axios.put = (async () => ({ data: { reportUrl: 'https://example.test/run/3' } })) as typeof axios.put;

  // Restore the env only after the upload settles — withCleanCiEnv's finally
  // would fire on the returned promise, not on its resolution.
  const restoreEnv = pushCleanCiEnv(options.env ?? {});
  try {
    await uploadToCloud(
      reportData,
      '/tmp/nonexistent',
      '2026-01-01T00:00:00Z',
      'shp_pat_testtoken',
      options.triggerOverride,
    );
  } finally {
    restoreEnv();
    axios.post = originalPost;
    axios.put = originalPut;
  }

  if (!body) throw new Error('create-run POST was not invoked');
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

describe('cloudUpload uploadToCloud — trigger in the create-run payload', () => {
  async function captureTrigger(triggerOverride?: string, env: Record<string, string> = {}): Promise<unknown> {
    const body = await captureCreateRunBody(emptyReport(), { triggerOverride, env });
    return body.trigger;
  }

  it('sends the detected trigger when nothing is overridden', async () => {
    assert.equal(await captureTrigger(undefined, { GITHUB_ACTIONS: 'true' }), 'GITHUB_ACTION');
  });

  it('sends Local for a developer machine', async () => {
    assert.equal(await captureTrigger(), 'Local');
  });

  it('sends the --trigger override verbatim', async () => {
    assert.equal(await captureTrigger('Jenkins'), 'Jenkins');
  });

  it('does not let SHIPLIGHT_TRIGGER stand in for the flag', async () => {
    assert.equal(await captureTrigger(undefined, { SHIPLIGHT_TRIGGER: 'TeamCity' }), 'Local');
  });

  it('no longer sends the human-readable label as the trigger', async () => {
    // The bug this replaces: trigger and metadata.ciProvider were the same
    // string, so the cloud stored 'GitHub Action' in an enum column.
    assert.notEqual(await captureTrigger(undefined, { GITHUB_ACTIONS: 'true' }), 'GitHub Action');
  });
});

describe('cloudUpload — tags in the create-run payload', () => {
  // The uploaded test list is the only channel carrying tags to the cloud, so
  // assert on the serialized POST body rather than on the ReportTest shape.
  async function captureUploadedTests(tests: ReportTest[]): Promise<Array<Record<string, unknown>>> {
    const body = await captureCreateRunBody(
      { tests, totalDuration: 0, timestamp: '2026-01-01T00:00:00Z' },
      {
        testCaseResults: (ts) =>
          ts.map((t, i) => ({
            testCaseName: t.title,
            testCaseResultId: i + 1,
            uploadUrls: { video: '', trace: '', screenshots: {} },
            s3Uris: { video: '', trace: '' },
            screenshotS3Uris: {},
          })),
      },
    );
    return body.tests as Array<Record<string, unknown>>;
  }

  function taggedTest(tags?: string[]): ReportTest {
    return {
      title: 'checkout works',
      file: 'tests/checkout.yaml.spec.ts',
      status: 'passed',
      duration: 100,
      steps: [],
      ...(tags ? { tags } : {}),
    };
  }

  it('uploads the tags with their @ prefix, as Playwright reports them', async () => {
    // `TestCase.tags` keeps the `@`, so a name copied out of the cloud pastes
    // straight back into `npx playwright test --grep`.
    const [uploaded] = await captureUploadedTests([taggedTest(['@auth', '@smoke'])]);
    assert.deepEqual(uploaded.tags, ['@auth', '@smoke']);
  });

  it('sends no tags key at all when the test has none', async () => {
    // Asserted on the serialized body: `JSON.stringify` drops undefined-valued
    // keys, so this is the shape the backend really receives.
    const [uploaded] = await captureUploadedTests([taggedTest()]);
    assert.equal('tags' in uploaded, false);
  });

  it('sends no suiteTags key — suite tags arrive merged into tags', async () => {
    // Playwright merges describe-level tags into `TestCase.tags`, so the report
    // has one flat list and the second field is gone.
    const [uploaded] = await captureUploadedTests([taggedTest(['@auth'])]);
    assert.equal('suiteTags' in uploaded, false);
  });
});

describe('buildReportV2 — console output per attempt', () => {
  // This is the last mile of the bug this change fixes: the reporter can carry
  // stdout/stderr correctly and still upload nothing if the mapping here is
  // wrong. buildReportV2 has one production call site and was unreachable from
  // any test, so a swapped precedence would reproduce the bug undetected.
  function attempt(overrides: Partial<ReportAttempt> = {}): ReportAttempt {
    return { attemptNumber: 1, status: 'passed', duration: 10, steps: [], ...overrides };
  }

  function segmentsOf(test: ReportTest): Array<Record<string, unknown>> {
    const report = buildReportV2(test, {}, {}, {}) as { segments: Array<Record<string, unknown>> };
    return report.segments;
  }

  function retriedTest(attempts: ReportAttempt[], overrides: Partial<ReportTest> = {}): ReportTest {
    return {
      title: 'checkout works',
      file: 'tests/checkout.yaml.spec.ts',
      status: 'passed',
      duration: 10,
      steps: [],
      attempts,
      ...overrides,
    };
  }

  it('declares schemaVersion 3, the version that may carry changed-only snapshots', () => {
    const report = buildReportV2(retriedTest([attempt()]), {}, {}, {}) as { schemaVersion: number };
    assert.equal(report.schemaVersion, 3);
  });

  it('gives each attempt its own captured output', async () => {
    const segments = segmentsOf(
      retriedTest(
        [
          attempt({ attemptNumber: 1, status: 'failed', stdout: 'first run', stderr: 'boom' }),
          attempt({ attemptNumber: 2, stdout: 'second run' }),
        ],
        { stdout: 'second run' },
      ),
    );

    assert.equal(segments[0].stdout, 'first run');
    assert.equal(segments[0].stderr, 'boom');
    assert.equal(segments[1].stdout, 'second run');
  });

  it('falls back to the test-level capture for the final attempt', async () => {
    // Report JSON written before ReportAttempt carried these fields still has
    // the final attempt's output at the test level; it must not regress to ''.
    const segments = segmentsOf(
      retriedTest(
        [attempt({ attemptNumber: 1, status: 'failed' }), attempt({ attemptNumber: 2 })],
        { stdout: 'from the test level', stderr: 'stderr too' },
      ),
    );

    assert.equal(segments[1].stdout, 'from the test level');
    assert.equal(segments[1].stderr, 'stderr too');
  });

  it('sends an empty string for a silent non-final attempt', async () => {
    // Deliberate: every segment has always carried both keys, and the backend
    // schema is not ours to change from here. captureConsoleOutput returns
    // undefined for a silent attempt, and it lands as '' rather than absent.
    const segments = segmentsOf(
      retriedTest([attempt({ attemptNumber: 1, status: 'failed' }), attempt({ attemptNumber: 2 })]),
    );

    assert.equal(segments[0].stdout, '');
    assert.equal(segments[0].stderr, '');
  });

  it('uses the test-level capture for a test that never retried', async () => {
    const segments = segmentsOf({
      title: 'checkout works',
      file: 'tests/checkout.yaml.spec.ts',
      status: 'passed',
      duration: 10,
      steps: [],
      stdout: 'only run',
      stderr: 'only stderr',
    });

    assert.equal(segments.length, 1);
    assert.equal(segments[0].stdout, 'only run');
    assert.equal(segments[0].stderr, 'only stderr');
  });
});
