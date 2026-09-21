/**
 * Cloud upload logic for the Shiplight reporter.
 *
 * After the local HTML report is generated, this module:
 *  1. Collects CI/git metadata from environment variables
 *  2. Creates a local run record via POST /v1/local-runs (pre-builds TestRun +
 *     TestCaseResult + TestSuiteResult records, returns presigned S3 URLs)
 *  3. Uploads all assets (screenshots, video, trace) directly to S3
 *  4. Builds a ReportV2 JSON (the ReportV2 schema the v1 runner produced) and uploads it
 *  5. Completes either the legacy run or one idempotent shard batch
 *  6. For a shard, attempts finalization; the last completed shard succeeds
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { resolveApiBase, UNSUPPORTED_TOKEN_MESSAGE } from '../cloudApiBase.js';
import { PUBLISHED_VERSION } from '../versionCheck.js';
import type { ReportData, ReportTest, ReportStep } from './template.js';
import type { RunCacheSummary } from 'shiplight-types';

// ---------------------------------------------------------------------------
// Types (LocalRun* shapes; shiplight-client held the original definitions
// until it was deleted in August 2026 — these are now the only copy)
// ---------------------------------------------------------------------------

interface LocalRunTest {
  clientTestId: string;
  testCaseName: string;
  testCaseBaseName?: string;
  suiteName?: string;
  file?: string;
  tags?: string[];
  baseUrl?: string;
  skip?: boolean | string;
  slow?: boolean;
  timeout?: number;
  parameterSetName?: string;
  flaky?: boolean;
  retries?: number;
  videoMd5?: string;
  traceMd5?: string;
}

interface LocalRunUploadUrls {
  video: string;
  trace: string;
  screenshots: Record<string, string>;
}

interface LocalRunTestCaseResultSlot {
  testCaseName: string;
  testCaseResultId: number;
  uploadUrls: LocalRunUploadUrls;
  s3Uris: { video: string; trace: string };
  screenshotS3Uris: Record<string, string>;
}

interface LocalRunResponse {
  testRunId: number;
  testCaseResults: LocalRunTestCaseResultSlot[];
}

interface LocalRunTestResult {
  testCaseResultId: number;
  result: string;
  durationMs: number;
  startTime?: string;
  endTime?: string;
  error?: string;
  reportS3Uri: string;
  videoS3Uri?: string;
  traceS3Uri?: string;
  metadata?: Record<string, unknown>;
  /**
   * Per-test LLM totals across every attempt. Omitted entirely when this run
   * captured no usage at all, so the platform stores NULL ("not reported")
   * rather than a fabricated 0.
   */
  llmCalls?: number;
  llmTokens?: number;
}

/**
 * Sum a test's LLM calls and tokens across EVERY attempt.
 *
 * The platform stores these on the test result so per-test cost survives the
 * report artifact, which object retention will eventually delete — after that
 * these columns are the only per-test record left.
 *
 * `test.steps` IS the final attempt's step list, and `test.attempts` (populated
 * only when a retry happened) already includes that same final attempt — so
 * reading both would double-count the last try of every retried test. Prefer
 * `attempts` when present, and fall back to `steps` for the single-attempt case.
 *
 * One `llmUsage` record is one model call, matching how the run-level
 * by-operation summary counts them. The two are aggregated from the same
 * `ai-actions.json` records — per-test off each test's attachment, run-level off
 * the run's output directories — so they agree as long as both see the same run;
 * see `aggregateRunUsageSummary` for why that scoping had to be made explicit.
 */
function sumTestLlmUsage(test: ReportTest): { llmCalls: number; llmTokens: number } {
  const stepSets = test.attempts?.length ? test.attempts.map((a) => a.steps) : [test.steps];
  let llmCalls = 0;
  let llmTokens = 0;
  for (const steps of stepSets) {
    for (const step of steps ?? []) {
      for (const record of step.llmUsage ?? []) {
        llmCalls += 1;
        llmTokens += record.totalTokens ?? 0;
      }
    }
  }
  return { llmCalls, llmTokens };
}

/**
 * Strip `failed` from the cache summary before it is uploaded.
 *
 * `CacheMetadataCollector.recordFailed()` has no production caller — there is no
 * statement-UID channel from runtime step results back to the reporter, and
 * `(file, stepId)` is ambiguous inside a suite because stepIds restart per test.
 * So the bucket is structurally 0, and sending it would tell the platform "we
 * measured zero failures" when the truth is "we never tracked this" — the same
 * fabricated zero every other field here is careful to omit. A stale entity that
 * could not self-heal stays counted in `cache_hits`; that is a known gap, but it
 * should not also be dressed up as a clean measurement.
 *
 * Put `failed` back in the payload once `recordFailed` has a production caller.
 * The local report keeps the field, so nothing downstream of report-data.json
 * changes shape.
 */
function uploadableCacheSummary(summary: RunCacheSummary): Omit<RunCacheSummary, 'failed'> {
  const { failed: _failed, ...uploadable } = summary;
  return uploadable;
}

/**
 * Whether this run captured LLM usage at all — the gate for reporting per-test
 * totals, since a run with no instrumentation must store NULL rather than a
 * fabricated 0 for every test.
 *
 * Deliberately NOT `reportData.usageSummary` alone. That summary is aggregated
 * by globbing the run's output directories, while the per-test numbers come off
 * each test's Playwright attachment — so any run whose output directory the
 * glob cannot see (a user-supplied `outputDir`, a regenerate from a different
 * cwd) would discard real, present per-test usage. Per the field's docstring
 * those columns outlive the report artifact, so the data would be lost, not
 * merely unreported. The report's own steps are the authority; the run-level
 * summary only broadens the gate for the case where steps carry no usage but
 * the run demonstrably made calls.
 */
function runCapturedLlmUsage(reportData: ReportData): boolean {
  if (reportData.usageSummary) return true;
  for (const test of reportData.tests) {
    const stepSets = test.attempts?.length ? test.attempts.map((a) => a.steps) : [test.steps];
    for (const steps of stepSets) {
      for (const step of steps ?? []) {
        if (step.llmUsage?.length) return true;
      }
    }
  }
  return false;
}

interface CloudUploadConcurrency {
  maxConcurrentPutUploads: number;
  // True only when SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS was set AND valid (so the
  // config log never attributes a fallback-to-default value to the env var).
  maxConcurrentPutUploadsFromEnv: boolean;
  screenshotUrlRequestWorkers: number;
  testUploadWorkers: number;
  perTestAssetWorkers: number;
}

// ---------------------------------------------------------------------------
// Metadata collection
// ---------------------------------------------------------------------------

/**
 * Convert a git remote URL (HTTPS or SSH) to its HTTPS web base URL.
 * e.g. git@github.com:owner/repo.git → https://github.com/owner/repo
 *      https://github.com/owner/repo.git → https://github.com/owner/repo
 */
function gitRemoteToWebUrl(remoteUrl: string): string | undefined {
  // SSH format: git@host:path.git
  const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`;
  // HTTPS format: https://host/path.git
  const httpsMatch = remoteUrl.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return `https://${httpsMatch[1]}/${httpsMatch[2]}`;
  return undefined;
}

