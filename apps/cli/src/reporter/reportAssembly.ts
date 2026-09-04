/**
 * Assembly of the per-attempt build results into the one `ReportTest` that
 * reaches report-data.json and the cloud upload.
 *
 * This used to be an inline object literal that named each field it wanted off
 * the last attempt's build. That shape silently drops any field the builder
 * learns to set but nobody remembers to add here, and it did so twice: suite
 * tags (parked in a `suiteTags` field nothing copied, so they never shipped)
 * and `stdout`/`stderr` (captured from the Playwright result, dropped here, so
 * `cloudUpload` uploaded `''` for every test). Spreading the builder's own
 * object makes carry-over the default and overriding the deliberate act.
 */

import type { ReportAttempt, ReportTest } from './template.js';

export interface AssembleReportTestInput {
  /** Build result for the final attempt — the source of every derived field. */
  lastBuilder: ReportTest | undefined;
  /** Every attempt in order; the last one supplies the headline result. */
  builtAttempts: ReportAttempt[];
  /** Title of the final attempt's `TestCase`. */
  title: string;
  /** Spec path, already made relative to the working directory. */
  file: string;
  /** Start of the *first* attempt, so a retried test spans all of them. */
  startTime?: string;
  /** End of the final attempt. */
  endTime?: string;
}

/**
 * Fold the attempts into a single reported test.
 *
 * `retries`/`attempts` appear only when the test actually retried, and `flaky`
 * only when an earlier attempt failed and the last one passed — a test that
 * failed every attempt is a failure, not a flake.
 */
export function assembleReportTest({
  lastBuilder,
  builtAttempts,
  title,
  file,
  startTime,
  endTime,
}: AssembleReportTestInput): ReportTest {
  const last = builtAttempts[builtAttempts.length - 1];

  const reportTest: ReportTest = {
    // Carries every field the builder derived — YAML enrichment (tags, baseUrl,
    // skip/slow/timeout, suiteName, parameterSetName, actionStepsMap) plus the
    // captured stdout/stderr. Overrides below are the fields whose value comes
    // from the attempt sequence rather than from the final attempt alone.
    ...lastBuilder,
    title,
    file,
    status: last.status,
    duration: last.duration,
    steps: last.steps,
    error: last.error,
    videoPath: last.videoPath,
    tracePath: last.tracePath,
    startTime,
    endTime,
  };

  if (builtAttempts.length > 1) {
    reportTest.retries = builtAttempts.length - 1;
    reportTest.attempts = builtAttempts;
    const hadFailure = builtAttempts.some((a) => a.status === 'failed' || a.status === 'timedOut');
    if (hadFailure && last.status === 'passed') {
      reportTest.flaky = true;
    }
  }

  return reportTest;
}
