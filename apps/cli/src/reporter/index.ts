/**
 * Shiplight Playwright Reporter
 *
 * Custom reporter that reads test-results.json from Playwright attachments,
 * maps stepIds back to YAML statements, and generates an HTML report
 * showing YAML-level step info instead of transpiled code.
 */

import type {
  Reporter,
  TestCase,
  TestResult,
  TestStep,
  FullResult,
  Suite,
  FullConfig,
  Location,
} from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';
import { parseYamlTestFile } from '../yaml-transpiler';
import type { ParsedYamlTestFile } from '../yaml-transpiler';
import type { ActionEntity, ActionEntityStore, ActionStepInfo } from 'shiplight-types';
import { type ReportTest, type ReportStep, type ReportData, type ReportAttempt } from './template.js';
import { writeHtmlReport, writeReportDataFile } from './reportFiles.js';
import { encodeStepContexts } from './contextDelta.js';
import { aggregateRunUsageSummary, groupStepLlmUsage } from './runUsageAggregate.js';
import { resolveReportStepDescription } from './reportStepDescription.js';
import {
  cachedActionEntitiesByStatementUid,
  cacheServedStatementUids,
  hasRunCacheMetadata,
  isRunMeasurementIncomplete,
  recordRunHealedEntities,
  runCacheCollector,
} from '../cache/runCacheMetadata.js';
import {
  buildTestCacheExecution,
  formatCacheExecutionSummary,
  mergeCacheExecutionSummaries,
} from './cacheExecutionSummary.js';
import { captureConsoleOutput } from './consoleOutput.js';
import { assembleReportTest } from './reportAssembly.js';
import { resolveReportTags } from './reportTags.js';
import { loadCachedYaml, resolveYamlEnrichment } from './reportYamlEnrichment.js';
import { buildModelTierProvenance } from '../orgSettings.js';
import { getShiplightEnv } from '../dotenvSource.js';
import { PUBLISHED_VERSION } from '../versionCheck.js';
import { hasExplicitRunId } from '../runId.js';
// Type-only — erased at build time, so this does NOT pull the sdk-core barrel into the
// standalone reporter.ts bundle (see the barrel-import guard test in runUsageAggregate.test.ts).
import type { AIActionDetail } from 'sdk-core';

/** Phase order for sorting steps */
const PHASE_ORDER: Record<string, number> = {
  before: 0,
  main: 1,
  teardown: 2,
  after: 3,
};

function parseExpectedBatchCount(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

interface PlaywrightShard {
  current: number;
  total: number;
}

export function resolveShardUploadIdentity(
  shard: PlaywrightShard | null | undefined,
  env: NodeJS.ProcessEnv,
): Pick<ReportData, 'clientRunId' | 'batchId' | 'expectedBatchCount'> {
  const clientRunId = env.SHIPLIGHT_RUN_ID?.trim() || undefined;
  const explicitBatchId = env.SHIPLIGHT_BATCH_ID?.trim() || undefined;
  const explicitBatchCount = parseExpectedBatchCount(env.SHIPLIGHT_BATCH_COUNT);
  const hasBatchOverride = env.SHIPLIGHT_BATCH_ID !== undefined || env.SHIPLIGHT_BATCH_COUNT !== undefined;

  if (hasBatchOverride) {
    if (!clientRunId || !hasExplicitRunId(env)) {
      throw new Error(
        'SHIPLIGHT_RUN_ID must be set explicitly when SHIPLIGHT_BATCH_ID or SHIPLIGHT_BATCH_COUNT is set',
      );
    }
    return {
      clientRunId,
      batchId: explicitBatchId,
      expectedBatchCount: explicitBatchCount,
    };
  }

  if (!clientRunId || !hasExplicitRunId(env) || !shard) {
    return { clientRunId, batchId: undefined, expectedBatchCount: undefined };
  }

  return {
    clientRunId,
    batchId: `shard-${shard.current}`,
    expectedBatchCount: shard.total,
  };
}

function getPhaseRank(stepId: string): number {
  const phase = stepId.split('.')[0];
  return PHASE_ORDER[phase] ?? 1;
}

/** Parse a stepId like "main.10.then.2" into comparable numeric segments */
function stepIdSegments(id: string): number[] {
  return id.split('.').map((s) => {
    const n = Number(s);
    return Number.isNaN(n) ? 0 : n;
  });
}

function sortStepEntries(entries: [string, any][]): [string, any][] {
  return [...entries].sort(([a], [b]) => {
    const ra = getPhaseRank(a);
    const rb = getPhaseRank(b);
    if (ra !== rb) return ra - rb;
    // Numeric comparison of segments: main.2 < main.10
    const sa = stepIdSegments(a);
    const sb = stepIdSegments(b);
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      const va = sa[i] ?? -1;
      const vb = sb[i] ?? -1;
      if (va !== vb) return va - vb;
    }
    return 0;
  });
}

