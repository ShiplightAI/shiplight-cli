// Report Command
//
// Regenerates the Shiplight HTML report from a previously saved report-data.json.
// This enables fast iteration on the report template without rerunning tests.
//
// Usage:
//   shiplight report [folder]                                # default: ./shiplight-report
//   shiplight report --open                                  # regenerate and open in browser
//   shiplight report --merge dir1/ dir2/ [-o output-dir]     # merge multiple shard reports
//   shiplight report --merge all-shards/*/shiplight-report/  # merge with glob (shell-expanded)
//   shiplight report --merge dir1/ dir2/ --github-summary    # merge and write GitHub step summary
//   shiplight report --trigger Jenkins                       # override CI trigger auto-detection

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';
import { type ReportData, type ReportTest, type ReportStep } from '../reporter/template.js';
import { writeHtmlReport, writeReportDataFile } from '../reporter/reportFiles.js';
import { summarizeUploadError, uploadToCloud } from '../reporter/cloudUpload.js';
import { mergeUsageSummaries } from '../reporter/runUsageAggregate.js';
import { mergeCacheSummaries } from '../cache/cacheMetadataCollector.js';
import { mergeCacheExecutionSummaries } from '../reporter/cacheExecutionSummary.js';
import { looksLikeFlag, takeFlagValues } from '../argv.js';
import type { RunCacheExecutionSummary, RunCacheSummary, RunUsageSummary } from 'shiplight-types';
import { PUBLISHED_VERSION } from '../versionCheck.js';

export async function runReport(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: shiplight report [folder] [options]');
    console.log('       shiplight report --merge <dirs...> [options]');
    console.log('');
    console.log('Regenerates index.html from report-data.json in the given folder.');
    console.log('With --merge, combines multiple shard report directories into one.');
    console.log('');
    console.log('Options:');
    console.log('  --open             Open the report in the default browser after generating');
    console.log('  --merge            Merge multiple report directories into one');
    console.log('  -o, --output <dir> Output directory for merged report (default: ./shiplight-report)');
    console.log('  --github-summary   Write test summary to $GITHUB_STEP_SUMMARY');
    console.log('  --trigger <name>   Label the uploaded run with this trigger instead of');
    console.log('                     auto-detecting it. Auto-detection recognizes GitHub');
    console.log('                     Actions, GitLab CI and CircleCI, and falls back to');
    console.log('                     "Local" everywhere else.');
    console.log('');
    console.log('Examples:');
    console.log(
      '  shiplight report                                              # regenerate ./shiplight-report/index.html',
    );
    console.log('  shiplight report my-report --open                             # regenerate and open');
    console.log('  shiplight report --merge all-shards/*/shiplight-report/       # merge shard reports');
    console.log('  shiplight report --merge shard-0/ shard-1/ -o combined-report # merge with custom output');
    console.log('  shiplight report --trigger Jenkins                            # label the run as a Jenkins run');
    process.exit(0);
  }

  const { trigger, rest, warnings } = extractTriggerOption(args);
  for (const warning of warnings) console.warn(`Warning: ${warning}`);

  const shouldOpen = rest.includes('--open');
  const isMerge = rest.includes('--merge');
  const githubSummary = rest.includes('--github-summary');

  if (!isMerge && githubSummary) {
    console.warn('Warning: --github-summary is only supported with --merge, ignoring.');
  }

  if (isMerge) {
    await runMergeReport(rest, shouldOpen, githubSummary, trigger);
  } else {
    await runSingleReport(rest, shouldOpen, trigger);
  }
}