/** Run a git command and return trimmed stdout, or undefined on failure. */
function tryGit(...args: string[]): string | undefined {
  try {
    const out = execFileSync('git', args, { stdio: ['pipe', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read and parse the GitHub Actions event payload JSON file.
 * Returns an empty object on any failure (missing file, parse error, etc.).
 */
function readGithubEventPayload(): Record<string, unknown> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return {};
  try {
    const raw = fs.readFileSync(eventPath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Version fields for run-level metadata. `shiplightVersion` is the published
 * CLI version, so the platform can record which runner produced a run
 * (persisted verbatim into `test_runs.metadata`, queryable via
 * `metadata->>'shiplightVersion'`). Omitted for dev builds where
 * `PUBLISHED_VERSION` is undefined — matching the stdout banner and HTML
 * footer, we never stamp the "dev" sentinel into an ingested payload.
 */
function buildVersionMeta(publishedVersion: string | undefined): Record<string, string> {
  return publishedVersion ? { shiplightVersion: publishedVersion } : {};
}

/**
 * CI providers the CLI can detect from environment variables, in match order.
 *
 * `trigger` is stored in `test_runs.trigger` and MUST match `TestRunTrigger` in
 * `packages/common/constants.ts` — the cloud filters runs with an exact
 * `in ("trigger", ...)` match, so a value that merely looks right (the old
 * 'GitHub Action' vs `GITHUB_ACTION`) drops the run out of every filter.
 * `label` is the human-readable name kept in `metadata.ciProvider`, which the
 * UI shows as free text and never matches against an enum.
 */
const CI_PROVIDERS = [
  { envVar: 'GITHUB_ACTIONS', trigger: 'GITHUB_ACTION', label: 'GitHub Action' },
  { envVar: 'GITLAB_CI', trigger: 'GITLAB_CI', label: 'GitLab CI' },
  { envVar: 'CIRCLECI', trigger: 'CIRCLECI', label: 'CircleCI' },
] as const;

/** Used when no supported CI provider is detected — a dev box, or a CI we can't see. */
const LOCAL_CI = { trigger: 'Local', label: 'Local' };

interface DetectedCi {
  trigger: string;
  label: string;
}

function detectCi(env: NodeJS.ProcessEnv = process.env): DetectedCi {
  const match = CI_PROVIDERS.find((provider) => env[provider.envVar]);
  return match ? { trigger: match.trigger, label: match.label } : { ...LOCAL_CI };
}

/**
 * Resolve the run's `trigger`: the explicit `--trigger` value when given,
 * otherwise auto-detection. There is deliberately no env-var form — `--trigger`
 * is the single way to override, so the value a run was filed under is always
 * visible in the command that produced it.
 *
 * Overrides are free-form on purpose. `test_runs.trigger` is a plain text
 * column, and detection covers three providers out of the many users run on —
 * a Jenkins or Buildkite run would otherwise be filed as `Local`. Values
 * outside `TestRunTrigger` still display correctly in the cloud UI; they just
 * can't be picked from the trigger filter dropdown.
 */
function resolveTrigger(override: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  return override?.trim() || detectCi(env).trigger;
}

function collectMetadata(): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    nodeVersion: process.version,
    // Set once from the same detection the trigger uses, so the label and the
    // trigger can never disagree about which provider produced the run.
    ciProvider: detectCi().label,
    ...buildVersionMeta(PUBLISHED_VERSION),
  };

  if (process.env.GITHUB_ACTIONS) {
    const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
    const repo = process.env.GITHUB_REPOSITORY ?? '';
    const runId = process.env.GITHUB_RUN_ID ?? '';
    const eventName = process.env.GITHUB_EVENT_NAME ?? '';

    // Read event payload for pull_request events (has pull_request.title and head SHA)
    const eventPayload = readGithubEventPayload();
    const pr = eventPayload.pull_request as Record<string, unknown> | undefined;

    // Commit SHA: SHIPLIGHT_GIT_SHA overrides GITHUB_SHA (useful for repository_dispatch where
    // GITHUB_SHA is the default-branch SHA, not the PR commit).
    const prHeadSha = (pr?.head as Record<string, unknown> | undefined)?.sha as string | undefined;
    const sha = process.env.SHIPLIGHT_GIT_SHA ?? prHeadSha ?? process.env.GITHUB_SHA ?? '';

    // PR number: explicit override > GITHUB_PR_NUMBER > parsed from GITHUB_REF
    const ref = process.env.GITHUB_REF ?? '';
    const prNumber =
      process.env.SHIPLIGHT_PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? ref.match(/^refs\/pull\/(\d+)\//)?.[1];

    // Branch: explicit override > GITHUB_HEAD_REF (pull_request events) > GITHUB_REF_NAME
    const gitBranch = (process.env.SHIPLIGHT_GIT_BRANCH ?? process.env.GITHUB_HEAD_REF) || process.env.GITHUB_REF_NAME;

    // PR title: explicit override > event payload pull_request.title
    const prTitle = process.env.SHIPLIGHT_PR_TITLE ?? (pr?.title as string | undefined);

    const commitMessage = tryGit('log', '-1', '--pretty=%s');
    const authorEmail = tryGit('log', '-1', '--pretty=%ae');

    Object.assign(meta, {
      gitCommit: sha,
      gitBranch,
      gitRepo: repo,
      commitMessage,
      authorEmail,
      prNumber,
      prTitle,
      prUrl: prNumber && repo ? `${serverUrl}/${repo}/pull/${prNumber}` : undefined,
      ciBuildId: runId,
      ciBuildUrl: runId && repo ? `${serverUrl}/${repo}/actions/runs/${runId}` : undefined,
      commitUrl: sha && repo ? `${serverUrl}/${repo}/commit/${sha}` : undefined,
      triggeredBy: process.env.GITHUB_ACTOR,
      eventName,
      workflow: process.env.GITHUB_WORKFLOW,
    });
  } else if (process.env.GITLAB_CI) {
    const projectUrl = process.env.CI_PROJECT_URL ?? '';
    const sha = process.env.CI_COMMIT_SHA ?? '';
    const mrIid = process.env.CI_MERGE_REQUEST_IID;
    // CI_COMMIT_AUTHOR_EMAIL is the commit author; GITLAB_USER_EMAIL is the pipeline trigger user
    const authorEmail = process.env.CI_COMMIT_AUTHOR_EMAIL ?? process.env.GITLAB_USER_EMAIL;
    // CI_PROJECT_PATH is "namespace/project" (e.g. "owner/repo")
    const gitRepo = process.env.CI_PROJECT_PATH;
    Object.assign(meta, {
      gitCommit: sha,
      gitBranch: process.env.CI_COMMIT_REF_NAME,
      gitRepo,
      commitMessage: process.env.CI_COMMIT_MESSAGE,
      authorEmail,
      prNumber: mrIid,
      prTitle: process.env.CI_MERGE_REQUEST_TITLE,
      prUrl: mrIid && projectUrl ? `${projectUrl}/-/merge_requests/${mrIid}` : undefined,
      ciBuildId: process.env.CI_PIPELINE_ID,
      ciBuildUrl: process.env.CI_PIPELINE_URL,
      commitUrl: sha && projectUrl ? `${projectUrl}/commit/${sha}` : undefined,
      triggeredBy: process.env.GITLAB_USER_LOGIN,
    });
  } else if (process.env.CIRCLECI) {
    const sha = process.env.CIRCLE_SHA1 ?? '';
    const circleUsername = process.env.CIRCLE_PROJECT_USERNAME ?? '';
    const circleReponame = process.env.CIRCLE_PROJECT_REPONAME ?? '';
    const gitRepo = circleUsername && circleReponame ? `${circleUsername}/${circleReponame}` : undefined;

    // PR number from CIRCLE_PR_NUMBER or parsed from CIRCLE_PULL_REQUEST URL
    const pullRequestUrl = process.env.CIRCLE_PULL_REQUEST;
    const prNumber = process.env.CIRCLE_PR_NUMBER ?? pullRequestUrl?.match(/\/pull\/(\d+)$/)?.[1];

    // Derive commit URL from repo URL (may be SSH or HTTPS)
    const repoUrl = process.env.CIRCLE_REPOSITORY_URL;
    const webUrl = repoUrl ? gitRemoteToWebUrl(repoUrl) : undefined;

    // CircleCI runners have git; read commit metadata from git directly
    const commitMessage = tryGit('log', '-1', '--pretty=%s');
    const authorEmail = tryGit('log', '-1', '--pretty=%ae');

    Object.assign(meta, {
      gitCommit: sha,
      gitBranch: process.env.CIRCLE_BRANCH,
      gitRepo,
      commitMessage,
      authorEmail,
      prNumber,
      prUrl: pullRequestUrl,
      ciBuildId: process.env.CIRCLE_BUILD_NUM,
      ciBuildUrl: process.env.CIRCLE_BUILD_URL,
      commitUrl: sha && webUrl ? `${webUrl}/commit/${sha}` : undefined,
      triggeredBy: process.env.CIRCLE_USERNAME,
    });
  } else {
    const gitCommit = tryGit('rev-parse', 'HEAD');
    const gitBranch = tryGit('rev-parse', '--abbrev-ref', 'HEAD');
    const commitMessage = tryGit('log', '-1', '--pretty=%s');
    const authorEmail = tryGit('log', '-1', '--pretty=%ae');
    const remoteUrl = tryGit('remote', 'get-url', 'origin');
    const webUrl = remoteUrl ? gitRemoteToWebUrl(remoteUrl) : undefined;
    Object.assign(meta, {
      gitCommit,
      gitBranch,
      commitMessage,
      authorEmail,
      commitUrl: webUrl && gitCommit ? `${webUrl}/commit/${gitCommit}` : undefined,
    });
  }

  return meta;
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

function mapResultEnum(status: ReportTest['status']): string {
  switch (status) {
    case 'passed':
      return 'Passed';
    case 'failed':
      return 'Failed';
    case 'timedOut':
      return 'TimedOut';
    case 'skipped':
      return 'Skipped';
    case 'interrupted':
      return 'Failed';
    default:
      return 'Failed';
  }
}

function mapOutcome(status: ReportTest['status']): string {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'skipped':
      return 'skipped';
    default:
      return 'failed';
  }
}

function determineOverallStatus(tests: ReportTest[]): 'Passed' | 'Failed' | 'Skipped' {
  if (tests.length === 0) return 'Skipped';
  if (tests.every((test) => test.status === 'skipped')) return 'Skipped';
  if (tests.some((test) => test.status === 'failed' || test.status === 'timedOut' || test.status === 'interrupted')) {
    return 'Failed';
  }
  return 'Passed';
}

function assignSlotsToTests(
  tests: ReportTest[],
  slots: LocalRunTestCaseResultSlot[],
): Array<LocalRunTestCaseResultSlot | undefined> {
  const slotsByName = new Map<string, LocalRunTestCaseResultSlot[]>();
  for (const slot of slots) {
    slot.screenshotS3Uris = {};
    const queue = slotsByName.get(slot.testCaseName);
    if (queue) {
      queue.push(slot);
    } else {
      slotsByName.set(slot.testCaseName, [slot]);
    }
  }

  return tests.map((test) => slotsByName.get(test.title)?.shift());
}

function resolveArtifactPath(outputDir: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.join(outputDir, artifactPath);
}

// ---------------------------------------------------------------------------
// ReportV2 builder (the schema the v1 runner produced)
// ---------------------------------------------------------------------------

function buildStepResultJson(steps: ReportStep[], screenshotUrls: Record<string, string>): Record<string, object> {
  const resultJson: Record<string, object> = {};
  for (const [index, step] of steps.entries()) {
    const entry: Record<string, unknown> = {
      // Recorded order as data, not as key insertion order. The delta form only
      // resolves in this order, and a consumer of this object does not
      // necessarily iterate it that way — the cloud looks ids up from
      // actionStepsMap, by phase, as a tree. Contract R2.
      seq: index,
      description: step.description,
      status: step.status,
      duration: step.duration,
      message: step.error ?? step.message,
      screenshotS3Uri: screenshotUrls[step.stepId],
    };
    if (step.type) entry.type = step.type;
    if (step.code) entry.code = step.code;
    if (step.startTime) entry.startTime = step.startTime;
    if (step.autoHealed) entry.autoHealed = step.autoHealed;
    if (step.healFailed) entry.healFailed = step.healFailed;
    if (step.stmtUid) entry.stmtUid = step.stmtUid;
    if (step.cachedAction) entry.cachedAction = step.cachedAction;
    if (step.healedAction) entry.healedAction = step.healedAction;
    if (step.dismissedModalActions?.length) entry.dismissedModalActions = step.dismissedModalActions;
    // Both forms travel: the reporter records deltas (schemaVersion 3), while a
    // report-data.json produced before that change still carries full snapshots.
    if (step.contextBefore) entry.contextBefore = step.contextBefore;
    if (step.contextAfter) entry.contextAfter = step.contextAfter;
    if (step.contextBeforeDelta) entry.contextBeforeDelta = step.contextBeforeDelta;
    if (step.contextAfterDelta) entry.contextAfterDelta = step.contextAfterDelta;
    if (step.llmUsage?.length) entry.llmUsage = step.llmUsage;
    resultJson[step.stepId] = entry;
  }
  return resultJson;
}

function buildReportV2(
  test: ReportTest,
  screenshotUrlsByAttempt: Record<number, Record<string, string>>,
  videoS3UrisByAttempt: Record<number, string>,
  traceS3UrisByAttempt: Record<number, string>,
): object {
  const segments: object[] = [];

  if (test.attempts && test.attempts.length > 1) {
    for (const attempt of test.attempts) {
      const ai = attempt.attemptNumber - 1;
      const attemptScreenshots = screenshotUrlsByAttempt[ai] ?? {};
      const segment: Record<string, unknown> = {
        outcome: mapOutcome(attempt.status),
        createdAt: test.endTime ?? new Date().toISOString(),
        resultJson: buildStepResultJson(attempt.steps, attemptScreenshots),
        consoleLogs: [],
        // Per-attempt, so a retried test's failing attempts carry their own
        // output. Falls back to the test-level capture for the final attempt,
        // which is where it came from before `ReportAttempt` held these.
        stdout: attempt.stdout ?? (attempt.attemptNumber === test.attempts.length ? (test.stdout ?? '') : ''),
        stderr: attempt.stderr ?? (attempt.attemptNumber === test.attempts.length ? (test.stderr ?? '') : ''),
        videoS3Uri: videoS3UrisByAttempt[ai],
        traceS3Uri: traceS3UrisByAttempt[ai],
        actionStepsMap: test.actionStepsMap ?? {},
      };
      if (attempt.error) {
        segment.error = { message: attempt.error };
      }
      if (attempt.status === 'timedOut') {
        segment.timedOut = true;
      }
      segments.push(segment);
    }
  } else {
    segments.push({
      outcome: mapOutcome(test.status),
      createdAt: test.endTime ?? new Date().toISOString(),
      resultJson: buildStepResultJson(test.steps, screenshotUrlsByAttempt[0] ?? {}),
      consoleLogs: [],
      stdout: test.stdout ?? '',
      stderr: test.stderr ?? '',
      videoS3Uri: videoS3UrisByAttempt[0],
      traceS3Uri: traceS3UrisByAttempt[0],
      actionStepsMap: test.actionStepsMap ?? {},
    });
  }

  return {
    // 3: per-step variable snapshots may be recorded as changes from the
    // previous step rather than full copies. Readers detect the form per step;
    // the version is a storage/query signal, not a parsing prerequisite.
    // Contract: specs/002-shiplightai-cli/contracts/report-artifact.md.
    schemaVersion: 3,
    result: mapOutcome(test.status),
    flaky: test.flaky ?? false,
    segments,
  };
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

/**
 * Worker-pool concurrency limiter. Runs at most `limit` tasks simultaneously.
 * Order is preserved in the returned array.
 */
async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function createLimiter(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];

  // Release the current task's permit. If a task is waiting, hand the permit
  // directly to it WITHOUT dropping `active` — otherwise a freshly-arriving
  // task could observe the momentarily-lower count and slip past the cap in
  // the gap before the woken waiter resumes, briefly exceeding `limit` (which
  // is exactly the simultaneous-socket burst we are trying to bound).
  function release() {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  }

  return async function runWithLimit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
      // Resumed by release(): the permit was handed to us, so `active` already
      // accounts for this task — do not increment again.
    } else {
      active += 1;
    }
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

// Resolve a positive-integer env override, reporting whether the env value was
// actually applied (set and valid) vs. falling back to the default.
function resolvePositiveIntEnv(rawValue: string | undefined, fallback: number): { value: number; fromEnv: boolean } {
  if (!rawValue) return { value: fallback, fromEnv: false };
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) return { value: fallback, fromEnv: false };
  return { value: parsed, fromEnv: true };
}

function getCloudUploadConcurrency(): CloudUploadConcurrency {
  // The old nested fan-out allowed up to 50 simultaneous presigned S3 PUTs
  // per process (5 tests x 10 assets). Keep the default low enough to avoid
  // overwhelming runner NAT while still allowing pipelined uploads.
  const putCap = resolvePositiveIntEnv(process.env.SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS, 6);
  return {
    maxConcurrentPutUploads: putCap.value,
    maxConcurrentPutUploadsFromEnv: putCap.fromEnv,
    screenshotUrlRequestWorkers: 8,
    testUploadWorkers: 5,
    perTestAssetWorkers: 10,
  };
}

// Reusable keep-alive agents. Capping concurrency bounds the PEAK number of
// open sockets, but on its own every request can still open a fresh TCP
// connection that lingers in the NAT translation table after close — across a
// large suite that connection churn is what exhausts a VM's NAT ports. Pinning
// keep-alive agents makes the (≤ maxSockets) connections to each host get
// reused for all subsequent requests instead, so a run consumes a handful of
// NAT mappings rather than thousands. We don't rely on Node's implicit global
// agent (its keep-alive default and maxSockets vary by version/host) and set
// both explicitly. Agents pool per-host, so this value applies independently to
// the API host and the S3 host.
function createKeepAliveAgents(maxSockets: number): { httpAgent: HttpAgent; httpsAgent: HttpsAgent } {
  const options = { keepAlive: true, keepAliveMsecs: 1000, maxSockets };
  return { httpAgent: new HttpAgent(options), httpsAgent: new HttpsAgent(options) };
}

function buildCloudUploadConfigLog(totalTests: number, concurrency: CloudUploadConcurrency): string {
  const putCapSource = concurrency.maxConcurrentPutUploadsFromEnv ? 'env:SHIPLIGHT_CLOUD_MAX_PUT_UPLOADS' : 'default';

  return (
    `[reporter] [config] Cloud upload settings for ${totalTests} test(s): ` +
    `presignedPutCap=${concurrency.maxConcurrentPutUploads} (${putCapSource}), ` +
    `screenshotUrlWorkers=${concurrency.screenshotUrlRequestWorkers}, ` +
    `testUploadWorkers=${concurrency.testUploadWorkers}, ` +
    `perTestAssetWorkers=${concurrency.perTestAssetWorkers}`
  );
}

async function retryUpload<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      // EADDRNOTAVAIL / EAGAIN are the ephemeral-port (NAT) exhaustion codes:
      // back off and retry so transient port pressure self-heals instead of
      // failing the upload outright.
      const isRetryable =
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT' ||
        code === 'EPIPE' ||
        code === 'EAI_AGAIN' ||
        code === 'EADDRNOTAVAIL' ||
        code === 'EAGAIN';
      if (!isRetryable || attempt >= maxRetries) throw err;
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      console.warn(
        `[reporter] Upload failed (${code}), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// Axios errors carry the full request/response/socket object graph, which
// floods CI logs when printed directly (thousands of lines per failure).
// Reduce to the fields useful for diagnosis: method, URL, status, and body.
export function summarizeUploadError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const method = err.config?.method?.toUpperCase();
    const url = err.config?.url;
    const status = err.response?.status;
    const body = err.response?.data;
    return (
      [method, url].filter(Boolean).join(' ') +
      ` -> ${status ?? err.code ?? 'no response'}` +
      (body ? ` ${JSON.stringify(body)}` : '')
    );
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * The fields that actually flip the run out of `running`. A bad value in here is
 * a real error: there is no degraded form of "the run finished" worth sending.
 */
interface RunFinalization {
  status: ReturnType<typeof determineOverallStatus>;
  endTime: string;
  totalDuration: number;
  results: LocalRunTestResult[];
}

/**
 * Finalise the run, and if the platform rejects the body outright, retry once
 * carrying only the fields finalization actually needs.
 *
 * The metrics on this request are analytics: the run's outcome does not depend
 * on them. But they ride on the one call that flips the run out of `running`,
 * so a shape the platform does not accept used to cost the entire run — no
 * report URL, the run stuck in `running` forever, and every per-test report,
 * video and trace already pushed to S3 orphaned. That is what a stale
 * `cacheSummary.failed` contract did (`-> 400 {"error":"Required"}`). It exits
 * non-zero for nobody: `report.ts` warns and treats a failed upload as
 * non-fatal, so the run goes green and only the missing report gives it away.
 *
 * The platform applies the same drop-not-reject rule on its side, but it can
 * only apply it to shapes it anticipated. This is the client-side half: schema
 * drift in an optional metric degrades to "metrics lost", never "run lost".
 *
 * Two limits are deliberate, not oversights:
 *
 * - The retry drops *all* analytics rather than narrowing to the offending
 *   field. The platform reports only the first Zod issue's message ("Required"),
 *   with no path, so the culprit is not identifiable from the response; probing
 *   field-by-field would cost one full re-PUT of `results` per guess. Preserving
 *   the innocent blobs is the platform's job and it already does it — each
 *   analytics field parses under its own `.catch(undefined)`, so a whole-body
 *   rejection only happens against a platform predating that, where losing one
 *   run's metrics is the correct trade for saving the run.
 * - The optional per-test metrics (`llmCalls`/`llmTokens`) live inside
 *   `results`, so this fallback cannot shed them. They are covered by the same
 *   per-field `.catch(undefined)` on the platform, and `results` itself can
 *   never be dropped — a completion without it finalises the run as empty.
 *
 * Scoped to 400 deliberately. That is the schema-rejection status; 401/403/404
 * describe the request's identity or target, not its body, and would fail the
 * retry identically.
 */
async function putRunCompletion(
  url: string,
  finalization: RunFinalization,
  analytics: Record<string, unknown>,
  requestConfig: AxiosRequestConfig,
): Promise<AxiosResponse<{ reportUrl: string }>> {
  const analyticsFields = Object.keys(analytics);
  // Both attempts go through `retryUpload` for the same reason every other
  // upload here does — and the fallback needs it most: it reuses the keep-alive
  // socket the server just answered with a 400, which is exactly when a peer
  // closes the connection and the next write surfaces ECONNRESET.
  const put = (body: unknown) => retryUpload(() => axios.put<{ reportUrl: string }>(url, body, requestConfig));

  try {
    // `finalization` spread last: if an analytics key ever collides with one of
    // its field names, the authoritative plane has to win.
    return await put({ ...analytics, ...finalization });
  } catch (err) {
    const isSchemaRejection = axios.isAxiosError(err) && err.response?.status === 400;
    if (analyticsFields.length === 0 || !isSchemaRejection) throw err;
    // Loud on purpose: the only other symptom of a contract skew is metrics
    // quietly going NULL. Phrased as an attempt, not an outcome — a 400 caused
    // by `finalization` itself lands here too, and claiming the run was saved
    // would send whoever reads the log looking in the wrong place.
    console.warn(
      `[reporter] Run completion rejected: ${summarizeUploadError(err)}\n` +
        `[reporter] Retrying without ${analyticsFields.join(', ')}; if that succeeds the run is ` +
        `finalised and only these metrics are lost.`,
    );
    try {
      return await put(finalization);
    } catch (retryErr) {
      // Carry the first rejection forward. Its body is the one that names the
      // offending field; the retry's is usually vaguer, and `report.ts` prints
      // only what propagates. Without this the real diagnosis survives solely in
      // the warning above.
      throw new Error(
        `Run completion failed without ${analyticsFields.join(', ')} too, so those metrics were ` +
          `not the cause. First attempt: ${summarizeUploadError(err)}. ` +
          `Retry: ${summarizeUploadError(retryErr)}`,
        { cause: retryErr },
      );
    }
  }
}

function md5Base64(data: Buffer): string {
  return createHash('md5').update(data).digest('base64');
}

function fileMd5Base64(filePath: string): string {
  return md5Base64(fs.readFileSync(filePath));
}

type PresignedPut = (presignedUrl: string, data: Buffer, config: AxiosRequestConfig) => Promise<AxiosResponse>;

function createPresignedPut(
  concurrency: CloudUploadConcurrency,
  agents: { httpAgent: HttpAgent; httpsAgent: HttpsAgent },
): PresignedPut {
  const limitPut = createLimiter(concurrency.maxConcurrentPutUploads);
  return (presignedUrl, data, config) => limitPut(() => axios.put(presignedUrl, data, { ...config, ...agents }));
}

// Single presigned-PUT primitive. Callers pass an already-serialized body and
// its precomputed Content-MD5 so we never re-serialize/re-hash a payload the
// caller has already built (the report JSON, in particular, is signed with its
// MD5 before upload and would otherwise be stringified + hashed twice).
async function putBufferToPresigned(
  presignedUrl: string,
  body: Buffer,
  contentType: string,
  contentMd5: string,
  presignedPut: PresignedPut,
): Promise<void> {
  await retryUpload(() =>
    presignedPut(presignedUrl, body, {
      headers: { 'Content-Type': contentType, 'Content-MD5': contentMd5 },
    }),
  );
}

async function uploadFileToPut(presignedUrl: string, filePath: string, presignedPut: PresignedPut): Promise<void> {
  const data = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentTypeMap: Record<string, string> = {
    '.png': 'image/png',
    '.webm': 'video/webm',
    '.zip': 'application/zip',
    '.json': 'application/json',
  };
  const contentType = contentTypeMap[ext] ?? 'application/octet-stream';
  await putBufferToPresigned(presignedUrl, data, contentType, md5Base64(data), presignedPut);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function uploadToCloud(
  reportData: ReportData,
  outputDir: string,
  runStartTime: string,
  apiToken: string,
  triggerOverride?: string,
): Promise<void> {
  // Supported shp_* PATs and scoped credentials use the production API.
  // SHIPLIGHT_API_URL still wins when set. A legacy v1 token resolves to no
  // host since that cloud was decommissioned; skip the upload with a clear
  // message rather than failing a run that has already produced its results.
  const baseUrl = resolveApiBase(apiToken, process.env.SHIPLIGHT_API_URL);
  if (!baseUrl) {
    console.warn(`\nShiplight cloud upload skipped. ${UNSUPPORTED_TOKEN_MESSAGE}`);
    return;
  }
  const headers = { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' };
  const cloudUploadConcurrency = getCloudUploadConcurrency();
  // Size the per-host socket pool to the busiest fan-out so keep-alive reuse
  // never artificially serialises requests, while still bounding open sockets.
  const agents = createKeepAliveAgents(
    Math.max(
      cloudUploadConcurrency.maxConcurrentPutUploads,
      cloudUploadConcurrency.screenshotUrlRequestWorkers,
      cloudUploadConcurrency.testUploadWorkers,
    ),
  );
  const presignedPut = createPresignedPut(cloudUploadConcurrency, agents);
  // Shared config for the API-host requests (create-run, screenshot-urls,
  // report-url, complete) so they reuse keep-alive connections too.
  const requestConfig = { headers, ...agents };

  const metadata = collectMetadata();
  const trigger = resolveTrigger(triggerOverride);
  const clientRunId = resolveClientRunId(reportData);
  const batchId = reportData.batchId?.trim() || undefined;
  const expectedBatchCount = reportData.expectedBatchCount;
  if (batchId) {
    if (!reportData.clientRunId) {
      throw new Error('SHIPLIGHT_RUN_ID is required when SHIPLIGHT_BATCH_ID is set');
    }
    if (typeof expectedBatchCount !== 'number' || !Number.isInteger(expectedBatchCount) || expectedBatchCount < 1) {
      throw new Error('SHIPLIGHT_BATCH_COUNT must be a positive integer when SHIPLIGHT_BATCH_ID is set');
    }
  } else if (expectedBatchCount !== undefined) {
    throw new Error('SHIPLIGHT_BATCH_ID is required when SHIPLIGHT_BATCH_COUNT is set');
  }
  const identityOccurrences = new Map<string, number>();

  // Build flat test list; compute MD5 for video/trace now (files exist) so backend
  // can sign the values into the presigned URLs.
  const tests: LocalRunTest[] = reportData.tests.map((t) => {
    const identity = JSON.stringify([t.file, t.title, t.baseTitle, t.suiteName, t.parameterSetName, t.baseUrl]);
    const occurrence = identityOccurrences.get(identity) ?? 0;
    identityOccurrences.set(identity, occurrence + 1);
    const entry: LocalRunTest = {
      clientTestId: createHash('sha256')
        .update(batchId ? `${batchId}\0${identity}\0${occurrence}` : `${identity}\0${occurrence}`)
        .digest('hex'),
      testCaseName: t.title,
      testCaseBaseName: t.baseTitle,
      suiteName: t.suiteName,
      file: t.file,
      tags: t.tags,
      baseUrl: t.baseUrl,
      skip: t.skip,
      slow: t.slow,
      timeout: t.timeout,
      parameterSetName: t.parameterSetName,
      flaky: t.flaky,
      retries: t.retries,
    };
    if (t.videoPath) {
      const abs = resolveArtifactPath(outputDir, t.videoPath);
      if (fs.existsSync(abs)) entry.videoMd5 = fileMd5Base64(abs);
    }
    if (t.tracePath) {
      const abs = resolveArtifactPath(outputDir, t.tracePath);
      if (fs.existsSync(abs)) entry.traceMd5 = fileMd5Base64(abs);
    }
    return entry;
  });

  const totalTests = reportData.tests.length;
  console.log(`[reporter] Uploading ${totalTests} test result(s) to Shiplight cloud...`);
  console.log(buildCloudUploadConfigLog(totalTests, cloudUploadConcurrency));

  // Step 1: Create local run — backend pre-builds all DB records and presigned URLs
  console.log('[reporter] [1/4] Creating run record...');
  const createRes = await axios.post<LocalRunResponse>(
    `${baseUrl}/v1/local-runs`,
    {
      clientRunId,
      ...(batchId && { batchId, expectedBatchCount }),
      trigger,
      startTime: runStartTime,
      metadata,
      tests,
    },
    requestConfig,
  );
  const localRun = createRes.data;
  console.log(`[reporter] [1/4] Run record created (testRunId=${localRun.testRunId})`);

  const slotsByTestIndex = assignSlotsToTests(reportData.tests, localRun.testCaseResults);

  // Request per-step screenshot presigned URLs for each test.
  // When a test has multiple attempts, each attempt's steps are uploaded under
  // an attempt-prefixed stepId (e.g. "attempt-0.main.0") to avoid collisions.
  console.log('[reporter] [2/4] Requesting screenshot upload URLs...');
  await withConcurrency(reportData.tests, cloudUploadConcurrency.screenshotUrlRequestWorkers, async (test, index) => {
    const slot = slotsByTestIndex[index];
    if (!slot) return;

    // Collect all uploadable assets: screenshots + per-attempt video/trace.
    // Video/trace for non-last attempts are uploaded via the screenshot-urls
    // endpoint (which accepts arbitrary stepIds).  The last attempt's
    // video/trace use the dedicated test-level presigned URL instead.
    const assetEntries: Array<{ key: string; filePath: string }> = [];
    if (test.attempts && test.attempts.length > 1) {
      for (const attempt of test.attempts) {
        const ai = attempt.attemptNumber - 1;
        const isLast = attempt.attemptNumber === test.attempts.length;
        for (const step of attempt.steps) {
          if (step.screenshot) {
            assetEntries.push({
              key: `attempt-${ai}.${step.stepId}`,
              filePath: resolveArtifactPath(outputDir, step.screenshot),
            });
          }
        }
        if (!isLast) {
          if (attempt.videoPath) {
            const abs = resolveArtifactPath(outputDir, attempt.videoPath);
            if (fs.existsSync(abs)) assetEntries.push({ key: `attempt-${ai}.__video__`, filePath: abs });
          }
          if (attempt.tracePath) {
            const abs = resolveArtifactPath(outputDir, attempt.tracePath);
            if (fs.existsSync(abs)) assetEntries.push({ key: `attempt-${ai}.__trace__`, filePath: abs });
          }
        }
      }
    } else {
      for (const step of test.steps) {
        if (step.screenshot) {
          assetEntries.push({ key: step.stepId, filePath: resolveArtifactPath(outputDir, step.screenshot) });
        }
      }
    }

    if (!assetEntries.length) return;
    const stepIds = assetEntries.map((e) => e.key);
    const md5s: Record<string, string> = {};
    for (const { key, filePath } of assetEntries) {
      if (fs.existsSync(filePath)) md5s[key] = fileMd5Base64(filePath);
    }
    try {
      const screenshotRes = await axios.post<{
        screenshots: Record<string, string>;
        screenshotS3Uris: Record<string, string>;
      }>(
        `${baseUrl}/v1/local-runs/${localRun.testRunId}/results/${slot.testCaseResultId}/screenshot-urls`,
        { stepIds, md5s },
        requestConfig,
      );
      slot.uploadUrls.screenshots = screenshotRes.data.screenshots;
      slot.screenshotS3Uris = screenshotRes.data.screenshotS3Uris;
      console.log(`[reporter] [2/4] Got ${stepIds.length} screenshot URL(s) for "${test.title}"`);
    } catch (err) {
      console.warn(`[reporter] Failed to get screenshot URLs for "${test.title}":`, summarizeUploadError(err));
    }
  });

  // Resolved once for the whole run: the decision is run-level (did this run
  // capture usage at all), and a per-test evaluation would omit the columns for
  // every test that happens to make no model call, which is a real 0 rather than
  // the "not reported" NULL the omission is meant to express.
  const capturedLlmUsage = runCapturedLlmUsage(reportData);

  // Step 2: Upload assets per test (parallel)
  console.log('[reporter] [3/4] Uploading assets...');
  const completionResults = (
    await withConcurrency(
      reportData.tests,
      cloudUploadConcurrency.testUploadWorkers,
      async (test, index): Promise<LocalRunTestResult | undefined> => {
        const slot = slotsByTestIndex[index];
        if (!slot) {
          console.warn(`[reporter] No result slot found for test "${test.title}", skipping.`);
          return undefined;
        }
        const urls = slot.uploadUrls;

        // Upload all assets (screenshots + per-attempt video/trace) that were
        // requested in the screenshot-urls phase.  Track S3 URIs per attempt.
        const screenshotUrlsByAttempt: Record<number, Record<string, string>> = {};
        const videoS3UrisByAttempt: Record<number, string> = {};
        const traceS3UrisByAttempt: Record<number, string> = {};
        let assetUploadCount = 0;

        interface UploadEntry {
          key: string;
          filePath: string;
          attemptIdx: number;
          assetType: 'screenshot' | 'video' | 'trace';
          originalStepId?: string;
        }

        const uploadEntries: UploadEntry[] = [];
        if (test.attempts && test.attempts.length > 1) {
          for (const attempt of test.attempts) {
            const ai = attempt.attemptNumber - 1;
            const isLast = attempt.attemptNumber === test.attempts.length;
            for (const step of attempt.steps) {
              if (step.screenshot) {
                uploadEntries.push({
                  key: `attempt-${ai}.${step.stepId}`,
                  filePath: resolveArtifactPath(outputDir, step.screenshot),
                  attemptIdx: ai,
                  assetType: 'screenshot',
                  originalStepId: step.stepId,
                });
              }
            }
            if (!isLast) {
              if (attempt.videoPath) {
                const abs = resolveArtifactPath(outputDir, attempt.videoPath);
                if (fs.existsSync(abs)) {
                  uploadEntries.push({
                    key: `attempt-${ai}.__video__`,
                    filePath: abs,
                    attemptIdx: ai,
                    assetType: 'video',
                  });
                }
              }
              if (attempt.tracePath) {
                const abs = resolveArtifactPath(outputDir, attempt.tracePath);
                if (fs.existsSync(abs)) {
                  uploadEntries.push({
                    key: `attempt-${ai}.__trace__`,
                    filePath: abs,
                    attemptIdx: ai,
                    assetType: 'trace',
                  });
                }
              }
            }
          }
        } else {
          for (const step of test.steps) {
            if (step.screenshot) {
              uploadEntries.push({
                key: step.stepId,
                filePath: resolveArtifactPath(outputDir, step.screenshot),
                attemptIdx: 0,
                assetType: 'screenshot',
                originalStepId: step.stepId,
              });
            }
          }
        }

        await withConcurrency(uploadEntries, cloudUploadConcurrency.perTestAssetWorkers, async (entry) => {
          if (!urls.screenshots?.[entry.key]) return;
          if (!fs.existsSync(entry.filePath)) return;
          try {
            await uploadFileToPut(urls.screenshots[entry.key], entry.filePath, presignedPut);
            const s3Uri = slot.screenshotS3Uris[entry.key];
            switch (entry.assetType) {
              case 'screenshot':
                if (!screenshotUrlsByAttempt[entry.attemptIdx]) screenshotUrlsByAttempt[entry.attemptIdx] = {};
                screenshotUrlsByAttempt[entry.attemptIdx][entry.originalStepId!] = s3Uri;
                break;
              case 'video':
                videoS3UrisByAttempt[entry.attemptIdx] = s3Uri;
                break;
              case 'trace':
                traceS3UrisByAttempt[entry.attemptIdx] = s3Uri;
                break;
            }
            assetUploadCount++;
          } catch (err) {
            console.warn(`[reporter] Asset upload failed for ${entry.key}:`, summarizeUploadError(err));
          }
        });
        if (assetUploadCount > 0) {
          console.log(`[reporter] [3/4] Uploaded ${assetUploadCount} asset(s) for "${test.title}"`);
        }

        // Upload video — presigned URL is per-test (one set), so upload the
        // last attempt's video. Per-attempt video upload requires backend changes.
        let videoS3Uri: string | undefined;
        if (test.videoPath && urls.video) {
          const videoLocal = resolveArtifactPath(outputDir, test.videoPath);
          if (fs.existsSync(videoLocal)) {
            console.log(`[reporter] [3/4] Uploading video for "${test.title}"...`);
            try {
              await uploadFileToPut(urls.video, videoLocal, presignedPut);
              videoS3Uri = slot.s3Uris.video;
              console.log(`[reporter] [3/4] Video uploaded for "${test.title}"`);
            } catch (err) {
              console.warn('[reporter] Video upload failed:', summarizeUploadError(err));
            }
          }
        }

        // Upload trace — same presigned URL limitation as video
        let traceS3Uri: string | undefined;
        if (test.tracePath && urls.trace) {
          const traceLocal = resolveArtifactPath(outputDir, test.tracePath);
          if (fs.existsSync(traceLocal)) {
            console.log(`[reporter] [3/4] Uploading trace for "${test.title}"...`);
            try {
              await uploadFileToPut(urls.trace, traceLocal, presignedPut);
              traceS3Uri = slot.s3Uris.trace;
              console.log(`[reporter] [3/4] Trace uploaded for "${test.title}"`);
            } catch (err) {
              console.warn('[reporter] Trace upload failed:', summarizeUploadError(err));
            }
          }
        }

        // Assign test-level video/trace S3 URIs to the appropriate attempt index.
        // For multi-attempt tests, the test-level presigned URL uploads the last
        // attempt's file; earlier attempts were uploaded via the screenshot endpoint.
        if (test.attempts && test.attempts.length > 1) {
          const lastIdx = test.attempts.length - 1;
          if (videoS3Uri) videoS3UrisByAttempt[lastIdx] = videoS3Uri;
          if (traceS3Uri) traceS3UrisByAttempt[lastIdx] = traceS3Uri;
        } else {
          if (videoS3Uri) videoS3UrisByAttempt[0] = videoS3Uri;
          if (traceS3Uri) traceS3UrisByAttempt[0] = traceS3Uri;
        }

        // Build ReportV2, then fetch a presigned URL with its MD5 signed in, then upload.
        // A failure here (e.g. a backend 500 on report-url) must not fail-fast the
        // shared withConcurrency() Promise.all — that would skip [4/4] finalising the
        // run for every other in-flight test. Catch and skip just this test instead.
        console.log(`[reporter] [3/4] Uploading report for "${test.title}"...`);
        let reportS3Uri: string | undefined;
        try {
          const reportV2 = buildReportV2(test, screenshotUrlsByAttempt, videoS3UrisByAttempt, traceS3UrisByAttempt);
          const reportBody = Buffer.from(JSON.stringify(reportV2));
          const reportMd5 = md5Base64(reportBody);
          const reportUrlRes = await axios.post<{ reportUrl: string; reportS3Uri: string }>(
            `${baseUrl}/v1/local-runs/${localRun.testRunId}/results/${slot.testCaseResultId}/report-url`,
            { md5: reportMd5 },
            requestConfig,
          );
          await putBufferToPresigned(
            reportUrlRes.data.reportUrl,
            reportBody,
            'application/json',
            reportMd5,
            presignedPut,
          );
          // Only assign once the PUT itself has succeeded — assigning earlier would let a
          // failed PUT still slip through the `if (!reportS3Uri)` guard below with a URI
          // pointing at data that was never actually uploaded.
          reportS3Uri = reportUrlRes.data.reportS3Uri;
          console.log(`[reporter] [3/4] Report uploaded for "${test.title}"`);
        } catch (err) {
          console.warn(`[reporter] Report upload failed for "${test.title}":`, summarizeUploadError(err));
          return undefined;
        }
        if (!reportS3Uri) {
          console.warn(`[reporter] No report S3 URI for "${test.title}", excluding from run completion.`);
          return undefined;
        }

        return {
          testCaseResultId: slot.testCaseResultId,
          result: mapResultEnum(test.status),
          durationMs: test.duration,
          startTime: test.startTime,
          endTime: test.endTime,
          error: test.error,
          reportS3Uri,
          videoS3Uri,
          traceS3Uri,
          metadata: {
            suiteName: test.suiteName,
            file: test.file,
            ...(test.retries != null && { retries: test.retries }),
            ...(test.flaky && { flaky: true }),
            // Per-test cache effect. Sent alongside the other metadata fields, with
            // the same caveat they already carry: the v1 endpoint
            // (`completeLocalRun`) accepts `metadata` but persists none of it — only
            // result/status/times/URIs reach `updateTestCaseResult`. So do NOT treat
            // this as the durable record. The durable ones are the run-level
            // `cacheExecutionSummary` in the completion analytics, and the per-step
            // `stmtUid`/`healFailed`/`autoHealed` flags in the uploaded ReportV2,
            // from which these per-test numbers are re-derivable for as long as the
            // report artifact is retained.
            ...(test.cacheExecution && { cacheExecution: test.cacheExecution }),
          },
          // Only when this run captured usage at all. Without that guard a run
          // with no instrumentation would report 0 calls for every test, which
          // the platform cannot tell apart from "ran and made no model call" —
          // omission is what makes it store NULL instead.
          ...(capturedLlmUsage ? sumTestLlmUsage(test) : {}),
        };
      },
    )
  ).filter((result): result is LocalRunTestResult => Boolean(result));

  // Step 4: complete this upload unit. A shard remains part of a running parent
  // until the server observes every expected batch below.
  console.log(batchId ? '[reporter] [4/4] Completing shard batch...' : '[reporter] [4/4] Finalising run...');
  const overallStatus = determineOverallStatus(reportData.tests);
  console.log(`[reporter] [4/4] Overall status: ${overallStatus}`);

  // Analytics plane (spec 047): per-operation LLM usage for this run, covering
  // every routing mode. Aggregated into report-data.json at report time (so it
  // survives merge/regenerate); omitted when nothing was captured.
  const usageSummary = reportData.usageSummary;

  // Run-level tier provenance (design §4): which tier was requested, from where,
  // and whether the model mapping came from the server or baked defaults. Sent
  // alongside usageSummary so the cloud run-results view can answer "why did this
  // run behave differently / cost more" without cross-referencing the local HTML.
  // Absent for BYOK / non-tier runs (the field is dropped from report-data.json).
  const modelTierProvenance = reportData.modelTierProvenance;

  // What actually flips the run out of `running`. A bad value here is a real
  // error and should fail the upload.
  const finalization = {
    status: overallStatus,
    endTime: new Date().toISOString(),
    totalDuration: reportData.totalDuration,
    results: completionResults,
  };

  // Metrics that ride along on the same request. The run's outcome does not
  // depend on any of them, so they are kept separate from `finalization` to make
  // the fallback below a matter of dropping one object rather than rebuilding
  // the payload.
  const analytics = {
    ...(usageSummary && { usageSummary }),
    // Action-entity cache effectiveness. Omitted when the run measured nothing
    // (all specs up to date, so nothing transpiled) so the platform stores
    // NULL — "not reported" — rather than a 0% hit rate it never observed.
    ...(reportData.cacheSummary && { cacheSummary: uploadableCacheSummary(reportData.cacheSummary) }),
    // Execution-scoped cache counts. Sent whole — unlike cacheSummary, no field here
    // is a fabricated zero: every count is over statements that demonstrably ran, and
    // `auto_heal_failed` is measured rather than structurally absent. Omitted only
    // when no UID-carrying statement executed at all.
    ...(reportData.cacheExecutionSummary && { cacheExecutionSummary: reportData.cacheExecutionSummary }),
    ...(modelTierProvenance && { modelTierProvenance }),
  };

  const completionUrl = batchId
    ? `${baseUrl}/v1/local-runs/${localRun.testRunId}/batches/${encodeURIComponent(batchId)}/complete`
    : `${baseUrl}/v1/local-runs/${localRun.testRunId}/complete`;
  const completeRes = await putRunCompletion(completionUrl, finalization, analytics, requestConfig);

  let reportUrl = completeRes.data.reportUrl;
  let waitingForOtherBatches = false;
  if (batchId) {
    try {
      const finalizeRes = await retryUpload(() =>
        axios.post<{ reportUrl: string; alreadyCompleted: boolean }>(
          `${baseUrl}/v1/local-runs/${localRun.testRunId}/finalize`,
          { endTime: new Date().toISOString() },
          requestConfig,
        ),
      );
      reportUrl = finalizeRes.data.reportUrl;
    } catch (err) {
      if (!(axios.isAxiosError(err) && err.response?.status === 409)) throw err;
      const data = err.response.data as {
        completedBatchCount?: number;
        expectedBatchCount?: number;
      };
      waitingForOtherBatches = true;
      console.log(
        `[reporter] Shard accepted; waiting for ${data.completedBatchCount ?? '?'} / ` +
          `${data.expectedBatchCount ?? expectedBatchCount} batches to complete.`,
      );
    }
  }

  const completionNote = waitingForOtherBatches ? ' (report will be complete once all shards finish)' : '';
  console.log(`\nShiplight cloud report: ${absoluteReportUrl(reportUrl, baseUrl)}${completionNote}`);
}

function resolveClientRunId(reportData: ReportData): string {
  if (reportData.clientRunId) return reportData.clientRunId;
  const identity = JSON.stringify({
    timestamp: reportData.timestamp,
    tests: reportData.tests.map((test) => [test.file, test.title, test.startTime]),
  });
  return `report-${createHash('sha256').update(identity).digest('hex')}`;
}

// The API returns the report URL as a path-only string (e.g. "/run-results/38").
// Promote the relative form by deriving app.shiplight.ai from the production
// API host. For overrides (staging, localhost) we have no mapping, so we fall
// back to the API base itself — at least the resulting URL is valid there.
function absoluteReportUrl(reportUrl: string, apiBase: string): string {
  if (/^https?:\/\//.test(reportUrl)) return reportUrl;
  const path = reportUrl.startsWith('/') ? reportUrl : `/${reportUrl}`;
  const webBase = apiToWebBase(apiBase);
  return `${webBase}${path}`;
}

function apiToWebBase(apiBase: string): string {
  // Strip trailing slash before equality checks so a configured base like
  // "https://api.shiplight.ai/" still maps to the right web host.
  const base = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
  if (base === 'https://api.shiplight.ai') return 'https://app.shiplight.ai';
  return base;
}

// Exposed for tests
export const __testing = {
  detectCi,
  resolveTrigger,
  collectMetadata,
  absoluteReportUrl,
  apiToWebBase,
  getCloudUploadConcurrency,
  buildCloudUploadConfigLog,
  buildReportV2,
  buildStepResultJson,
  buildVersionMeta,
  sumTestLlmUsage,
  runCapturedLlmUsage,
  uploadableCacheSummary,
};