/**
 * Collect all categories present in a step tree (shallow scan of direct children).
 * Used to decide which extraction strategy to apply.
 */
function collectCategories(steps: TestStep[]): Set<string> {
  const cats = new Set<string>();
  for (const s of steps) {
    cats.add(s.category);
    if (s.category === 'hook') {
      for (const child of s.steps) cats.add(child.category);
    }
  }
  return cats;
}

/**
 * Recursively walk Playwright's native step tree and extract steps as ReportStep entries.
 *
 * Strategy (two-pass):
 * - If the tree contains any 'test.step' nodes: emit only those (user explicitly structured
 *   their test). Recurse into 'hook' to find test.step() inside beforeEach/afterEach.
 * - Otherwise (test written without test.step()): emit 'expect' and 'pw:api' nodes so
 *   that bare assertion/action tests still produce a meaningful step list.
 *
 * In both modes 'fixture' and 'test.attach' are always skipped (internal noise).
 *
 * Hook title → ID prefix mapping:
 *   Titles containing "before" (case-insensitive) → 'before'
 *   Titles containing "after"  (case-insensitive) → 'after'
 *   Otherwise                                     → inherit parent prefix
 *
 * Step IDs use a shared per-prefix counter (passed as `counters`) so that indices
 * remain unique even when multiple hook frames share the same prefix (e.g. two
 * beforeEach blocks both mapping to 'before').
 *
 * Example IDs: before.0, main.0, main.1, after.0
 */
function hookPrefix(title: string, fallback: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('before')) return 'before';
  if (lower.includes('after')) return 'after';
  return fallback;
}

function extractStepsFromPlaywrightResult(
  steps: TestStep[],
  idPrefix = 'main',
  includeExpectAndApi?: boolean,
  locationMap?: Map<string, Location>,
  counters?: Map<string, number>, // shared per-prefix index across all recursive frames
): ReportStep[] {
  // On the top-level call decide the strategy and create the shared counter map.
  if (includeExpectAndApi === undefined) {
    const cats = collectCategories(steps);
    includeExpectAndApi = !cats.has('test.step');
  }
  if (!counters) counters = new Map();

  const result: ReportStep[] = [];

  for (const step of steps) {
    if (step.category === 'fixture' || step.category === 'test.attach') {
      continue;
    }

    if (step.category === 'hook') {
      // Map hook title to before/after prefix so beforeEach steps get 'before.N'
      // and afterEach steps get 'after.N', distinct from test-body 'main.N'.
      const prefix = hookPrefix(step.title, idPrefix);
      result.push(...extractStepsFromPlaywrightResult(step.steps, prefix, includeExpectAndApi, locationMap, counters));
      continue;
    }

    const shouldEmit =
      step.category === 'test.step' ||
      (includeExpectAndApi && (step.category === 'expect' || step.category === 'pw:api'));

    if (shouldEmit) {
      // Use the shared counter for this prefix so multiple hook frames don't reset to 0
      const idx = counters.get(idPrefix) ?? 0;
      counters.set(idPrefix, idx + 1);
      const stepId = `${idPrefix}.${idx}`;

      const reportStep: ReportStep = {
        stepId,
        description: step.title,
        status: step.error ? 'failure' : step.duration === -1 ? 'skipped' : 'success',
        duration: step.duration >= 0 ? step.duration : undefined,
      };

      if (step.error) {
        reportStep.error = step.error.message ?? step.error.stack;
      }

      if (locationMap && step.location) {
        locationMap.set(stepId, step.location);
      }

      result.push(reportStep);

      // Recurse into nested steps after emitting the parent
      if (step.steps.length > 0) {
        result.push(
          ...extractStepsFromPlaywrightResult(step.steps, stepId, includeExpectAndApi, locationMap, counters),
        );
      }
    }
  }

  return result;
}