/** Whether a `--trigger` value names a directory that exists — see below. */
function namesExistingDirectory(candidate: string): boolean {
  try {
    return fs.statSync(path.resolve(process.cwd(), candidate)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Pull `--trigger <value>` / `--trigger=<value>` out of the raw args and return
 * the remaining args.
 *
 * Removing the flag and its value matters for both paths: `runSingleReport`
 * takes the first non-flag arg as the report folder, and `runMergeReport`
 * treats every non-flag arg as an input directory. Left in place,
 * `--trigger Jenkins` would be read as a folder named "Jenkins".
 *
 * A value that is missing or blank is a warning, never an error. Both spellings
 * of the same CI mistake produce it — `--trigger "$VAR"` with VAR unset passes
 * an empty string, `--trigger $VAR` unquoted drops the argument entirely — and
 * failing the command would cost the whole report (merge, GitHub step summary,
 * cloud upload) over a cosmetic label. Falling back to auto-detection here
 * matches what `resolveTrigger` already does with a blank override.
 *
 * The last valid value wins. An earlier malformed occurrence still warns, but
 * it must not discard a good value supplied later on the same command line.
 *
 * The unquoted-and-unset form has a second failure this cannot parse its way
 * out of: `--trigger $VAR my-report` reaches us as `--trigger my-report`, which
 * is indistinguishable from someone labelling the run "my-report". A value that
 * names a real directory is the one detectable signal, so it warns rather than
 * silently reporting on the default folder. `dirExists` is injectable so the
 * parser stays testable without touching the filesystem.
 */
export function extractTriggerOption(
  args: string[],
  dirExists: (candidate: string) => boolean = namesExistingDirectory,
): { trigger?: string; rest: string[]; warnings: string[] } {
  const { occurrences, remaining } = takeFlagValues(args, '--trigger');

  let trigger: string | undefined;
  let sawEmptyValue = false;
  let pathLikeValue: string | undefined;

  for (const occurrence of occurrences) {
    const value = occurrence.value?.trim();
    if (!value) {
      sawEmptyValue = true;
      continue;
    }
    trigger = value;
    // Only the space-separated spelling is ambiguous; `--trigger=my-report`
    // says plainly that the folder is not what was meant.
    pathLikeValue = !occurrence.inline && dirExists(value) ? value : undefined;
  }

  // A folder still on the command line proves the value cannot have swallowed
  // one, so the path-like warning would only be noise. Covers the merge case
  // too, where the leftovers are shard directories.
  const explicitPathGiven = remaining.some((arg) => !looksLikeFlag(arg));

  const warnings: string[] = [];
  if (sawEmptyValue) {
    warnings.push(
      trigger
        ? `--trigger was given without a value at least once; using "${trigger}".`
        : '--trigger was given without a value; falling back to CI auto-detection.',
    );
  }
  if (pathLikeValue && !explicitPathGiven) {
    warnings.push(
      `Read "${pathLikeValue}" as the --trigger value, not as the report folder. ` +
        `Use --trigger=<name> if that was intended.`,
    );
  }

  return { trigger, rest: remaining, warnings };
}

function resolveDefaultReportFolder(): string {
  try {
    return fs.realpathSync('shiplight-report/latest');
  } catch {
    return 'shiplight-report';
  }
}

async function runSingleReport(args: string[], shouldOpen: boolean, triggerOverride?: string) {
  // `looksLikeFlag`, not a `--` test: a leftover single-dash token (an unknown
  // flag, or a `--trigger -nightly` value the parser declined to swallow) would
  // otherwise be resolved as the report folder and fail the whole command.
  const folder = args.find((a) => !looksLikeFlag(a)) || resolveDefaultReportFolder();

  const outputDir = path.isAbsolute(folder) ? folder : path.join(process.cwd(), folder);

  const reportDataPath = path.join(outputDir, 'report-data.json');

  if (!fs.existsSync(reportDataPath)) {
    console.error(`Error: ${reportDataPath} not found.`);
    console.error('Run a test first to generate report artifacts, then use this command to regenerate the HTML.');
    process.exit(1);
  }

  let reportData: ReportData;
  try {
    reportData = JSON.parse(fs.readFileSync(reportDataPath, 'utf-8'));
  } catch (err) {
    console.error(`Error: Failed to parse ${reportDataPath}`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const htmlPath = path.join(outputDir, 'index.html');
  const htmlWritten = writeHtmlReport(htmlPath, { ...reportData, outputDir });

  if (htmlWritten) console.log(`Shiplight report regenerated: ${htmlPath}`);

  // Cloud upload
  await maybeUploadToCloud(reportData, outputDir, triggerOverride);

  // Gated on the render: with no index.html, `--open` would open nothing, or —
  // worse — a previous run's report left in the same output directory.
  if (shouldOpen && htmlWritten) {
    try {
      const open = (await import('open')).default;
      await open(htmlPath);
    } catch {
      /* open is optional */
    }
  }
}

async function runMergeReport(args: string[], shouldOpen: boolean, githubSummary: boolean, triggerOverride?: string) {
  // Parse --output / -o flag
  let outputDir = path.join(process.cwd(), 'shiplight-report');
  const outputIdx = args.findIndex((a) => a === '-o' || a === '--output');
  if (outputIdx !== -1 && args[outputIdx + 1]) {
    const outputArg = args[outputIdx + 1];
    outputDir = path.isAbsolute(outputArg) ? outputArg : path.join(process.cwd(), outputArg);
  }

  // Collect input directories (everything that's not a flag or flag value).
  // Skipping every dash-prefixed token, rather than an allowlist of known
  // flags, keeps an unknown or mistyped flag from being resolved as a shard
  // directory and reported as a missing report-data.json.
  const flagsWithValues = new Set(['-o', '--output']);
  const inputDirs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (flagsWithValues.has(arg)) {
      i++; // skip next arg (flag value)
      continue;
    }
    if (looksLikeFlag(arg)) continue;
    const resolved = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
    inputDirs.push(resolved);
  }

  if (inputDirs.length === 0) {
    console.error('Error: --merge requires at least one input directory.');
    console.error('Usage: shiplight report --merge dir1/ dir2/ [-o output-dir]');
    process.exit(1);
  }

  // Merge report data from all shards
  const allTests: ReportTest[] = [];
  const shardUsageSummaries: (RunUsageSummary | undefined)[] = [];
  const shardCacheSummaries: (RunCacheSummary | undefined)[] = [];
  const shardCacheExecutionSummaries: (RunCacheExecutionSummary | undefined)[] = [];
  const shardClientRunIds: string[] = [];
  let containsDirectShardReport = false;
  let totalDuration = 0;
  let shardCount = 0;

  fs.mkdirSync(path.join(outputDir, 'screenshots'), { recursive: true });

  for (let shardIdx = 0; shardIdx < inputDirs.length; shardIdx++) {
    const dir = inputDirs[shardIdx];
    const shardLabel = `shard-${shardIdx}`;
    const reportDataPath = path.join(dir, 'report-data.json');

    if (!fs.existsSync(reportDataPath)) {
      console.warn(`Warning: No report-data.json found in ${dir}, skipping.`);
      continue;
    }

    let shardData: ReportData;
    try {
      shardData = JSON.parse(fs.readFileSync(reportDataPath, 'utf-8'));
    } catch (err) {
      console.warn(`Warning: Failed to parse ${reportDataPath}, skipping.`);
      continue;
    }

    console.log(`Merging ${shardLabel}: ${shardData.tests.length} tests from ${dir}`);
    // Sum of shard durations (total CPU-seconds, not wall-clock — shards run in parallel)
    totalDuration += shardData.totalDuration || 0;
    // Each shard's per-operation LLM usage rides in its report-data.json; sum them.
    shardUsageSummaries.push(shardData.usageSummary);
    // Same for the action-entity cache summary. Without this the merged report
    // — the only one a sharded CI run uploads — would carry no cache stats at
    // all, for exactly the runs the cache feature exists to serve.
    shardCacheSummaries.push(shardData.cacheSummary);
    // Unlike cacheSummary, this one is a plain sum: shards execute disjoint tests,
    // so no statement is counted twice. See mergeCacheExecutionSummaries.
    shardCacheExecutionSummaries.push(shardData.cacheExecutionSummary);
    if (shardData.clientRunId) shardClientRunIds.push(shardData.clientRunId);
    containsDirectShardReport ||= isDirectShardReport(shardData);

    // Copy screenshots with shard prefix
    const srcScreenshotsDir = path.join(dir, 'screenshots');
    if (fs.existsSync(srcScreenshotsDir)) {
      copyDirRecursive(srcScreenshotsDir, path.join(outputDir, 'screenshots', shardLabel));
    }

    // Copy traces and videos with shard prefix
    const shardArtifactDir = path.join(outputDir, shardLabel);

    for (const test of shardData.tests) {
      // Rewrite paths for test + each attempt in one pass
      const targets = [test, ...(test.attempts || [])];
      for (const target of targets) {
        rewriteScreenshots(target.steps, shardLabel);

        if (target.videoPath) {
          const copied = safeCopyArtifact(dir, target.videoPath, shardArtifactDir);
          if (copied) target.videoPath = `${shardLabel}/${target.videoPath}`;
        }

        if (target.tracePath) {
          const copied = safeCopyArtifact(dir, target.tracePath, shardArtifactDir);
          if (copied) target.tracePath = `${shardLabel}/${target.tracePath}`;
        }
      }

      allTests.push(test);
    }

    shardCount++;
  }

  if (allTests.length === 0) {
    console.error('Error: No tests found across any input directories.');
    process.exit(1);
  }

  // Stamp the merged report with the version of `shiplight report` that
  // combined the shards. Individual shards may have been produced by
  // different shiplightai versions — their originals are preserved in
  // the per-shard report-data.json files on disk. `PUBLISHED_VERSION`
  // is `undefined` for dev builds, so uploaded artifacts never carry
  // `"dev"` as the version; `undefined` is dropped by JSON.stringify.
  const reportData: ReportData = {
    clientRunId:
      new Set(shardClientRunIds).size === 1
        ? shardClientRunIds[0]
        : `merge-${createHash('sha256')
            .update(JSON.stringify(allTests.map((test) => [test.file, test.title, test.startTime])))
            .digest('hex')}`,
    tests: allTests,
    totalDuration,
    timestamp: new Date().toISOString(),
    shiplightVersion: PUBLISHED_VERSION,
    usageSummary: mergeUsageSummaries(shardUsageSummaries),
    cacheSummary: mergeCacheSummaries(shardCacheSummaries),
    cacheExecutionSummary: mergeCacheExecutionSummaries(shardCacheExecutionSummaries),
  };

  // Write merged report-data.json and HTML
  // Streamed, not `JSON.stringify(reportData, null, 2)`: a merged run of a few
  // hundred tests passes V8's maximum string length and the stringify throws
  // RangeError, killing the merge before the cloud upload below ever runs.
  writeReportDataFile(path.join(outputDir, 'report-data.json'), reportData);
  const htmlPath = path.join(outputDir, 'index.html');
  const htmlWritten = writeHtmlReport(htmlPath, { ...reportData, outputDir });

  console.log(
    htmlWritten
      ? `\nMerged ${allTests.length} tests from ${shardCount} shards into: ${htmlPath}`
      : `\nMerged ${allTests.length} tests from ${shardCount} shards into: ${outputDir} (report-data.json only)`,
  );

  // Direct-upload shards have already registered and completed their own
  // batches. Uploading this merged artifact as a legacy completion would mix
  // two protocols under the shared clientRunId and could duplicate slots.
  if (containsDirectShardReport && isReportToCloudEnabled()) {
    console.warn('[report] Shards were uploaded directly; skipping cloud upload of the merged report.');
  } else {
    await maybeUploadToCloud(reportData, outputDir, triggerOverride);
  }

  // GitHub step summary
  if (githubSummary) {
    writeGitHubSummary(allTests);
  }

  // Gated on the render: with no index.html, `--open` would open nothing, or —
  // worse — a previous run's report left in the same output directory.
  if (shouldOpen && htmlWritten) {
    try {
      const open = (await import('open')).default;
      await open(htmlPath);
    } catch {
      /* open is optional */
    }
  }
}

export function isDirectShardReport(reportData: Pick<ReportData, 'batchId' | 'expectedBatchCount'>): boolean {
  return Boolean(reportData.batchId?.trim() || reportData.expectedBatchCount !== undefined);
}

// Validate that artifactPath doesn't escape baseDir via path traversal (e.g. ../../etc/passwd),
// then copy if valid. Returns true if copy succeeded.
function safeCopyArtifact(baseDir: string, artifactPath: string, destDir: string): boolean {
  const resolvedSrc = path.resolve(baseDir, artifactPath);
  if (!resolvedSrc.startsWith(path.resolve(baseDir) + path.sep)) {
    console.warn(`Warning: Skipping artifact with path traversal: ${artifactPath}`);
    return false;
  }
  if (!fs.existsSync(resolvedSrc)) return false;
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(resolvedSrc, path.join(destDir, artifactPath));
  return true;
}

function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function rewriteScreenshots(steps: ReportStep[], shardLabel: string) {
  for (const step of steps) {
    if (step.screenshot?.startsWith('screenshots/')) {
      step.screenshot = step.screenshot.replace('screenshots/', `screenshots/${shardLabel}/`);
    }
  }
}

// `SHIPLIGHT_REPORT_TO_CLOUD` is the canonical name; `REPORT_TO_CLOUD` is kept
// for backwards compatibility with older CI configs.
export function isReportToCloudEnabled(): boolean {
  const raw = process.env.SHIPLIGHT_REPORT_TO_CLOUD ?? process.env.REPORT_TO_CLOUD;
  if (!raw) return false;
  return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

async function maybeUploadToCloud(reportData: ReportData, outputDir: string, triggerOverride?: string): Promise<void> {
  if (!isReportToCloudEnabled()) return;
  const apiToken = process.env.SHIPLIGHT_API_TOKEN;
  if (!apiToken) {
    const activeVar =
      process.env.SHIPLIGHT_REPORT_TO_CLOUD !== undefined ? 'SHIPLIGHT_REPORT_TO_CLOUD' : 'REPORT_TO_CLOUD';
    console.warn(`[report] ${activeVar} is enabled but no SHIPLIGHT_API_TOKEN found, skipping cloud upload.`);
    return;
  }
  // Derive run start time from the earliest test start, falling back to report timestamp
  const startTimes = reportData.tests.map((t) => t.startTime).filter((t): t is string => Boolean(t));
  const runStartTime =
    startTimes.length > 0 ? startTimes.sort()[0] : (reportData.timestamp ?? new Date().toISOString());
  try {
    // Non-fatal: don't fail the report step if cloud upload fails
    await uploadToCloud(reportData, outputDir, runStartTime, apiToken, triggerOverride);
  } catch (err) {
    console.warn('[report] Cloud upload failed:', summarizeUploadError(err));
  }
}

function getTestDisplayName(test: ReportTest): { name: string; yamlPath: string } {
  const yamlFile = test.file.replace('.yaml.spec.ts', '.test.yaml');
  const yamlPath = path.join('tests', path.basename(yamlFile));
  // Prefer test.title (from Playwright) over re-reading YAML, which won't work in CI
  // where the working directory isn't the repo root.
  const name = test.title || path.basename(yamlFile);
  return { name, yamlPath };
}

export function buildGitHubSummary(allTests: ReportTest[]): string {
  // Filter out Playwright setup files (auth.setup) which are infrastructure,
  // not user-facing tests — they'd clutter the summary without adding signal.
  const tests = allTests.filter((t) => !t.file.includes('auth.setup'));
  const flaky = tests.filter((t) => t.flaky);
  const retried = tests.filter((t) => !t.flaky && t.retries != null && t.retries > 0);
  const passed = tests.filter((t) => t.status === 'passed' && !t.flaky);
  const failed = tests.filter((t) => t.status !== 'passed');
  const total = tests.length;

  let summary = '## Test Results\n\n';

  if (failed.length === 0 && flaky.length === 0) {
    summary += `✅ All ${total} tests passed\n\n`;
  } else if (failed.length === 0) {
    summary += `✅ ${passed.length} passed, ⚠️ ${flaky.length} flaky / ${total} total\n\n`;
  } else {
    summary += `❌ ${failed.length} failed, ⚠️ ${flaky.length} flaky, ✅ ${passed.length} passed / ${total} total\n\n`;
  }

  if (failed.length > 0) {
    const failedPaths = [...new Set(failed.map((t) => getTestDisplayName(t).yamlPath))];
    summary += '### Failed\n\n';
    for (const p of failedPaths) {
      summary += `- \`npx shiplight test ${p}\`\n`;
    }
    summary += '\n**Run all failed tests**\n\n';
    summary += '```sh\n';
    summary += `npx shiplight test ${failedPaths.map((p) => `"${p}"`).join(' \\\n  ')}\n`;
    summary += '```\n\n';
  }

  if (flaky.length > 0) {
    const flakyPaths = [...new Set(flaky.map((t) => getTestDisplayName(t).yamlPath))];
    summary += `### Flaky (${flakyPaths.length})\n\n`;
    for (const p of flakyPaths) {
      summary += `- \`${p}\`\n`;
    }
    summary += '\n';
  }

  if (retried.length > 0) {
    const retriedPaths = [...new Set(retried.map((t) => getTestDisplayName(t).yamlPath))];
    summary += `### Retried (${retriedPaths.length})\n\n`;
    for (const p of retriedPaths) {
      summary += `- \`${p}\`\n`;
    }
    summary += '\n';
  }

  if (passed.length > 0) {
    const passedPaths = [...new Set(passed.map((t) => getTestDisplayName(t).yamlPath))];
    summary += `<details><summary>Passed (${passedPaths.length})</summary>\n\n`;
    for (const p of passedPaths) {
      summary += `- ${p}\n`;
    }
    summary += '\n</details>\n';
  }

  return summary;
}

function writeGitHubSummary(allTests: ReportTest[]) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    console.warn('Warning: $GITHUB_STEP_SUMMARY not set, skipping GitHub summary.');
    return;
  }
  fs.appendFileSync(summaryPath, buildGitHubSummary(allTests));
  console.log('GitHub step summary written.');
}