function updateLatestSymlink(parentDir: string, runFolderName: string): void {
  const absoluteParent = path.isAbsolute(parentDir) ? parentDir : path.join(process.cwd(), parentDir);
  const linkPath = path.join(absoluteParent, 'latest');
  try {
    const stat = fs.lstatSync(linkPath); // throws if nothing is there
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(linkPath);
    } else {
      console.warn(`[report] 'latest' exists and is not a symlink; skipping update`);
      return;
    }
  } catch {
    // nothing at linkPath yet — that's fine
  }
  try {
    if (process.platform === 'win32') {
      // Junctions don't need elevation; they require an absolute target
      fs.symlinkSync(path.join(absoluteParent, runFolderName), linkPath, 'junction');
    } else {
      fs.symlinkSync(runFolderName, linkPath, 'dir');
    }
  } catch (err) {
    console.warn(`[report] Could not create 'latest' symlink: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface ShiplightReporterOptions {
  outputFolder?: string;
  open?: 'always' | 'never' | 'on-failure';
  /** When set, a 'latest' symlink is created/updated in this directory after each run. */
  latestSymlinkDir?: string;
}

interface CollectedTest {
  test: TestCase;
  result: TestResult;
}

/**
 * Read the `shiplight-new-action-entities` attachment into a uid -> healed
 * entity map.
 *
 * The attachment is an `ActionEntityStore`, NOT a bare uid->entity map:
 * `apps/cli/src/fixture.ts` builds it with `createEmptyStore()` /
 * `createRunnerStoreEntry()`, so the statement UIDs live one level down under
 * `entries` and each value wraps the entity. Reading the top level instead
 * yields the keys `"version"` and `"entries"`, which match no statement — every
 * heal would be silently counted as zero and every self-healed statement would
 * stay in `cache_hits`, inflating the uploaded hit rate by exactly the number of
 * heals. Returns an empty map for anything malformed: a bad attachment must
 * never fail the report.
 */
export function parseHealedEntitiesAttachment(raw: string | null): Map<string, ActionEntity> {
  const healed = new Map<string, ActionEntity>();
  if (!raw) return healed;
  let parsed: ActionEntityStore | null;
  try {
    parsed = JSON.parse(raw) as ActionEntityStore;
  } catch {
    return healed;
  }
  if (!parsed?.entries || typeof parsed.entries !== 'object') return healed;
  for (const [uid, entry] of Object.entries(parsed.entries)) {
    if (entry?.action_entity) healed.set(uid, entry.action_entity);
  }
  return healed;
}

export class ShiplightReporter implements Reporter {
  private outputFolder: string;
  private openMode: 'always' | 'never' | 'on-failure';
  private latestSymlinkDir: string | undefined;
  private collected: CollectedTest[] = [];
  /** Parsed `.test.yaml` per path; `null` marks absent or unparseable. */
  private yamlCache = new Map<string, ParsedYamlTestFile | null>();
  private config!: FullConfig;
  private runStartTime!: string;

  constructor(options: ShiplightReporterOptions = {}) {
    this.outputFolder = options.outputFolder || 'shiplight-report';
    this.openMode = options.open || 'on-failure';
    this.latestSymlinkDir = options.latestSymlinkDir;
  }

  onBegin(config: FullConfig, _suite: Suite): void {
    this.config = config;
    this.runStartTime = new Date().toISOString();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.collected.push({ test, result });
  }

  /**
   * The output directories Playwright resolved for this run — where the agent's
   * `ai-actions.json` were written. Playwright resolves each project's
   * `outputDir` to an absolute path, so this honours a user-supplied override
   * that the `<cwd>/test-results` guess would miss. Deduplicated because
   * projects commonly share one directory.
   */
  private projectOutputDirs(): string[] {
    const dirs = new Set<string>();
    for (const project of this.config?.projects ?? []) {
      if (project.outputDir) dirs.add(project.outputDir);
    }
    return Array.from(dirs);
  }

  async onEnd(result: FullResult): Promise<void> {
    if (this.collected.length === 0) return;

    // Group all attempts per test by titlePath.
    // Use titlePath (full suite > test path) to avoid collisions with parameterized tests.
    const allAttemptsByTest = new Map<string, CollectedTest[]>();
    for (const entry of this.collected) {
      const key = entry.test.titlePath().join(' > ');
      let list = allAttemptsByTest.get(key);
      if (!list) {
        list = [];
        allAttemptsByTest.set(key, list);
      }
      list.push(entry);
    }

    const reportTests: ReportTest[] = [];

    // Snapshot which statements the transpiler resolved from the cache BEFORE the
    // loop below folds healing in — `recordRunHealedEntities` overwrites a record's
    // source, after which a cache entry that went stale looks like a statement that
    // never had one. The execution summary needs the pre-heal answer, and needs it
    // to be the same for every test regardless of what some other test healed.
    const cacheServedUids = cacheServedStatementUids();
    const cachedActionsByUid = cachedActionEntitiesByStatementUid();
    const measurementIncomplete = isRunMeasurementIncomplete();

    for (const [, attempts] of allAttemptsByTest.entries()) {
      const specFile = attempts[0].test.location.file;

      // Build report for each attempt once
      const builtAttempts: ReportAttempt[] = [];
      let lastBuilder: ReportTest | undefined;
      let startTime: string | undefined;
      let endTime: string | undefined;
      for (let i = 0; i < attempts.length; i++) {
        const { test: attemptTest, result: attemptResult } = attempts[i];
        const built = await this.buildReportTest(attemptTest, attemptResult, specFile, cachedActionsByUid);
        lastBuilder = built;
        if (!startTime) {
          startTime = built.startTime;
        }
        endTime = built.endTime;
        builtAttempts.push({
          attemptNumber: i + 1,
          status: attemptResult.status,
          duration: attemptResult.duration,
          steps: built.steps,
          error: built.error,
          videoPath: built.videoPath,
          tracePath: built.tracePath,
          stdout: built.stdout,
          stderr: built.stderr,
        });
      }

      // Use the last attempt as the main test result; retries are preserved as
      // full history. See ./reportAssembly.ts for why this is not an inline
      // field-by-field copy.
      const { test } = attempts[attempts.length - 1];
      const reportTest = assembleReportTest({
        lastBuilder,
        builtAttempts,
        title: test.title,
        file: path.relative(process.cwd(), specFile),
        startTime,
        endTime,
      });

      // After `attempts` is populated, so a retried test counts every attempt.
      // Suppressed wholesale on a partial transpile, for the same reason the
      // run-level summary is: a test whose file never transpiled this run carries
      // UIDs the collector cannot match, so its per-test numbers understate the
      // cache just as badly as the roll-up would.
      if (!measurementIncomplete) {
        reportTest.cacheExecution = buildTestCacheExecution(reportTest, cacheServedUids);
      }

      reportTests.push(reportTest);
    }

    // `PUBLISHED_VERSION` is `undefined` for dev builds, so uploaded
    // artifacts never carry `"dev"` as the version. `undefined` values
    // are dropped by JSON.stringify, preserving the absent-field shape
    // in report-data.json.
    const uploadIdentity = resolveShardUploadIdentity(this.config.shard, process.env);
    const reportData: ReportData = {
      ...uploadIdentity,
      tests: reportTests,
      totalDuration: result.duration,
      timestamp: new Date().toISOString(),
      shiplightVersion: PUBLISHED_VERSION,
      // Aggregate per-operation LLM usage now, while the agent's ai-actions.json
      // still exist under this cwd's test-results/; fold it into report-data.json
      // so it survives merge/regenerate/upload (spec 047 analytics plane).
      // Scoped to the project output directories Playwright actually resolved,
      // so the run total covers THIS run and nothing else: the default
      // `test-results/<runId>` layout leaves every prior run's ai-actions.json
      // sitting under `test-results/`, and a bare scan of that parent would
      // report a multiple of the tokens the run's own tests account for.
      usageSummary: aggregateRunUsageSummary(process.cwd(), this.projectOutputDirs()),
      // Action-entity cache effectiveness, assembled from the transpiler's
      // per-statement source (recorded when config.ts transpiled) plus the
      // healing folded in above. Omitted when nothing was recorded — a run whose
      // specs were all up to date transpiles nothing, and reporting 0 statements
      // there would claim a measured 0% hit rate where nothing was measured.
      cacheSummary: hasRunCacheMetadata() ? runCacheCollector().getSummary() : undefined,
      // Execution-scoped counterpart to cacheSummary, rolled up from the per-test
      // counts. Takes only the INCOMPLETE half of hasRunCacheMetadata()'s gate, not
      // the whole thing: a run with no cache configured must still report its
      // auto-heal counts, because that is the baseline the cache's saving is
      // measured against. But a run where some file failed to transpile must report
      // nothing — Playwright still executes that file's stale spec, whose statements
      // carry UIDs the collector never saw, so they inflate `executed` while being
      // structurally unmatchable as cache-served. See isRunMeasurementIncomplete.
      cacheExecutionSummary: mergeCacheExecutionSummaries(reportTests.map((t) => t.cacheExecution)),
      // Run-level tier provenance (design §4). Resolved from the Shiplight .env
      // stash — the SAME view the fixture resolved models under (getShiplightEnv,
      // .env-over-shell), so provenance cannot disagree with what actually ran
      // when WEB_AGENT_TIER is set in .env but shadowed in the shell. The stash
      // carries SHIPLIGHT_TIER_MAP because config.ts's loadShiplightEnv builds it
      // from process.env, into which the parent injected the fetched map.
      // Undefined for BYOK / non-tier runs, so JSON.stringify drops the field.
      modelTierProvenance: buildModelTierProvenance(getShiplightEnv()),
    };

    // Write HTML report
    const outputDir = path.isAbsolute(this.outputFolder)
      ? this.outputFolder
      : path.join(process.cwd(), this.outputFolder);

    fs.mkdirSync(outputDir, { recursive: true });

    // Copy all artifacts (screenshots, video, trace) into the report dir and
    // rewrite absolute paths to relative. Uses per-test subdirectories because
    // stepIds repeat across tests and would collide in a flat directory.
    // Note: test-${testIdx} paths depend on array order — do not reorder
    // reportData.tests after this loop.
    const screenshotsDir = path.join(outputDir, 'screenshots');
    for (let testIdx = 0; testIdx < reportData.tests.length; testIdx++) {
      const test = reportData.tests[testIdx];
      const hasAttempts = test.attempts && test.attempts.length > 0;

      // Process test + each attempt in one pass
      const targets: { obj: ReportTest | ReportAttempt; prefix: string; screenshotSubDir: string }[] = [
        {
          obj: test,
          prefix: hasAttempts ? `test-${testIdx}-attempt-0` : `test-${testIdx}`,
          screenshotSubDir: `test-${testIdx}`,
        },
      ];
      if (test.attempts) {
        for (let ai = 0; ai < test.attempts.length; ai++) {
          targets.push({
            obj: test.attempts[ai],
            prefix: `test-${testIdx}-attempt-${ai + 1}`,
            screenshotSubDir: `test-${testIdx}/attempt-${ai}`,
          });
        }
      }

      for (const { obj, prefix, screenshotSubDir } of targets) {
        // Screenshots
        const stepScreenshotDir = path.join(screenshotsDir, screenshotSubDir);
        let dirCreated = false;
        for (const step of obj.steps) {
          if (step.screenshot && path.isAbsolute(step.screenshot)) {
            try {
              if (!dirCreated) {
                fs.mkdirSync(stepScreenshotDir, { recursive: true });
                dirCreated = true;
              }
              const fileName = `${step.stepId.replace(/\./g, '-')}.png`;
              fs.copyFileSync(step.screenshot, path.join(stepScreenshotDir, fileName));
              step.screenshot = `screenshots/${screenshotSubDir}/${fileName}`;
            } catch (err) {
              console.warn(`[reporter] Failed to copy screenshot for ${step.stepId}:`, err);
            }
          }
        }

        // Video
        if (obj.videoPath && path.isAbsolute(obj.videoPath)) {
          const ext = path.extname(obj.videoPath) || '.webm';
          const destName = `${prefix}-video${ext}`;
          try {
            fs.copyFileSync(obj.videoPath, path.join(outputDir, destName));
            obj.videoPath = destName;
          } catch {
            obj.videoPath = undefined;
          }
        }

        // Trace
        if (obj.tracePath && path.isAbsolute(obj.tracePath)) {
          const ext = path.extname(obj.tracePath) || '.zip';
          const destName = `${prefix}-trace${ext}`;
          try {
            fs.copyFileSync(obj.tracePath, path.join(outputDir, destName));
            obj.tracePath = destName;
          } catch {
            obj.tracePath = undefined;
          }
        }
      }
    }

    // Save report-data.json and HTML after all paths have been rewritten to relative
    const reportDataPath = path.join(outputDir, 'report-data.json');
    writeReportDataFile(reportDataPath, reportData);

    const htmlPath = path.join(outputDir, 'index.html');
    const htmlWritten = writeHtmlReport(htmlPath, { ...reportData, outputDir });

    // Printed before the report path so the numbers are visible without opening the
    // report — this is the line that answers "did the cache do anything for me".
    // Silent when nothing cache-relevant ran, so a project not using the cache sees
    // no noise.
    const cacheLine = formatCacheExecutionSummary(reportData.cacheExecutionSummary);
    if (cacheLine) console.log(`\n[Shiplight Cache] ${cacheLine}`);

    if (htmlWritten) console.log(`\nShiplight report written to: ${htmlPath}`);

    if (this.latestSymlinkDir) {
      updateLatestSymlink(this.latestSymlinkDir, path.basename(outputDir));
    }

    // Auto-open on failure
    if (htmlWritten && (this.openMode === 'always' || (this.openMode === 'on-failure' && result.status !== 'passed'))) {
      try {
        const open = (await import('open')).default;
        await open(htmlPath);
      } catch {
        /* open is optional */
      }
    }

    // Cloud upload is handled by `shiplight report`, not the reporter.
    // See apps/cli/src/commands/report.ts (maybeUploadToCloud).
  }

  printsToStdio(): boolean {
    return false;
  }

  /**
   * Read and parse a `.test.yaml`, through the per-run cache.
   *
   * This half is the filesystem access; `loadCachedYaml` owns the caching rule
   * and is tested there. A file that is absent or fails to parse resolves to
   * `null`, which the cache stores so the failure is not retried.
   */
  private loadYaml(yamlPath: string): ParsedYamlTestFile | null {
    return loadCachedYaml(yamlPath, this.yamlCache, (p) => {
      try {
        if (!fs.existsSync(p)) return null;
        return parseYamlTestFile(fs.readFileSync(p, 'utf-8'), p, this.config.rootDir);
      } catch {
        /* YAML parse error — skip enrichment */
        return null;
      }
    });
  }

  private async buildReportTest(
    test: TestCase,
    testResult: TestResult,
    specFile: string,
    cachedActionsByUid: ReadonlyMap<string, ActionEntity>,
  ): Promise<ReportTest> {
    const reportTest: ReportTest = {
      title: test.title,
      file: path.relative(process.cwd(), specFile),
      status: testResult.status,
      duration: testResult.duration,
      steps: [],
      startTime: new Date(testResult.startTime).toISOString(),
      endTime: new Date(testResult.startTime.getTime() + testResult.duration).toISOString(),
    };

    // Extract error message
    if (testResult.errors.length > 0) {
      reportTest.error = testResult.errors.map((e) => e.message || e.stack || String(e)).join('\n\n');
    }

    reportTest.stdout = captureConsoleOutput(testResult.stdout);
    reportTest.stderr = captureConsoleOutput(testResult.stderr);

    // Straight off Playwright: describe-inherited tags, test tags and
    // parameter-set names are already merged into `TestCase.tags`, and it is
    // populated for hand-written specs the YAML lookup below cannot see.
    reportTest.tags = resolveReportTags(test.tags);

    // Find video/trace attachments — store full path for now,
    // rewritten to relative path during the copy phase in onEnd.
    for (const att of testResult.attachments) {
      if (att.name === 'video' && att.path) {
        reportTest.videoPath = att.path;
      }
      if (att.name === 'trace' && att.path) {
        reportTest.tracePath = att.path;
      }
    }

    // Find shiplight-results attachment (test-results.json)
    const shiplightAtt = testResult.attachments.find((a) => a.name === 'shiplight-results');
    // Relative screenshot paths in stepResults resolve against this directory.
    const resultsDir = shiplightAtt?.path ? path.dirname(shiplightAtt.path) : '';
    let stepResults: Record<string, any> | null = null;
    if (shiplightAtt) {
      try {
        if (shiplightAtt.body) {
          stepResults = JSON.parse(shiplightAtt.body.toString('utf-8'));
        } else if (shiplightAtt.path) {
          const raw = fs.readFileSync(shiplightAtt.path, 'utf-8');
          stepResults = JSON.parse(raw);
        }
      } catch {
        /* skip */
      }
    }

    // Per-step LLM usage — its own attachment (see apps/cli/src/fixture.ts), read the
    // same body-first/path-fallback way as shiplight-results. NOT derived from
    // resultsDir above: that path is unreliable by the time the reporter sees it.
    // Healed entities for this test, from the same attachment the parent process
    // later reads off disk to write the cache back. Taken here instead so the
    // cache summary can be assembled entirely inside the Playwright process:
    // report-data.json is written in onEnd, before the parent's post-test scan
    // ever runs, so a summary built there would arrive too late to be uploaded.
    const healedAtt = testResult.attachments.find((a) => a.name === 'shiplight-new-action-entities');
    if (healedAtt) {
      try {
        const raw = healedAtt.body
          ? healedAtt.body.toString('utf-8')
          : healedAtt.path
            ? fs.readFileSync(healedAtt.path, 'utf-8')
            : null;
        recordRunHealedEntities(parseHealedEntitiesAttachment(raw));
      } catch {
        /* a malformed attachment must never fail the report */
      }
    }

    const aiActionsAtt = testResult.attachments.find((a) => a.name === 'shiplight-ai-actions');
    let aiActionDetails: AIActionDetail[] = [];
    if (aiActionsAtt) {
      try {
        const raw = aiActionsAtt.body
          ? aiActionsAtt.body.toString('utf-8')
          : aiActionsAtt.path
            ? fs.readFileSync(aiActionsAtt.path, 'utf-8')
            : null;
        const parsed = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed)) aiActionDetails = parsed;
      } catch {
        /* skip */
      }
    }
    const stepLlmUsage = groupStepLlmUsage(aiActionDetails);

    // Derive YAML path from spec file
    const yamlPath = specFile.replace(/\.yaml\.spec\.ts$/, '.test.yaml');
    let actionStepsMap: Record<string, ActionStepInfo> = {};

    const parsed = this.loadYaml(yamlPath);
    if (parsed) {
      const enrichment = resolveYamlEnrichment(parsed, test.title);
      actionStepsMap = enrichment.actionStepsMap;
      if (enrichment.baseTitle !== undefined) reportTest.baseTitle = enrichment.baseTitle;
      if (enrichment.suiteName !== undefined) reportTest.suiteName = enrichment.suiteName;
      if (enrichment.baseUrl !== undefined) reportTest.baseUrl = enrichment.baseUrl;
      if (enrichment.skip !== undefined) reportTest.skip = enrichment.skip;
      if (enrichment.slow !== undefined) reportTest.slow = enrichment.slow;
      if (enrichment.timeout !== undefined) reportTest.timeout = enrichment.timeout;
      if (enrichment.parameterSetName !== undefined) {
        reportTest.parameterSetName = enrichment.parameterSetName;
      }
    }

    // Build steps from action steps map + step results
    if (stepResults || Object.keys(actionStepsMap).length > 0) {
      // Merge both sources — action steps for descriptions, stepResults for execution data
      const allStepIds = new Set([...Object.keys(actionStepsMap), ...Object.keys(stepResults || {})]);

      const entries: [string, any][] = Array.from(allStepIds).map((id) => [id, null]);
      const sorted = sortStepEntries(entries);

      for (const [stepId] of sorted) {
        const actionInfo = actionStepsMap[stepId];
        const execResult = stepResults?.[stepId];

        // Executed descriptions have already resolved runtime parameter values;
        // YAML/action-entity text is only the fallback for steps that did not run.
        const description = resolveReportStepDescription(stepId, actionInfo, execResult?.description);

        const step: ReportStep = {
          stepId,
          description,
          status: execResult?.status || 'pending',
          duration: execResult?.duration,
        };

        // Step message (AI feedback / explanation)
        if (execResult?.message) {
          const msg =
            typeof execResult.message === 'string' ? execResult.message : JSON.stringify(execResult.message, null, 2);
          if (execResult.status === 'failure') {
            step.error = msg;
          } else {
            step.message = msg;
          }
        }

        // Screenshot — store absolute path for now, copied to report dir in onEnd
        if (execResult?.screenshot) {
          const screenshotPath = execResult.screenshot;
          const absScreenshot = path.isAbsolute(screenshotPath)
            ? screenshotPath
            : path.join(resultsDir, screenshotPath);
          if (fs.existsSync(absScreenshot)) {
            step.screenshot = absScreenshot;
          }
        }

        // Recorded function body from agent.step() — guard on `execResult`
        // because Playwright-native test.step() calls (including enriched
        // VERIFY assertions that run `await expect(...)` directly) don't
        // produce a shiplight execResult, so reading `.code` on the bare
        // undefined crashes the reporter's onEnd phase.
        if (execResult?.code) {
          step.code = execResult.code;
        }

        if (execResult?.type) step.type = execResult.type;
        if (execResult?.startTime) step.startTime = execResult.startTime;
        if (execResult?.autoHealed) step.autoHealed = execResult.autoHealed;
        // Both required for the execution-scoped cache summary: the UID says which
        // statement ran (so it can be joined to what the transpiler knew about it),
        // healFailed says the model was called and did not rescue it.
        if (execResult?.stmtUid) {
          step.stmtUid = execResult.stmtUid;
          const cachedAction = cachedActionsByUid.get(execResult.stmtUid);
          if (cachedAction) step.cachedAction = cachedAction;
        }
        if (execResult?.healFailed) step.healFailed = execResult.healFailed;
        if (execResult?.healedAction) step.healedAction = execResult.healedAction;
        if (execResult?.dismissedModalActions?.length) step.dismissedModalActions = execResult.dismissedModalActions;
        // Passed through whole; `encodeStepContexts` below diffs the full values
        // and caps only what it emits, so two different oversized values cannot
        // collapse into the same marker and read as unchanged.
        if (execResult?.contextBefore) step.contextBefore = execResult.contextBefore;
        if (execResult?.contextAfter) step.contextAfter = execResult.contextAfter;

        const usage = stepLlmUsage.get(stepId);
        if (usage) step.llmUsage = usage;

        reportTest.steps.push(step);
      }
    }

    // Native TS test fallback: no shiplight-results and no YAML — parse Playwright's
    // native step tree to surface test.step() calls in the report.
    if (stepResults === null && Object.keys(actionStepsMap).length === 0 && !specFile.endsWith('.yaml.spec.ts')) {
      const locationMap = new Map<string, Location>();
      reportTest.steps = extractStepsFromPlaywrightResult(testResult.steps, 'main', undefined, locationMap);
      // Build actionStepsMap from extracted steps for cloud upload (ReportV2 schema requires it).
      // Also enrich each ReportStep with a 3-line source snippet (prev + step + next) for
      // display in the HTML report when no screenshot is available.
      if (reportTest.steps.length > 0) {
        const fileLines = new Map<string, string[]>();
        reportTest.actionStepsMap = Object.fromEntries(
          reportTest.steps.map((s) => {
            const loc = locationMap.get(s.stepId);
            let stepCodeLine: string | undefined; // single line for actionStepsMap
            if (loc?.file) {
              if (!fileLines.has(loc.file)) {
                try {
                  fileLines.set(loc.file, fs.readFileSync(loc.file, 'utf-8').split('\n'));
                } catch {
                  fileLines.set(loc.file, []);
                }
              }
              const allLines = fileLines.get(loc.file)!;
              stepCodeLine = allLines[loc.line - 1]?.trim();

              // 3-line snippet: line before, the step line, line after (0-based indices)
              const prevIdx = loc.line - 2; // may be -1 (before file start)
              const nextIdx = loc.line; // loc.line is 1-based, so this is the next line's 0-based index
              const snippetLines: string[] = [];
              let startLine = loc.line; // 1-based start of snippet
              if (prevIdx >= 0) {
                snippetLines.push(allLines[prevIdx] ?? '');
                startLine = loc.line - 1;
              }
              snippetLines.push(allLines[loc.line - 1] ?? '');
              if (nextIdx < allLines.length) {
                snippetLines.push(allLines[nextIdx] ?? '');
              }
              s.code = snippetLines.join('\n');
              s.codeStartLine = startLine;
              s.codeLine = loc.line;
            }
            const entry: ActionStepInfo = {
              description: s.description,
              ...(stepCodeLine && {
                action_entity: {
                  action_description: s.description,
                  action_data: {
                    action_name: 'js_code',
                    args: [],
                    kwargs: { code: stepCodeLine },
                  },
                },
              }),
            };
            return [s.stepId, entry];
          }),
        );
      }
    }

    // Preserve actionStepsMap for cloud upload (required by ReportV2 schema)
    if (Object.keys(actionStepsMap).length > 0) {
      reportTest.actionStepsMap = actionStepsMap;
    } else if (stepResults && reportTest.steps.length > 0) {
      // Hand-written TS test using Shiplight fixture: no YAML source, so actionStepsMap was
      // never populated. Build it from stepResults using the recorded type + description.
      reportTest.actionStepsMap = Object.fromEntries(
        reportTest.steps.map((s) => {
          const execResult = stepResults![s.stepId];
          const type = execResult?.type as string | undefined;
          const entry: ActionStepInfo = {
            description: s.description,
            ...(type && {
              action_entity: {
                action_description: s.description,
                action_data: {
                  action_name: type === 'step' ? 'js_code' : type,
                  args: [],
                  kwargs: type === 'step' ? { code: execResult?.code ?? s.description } : { statement: s.description },
                },
              },
            }),
          };
          return [s.stepId, entry];
        }),
      );
    }

    // Recorded as changes from the previous step, not as a full copy of the
    // variable store per step. Encoded here, per attempt, because that is the
    // scope the accumulated state resets on. See ./contextDelta.ts.
    reportTest.steps = encodeStepContexts(reportTest.steps);

    return reportTest;
  }
}

export default ShiplightReporter;
