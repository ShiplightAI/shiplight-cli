/**
 * HTML template for the Shiplight reporter.
 * Self-contained HTML using CSS-only interactions (<details>/<summary>).
 */

import path from 'node:path';
import type { ActionEntity, RunCacheExecutionSummary, RunUsageSummary } from 'shiplight-types';
import type { StepLlmUsageRecord } from './runUsageAggregate.js';
import { hasCacheExecutionSignal } from './cacheExecutionSummary.js';
import type { ModelTierProvenance } from '../orgSettings.js';

/**
 * A step's variable snapshot recorded as a change from the previous step's
 * state. `{}` means a snapshot was taken and nothing had changed — distinct
 * from the field being absent, which means no snapshot was taken at all.
 * Contract: specs/002-shiplightai-cli/contracts/report-artifact.md.
 */
export interface VariableDelta {
  set?: Record<string, unknown>;
  removed?: string[];
}

export interface ReportStep {
  stepId: string;
  description: string;
  /**
   * `'warning'` is a soft outcome that does not fail the test (a WAIT_UNTIL that
   * timed out). It was missing from this union even though the runtime writes it —
   * `StepExecutionResult.status` has carried it all along and the reporter copies
   * the value straight through — so any code branching on the status was silently
   * told the case could not happen. `'pending'` is what the reporter substitutes
   * when a step result carries no status at all, which is the common shape for a
   * step that hung until the test timed out or threw with self-healing disabled.
   */
  status: 'success' | 'failure' | 'skipped' | 'pending' | 'warning';
  duration?: number;
  error?: string;
  message?: string; // AI feedback / explanation
  screenshot?: string; // base64 data URI or relative path
  /** Source code snippet (up to 3 lines: prev + step + next), shown when no screenshot */
  code?: string;
  /** 1-based line number of the first line in `code` */
  codeStartLine?: number;
  /** 1-based line number of the step's actual source line (highlighted in the snippet) */
  codeLine?: number;
  type?: string;
  startTime?: number;
  autoHealed?: boolean;
  /** Self-healing ran for this step and failed to recover it (see StepExecutionResult.healFailed) */
  healFailed?: boolean;
  /** YAML statement UID this step executed — the join key to transpile-time cache provenance */
  stmtUid?: string;
  /** Action entity selected from cache and actually attempted for this step. Presence means cache hit. */
  cachedAction?: ActionEntity;
  healedAction?: Record<string, unknown>;
  dismissedModalActions?: Array<Record<string, unknown>>;
  /**
   * The variable store as this step saw it. Display-only — nothing replays or
   * asserts from it. Written in full by the engine; recorded in the report as
   * the `*Delta` fields below. Both forms are readable, see ./contextDelta.ts.
   */
  contextBefore?: Record<string, unknown>;
  contextAfter?: Record<string, unknown>;
  /** What changed since the previous step's recorded state. Never present alongside its full form. */
  contextBeforeDelta?: VariableDelta;
  contextAfterDelta?: VariableDelta;
  /** Raw per-call LLM usage records for this step, if any (spec 047 analytics plane) */
  llmUsage?: StepLlmUsageRecord[];
}

export interface ReportAttempt {
  attemptNumber: number;
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  duration: number;
  steps: ReportStep[];
  error?: string;
  videoPath?: string;
  tracePath?: string;
  /**
   * Console output captured for this attempt specifically. Held per attempt
   * because the output of a *failed* attempt is the reason to open a retried
   * test's report, and only the final attempt's is reachable from `ReportTest`.
   */
  stdout?: string;
  stderr?: string;
}

export interface ReportTest {
  title: string;
  file: string;
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  duration: number;
  steps: ReportStep[];
  error?: string;
  videoPath?: string;
  tracePath?: string;
  flaky?: boolean;
  retries?: number;
  attempts?: ReportAttempt[];
  /** ISO 8601 start time of this test (from Playwright TestResult.startTime) */
  startTime?: string;
  /** ISO 8601 end time of this test */
  endTime?: string;
  /** stdout/stderr captured during test execution */
  stdout?: string;
  stderr?: string;
  /** Action steps map from YAML parsing — required for cloud upload */
  actionStepsMap?: Record<string, any>;
  /**
   * Playwright's `TestCase.tags` verbatim, `@` prefix included: the test's own
   * tags, those inherited from every enclosing `test.describe`, and any
   * parameter-set name, already merged by Playwright into one flat list. See
   * ./reportTags.ts for why they are not re-derived from the YAML.
   */
  tags?: string[];
  /** Base URL the suite/test was run against (from YAML base_url) */
  baseUrl?: string;
  /** Whether this test is marked to skip in YAML */
  skip?: boolean | string;
  /** Whether this test is marked as slow in YAML */
  slow?: boolean;
  /** Test-level timeout in ms from YAML */
  timeout?: number;
  /** Suite name if this test belongs to a YAML suite file */
  suiteName?: string;
  /** Parameter set name if this test was generated from a YAML parameter set */
  parameterSetName?: string;
  /** Base title of the test (from YAML test name) */
  baseTitle?: string;
  /**
   * What the action-entity cache did for THIS test, counted from the statements that
   * actually executed. Absent when the test executed no statement carrying a UID
   * (a hand-written TS test, or one made only of DRAFTs).
   */
  cacheExecution?: RunCacheExecutionSummary;
}

export interface ReportCacheSummary {
  total_statements: number;
  original: number;
  cache_hits: number;
  healed: number;
  failed: number;
}

export interface ReportData {
  tests: ReportTest[];
  totalDuration: number;
  timestamp: string; // ISO 8601
  /** Absolute path to the report output directory, used to resolve artifact paths */
  outputDir?: string;
  /**
   * Version of `shiplightai` that produced this report. Captured from
   * the build-time `__SHIPLIGHTAI_VERSION__` macro by the reporter. Used
   * for post-hoc traceability of uploaded artifacts and rendered in the
   * HTML report footer. Optional because older report-data.json files
   * saved before this field was added do not carry it; renderers must
   * tolerate the missing field.
   */
  shiplightVersion?: string;
  /** Action entity cache stats (present when SHIPLIGHT_API_TOKEN is configured) */
  cacheSummary?: ReportCacheSummary;
  /**
   * What the action-entity cache did during the run, counted over the statements
   * that actually EXECUTED — as opposed to `cacheSummary`, which counts what the
   * transpiler saw across the whole corpus. This is the pair of numbers that
   * answers "how many model calls did the cache save, and how often did auto-heal
   * still have to fire". Absent when the run executed no UID-carrying statement.
   */
  cacheExecutionSummary?: RunCacheExecutionSummary;
  /**
   * Per-operation LLM usage for the run (spec 047 analytics plane). Aggregated at
   * report time from the agent's ai-actions.json, folded in here so it survives
   * merge/regenerate/upload. Absent when nothing was captured.
   */
  usageSummary?: RunUsageSummary;
  /**
   * How this run's models were chosen under LLM tier selection (design §4).
   * Present only when tier selection governed the run (a Shiplight-proxy run
   * carrying tier information); absent for BYOK and for proxy runs with no tier
   * info, so renderers must tolerate the missing field.
   */
  modelTierProvenance?: ModelTierProvenance;
}

/**
 * The execution-scoped cache block: what the cache did for the statements that
 * actually ran. Rendered above the transpile-time row and labelled distinctly,
 * because the two count different populations and reading them as one set of
 * numbers is the mistake this block exists to prevent.
 *
 * `auto_healed + auto_heal_failed` is shown as one "auto-healed" figure with the
 * failures called out: both spent a model call, which is what the comparison
 * against `cache_served` is about.
 */
function renderCacheExecution(s: RunCacheExecutionSummary): string {
  const healAttempts = s.auto_healed + s.auto_heal_failed;
  const stats = [
    s.cache_served > 0
      ? `<span class="summary-stat" style="color:var(--color-accent)">${s.cache_served} served from cache</span>`
      : '',
    healAttempts > 0
      ? `<span class="summary-stat" style="color:var(--color-flaky)">${healAttempts} auto-healed${
          s.auto_heal_failed > 0 ? ` (${s.auto_heal_failed} failed)` : ''
        }</span>`
      : '',
    `<span class="summary-stat">${s.executed} executed</span>`,
  ]
    .filter(Boolean)
    .join('\n        ');
  return `
      <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:4px;">Statements that executed</div>
      <div class="summary" style="margin-bottom:10px;">
        ${stats}
      </div>`;
}

/** Human label for where the tier came from, for the report footer. */
function tierSourceLabel(source: ModelTierProvenance['tierSource']): string {
  switch (source) {
    case 'env':
      return 'from WEB_AGENT_TIER';
    case 'org-default':
      return 'org default';
    case 'baked-default':
      return 'built-in default';
  }
  // Exhaustive over TierSource today; a future member trips this at compile time
  // (apps/cli does not set noImplicitReturns, so without this a new source would
  // silently render "(undefined)" in the footer).
  const exhaustive: never = source;
  return exhaustive;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = ((ms % 60_000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}

export function formatRetryLabel(retries: number | undefined): string {
  const count = retries || '?';
  const noun = retries === 1 ? 'retry' : 'retries';
  return `passed after ${count} ${noun}`;
}

export function formatRetriedLabel(retries: number | undefined, finalStatus: string): string {
  const count = retries || '?';
  const noun = retries === 1 ? 'retry' : 'retries';
  if (finalStatus === 'passed') return `passed after ${count} ${noun}`;
  return `failed after ${count} ${noun}`;
}

function statusIcon(status: string): string {
  switch (status) {
    case 'passed':
    case 'success':
      return '<span class="status-icon passed">&#x2714;</span>';
    case 'flaky':
      return '<span class="status-icon flaky">&#x21BB;</span>';
    case 'failed':
    case 'failure':
    case 'timedOut':
      return '<span class="status-icon failed">&#x2718;</span>';
    case 'skipped':
      return '<span class="status-icon skipped">&#x2500;</span>';
    case 'interrupted':
      return '<span class="status-icon failed">&#x26A0;</span>';
    default:
      return '<span class="status-icon pending">&#x25CB;</span>';
  }
}

function statusBadge(status: string): string {
  return `<span class="badge badge-${status}">${status}</span>`;
}

function renderCodeBlock(step: ReportStep): string {
  if (!step.code) return '';
  const lines = step.code.split('\n');

  // File-snippet mode: codeStartLine + codeLine both set → show gutter + highlight step line
  if (step.codeStartLine != null && step.codeLine != null) {
    const linesHtml = lines.map((line, i) => {
      const lineNum = step.codeStartLine! + i;
      const isActive = lineNum === step.codeLine;
      const lineNumStr = String(lineNum).padStart(4);
      return `<span class="code-line${isActive ? ' code-line-active' : ''}">${lineNumStr} \u2502 ${escapeHtml(line)}</span>`;
    }).join('');
    return `<div class="step-code"><pre class="code-block">${linesHtml}</pre></div>`;
  }

  // Function-body mode: no file gutter, all lines shown as body code
  const linesHtml = lines.map(line =>
    `<span class="code-line code-line-body">${escapeHtml(line)}</span>`,
  ).join('');
  return `<div class="step-code"><pre class="code-block">${linesHtml}</pre></div>`;
}

function renderStep(step: ReportStep): string {
  const dur = step.duration != null ? `<span class="step-duration">${formatDuration(step.duration)}</span>` : '';
  const icon = statusIcon(step.status);
  const hasDetails = step.screenshot || step.message || step.error || step.code;

  if (hasDetails) {
    let screenshotBlock = '';
    if (step.screenshot) {
      screenshotBlock = `<img src="${escapeHtml(step.screenshot)}" alt="Step screenshot" class="step-screenshot" />`;
    }

    // Show code snippet only when there is no screenshot
    const codeBlock = !step.screenshot ? renderCodeBlock(step) : '';

    let errorBlock = '';
    if (step.error) {
      errorBlock = `<div class="step-error"><pre>${escapeHtml(step.error)}</pre></div>`;
    }

    let messageBlock = '';
    if (step.message && !step.error) {
      messageBlock = `<div class="step-message">${escapeHtml(step.message)}</div>`;
    }

    // Collapsed: icon + stepId + duration only
    // Expanded: screenshot (or code) → description → AI feedback/error
    const autoOpen = step.status === 'failure' ? ' open' : '';
    return `
    <details class="step-details step step-${step.status}"${autoOpen}>
      <summary class="step-header">
        ${icon}
        <span class="step-id">${escapeHtml(step.stepId)}</span>
        <span class="step-description-collapsed">${escapeHtml(step.description)}</span>
        ${dur}
      </summary>
      <div class="step-expanded">
        ${screenshotBlock}
        ${codeBlock}
        <div class="step-description-full">${escapeHtml(step.description)}</div>
        ${messageBlock}
        ${errorBlock}
      </div>
    </details>`;
  }

  // No details — plain row, not expandable
  return `
    <div class="step step-${step.status}">
      <div class="step-header">
        ${icon}
        <span class="step-id">${escapeHtml(step.stepId)}</span>
        <span class="step-description">${escapeHtml(step.description)}</span>
        ${dur}
      </div>
    </div>`;
}

function renderArtifacts(
  videoPath: string | undefined,
  tracePath: string | undefined,
  steps: ReportStep[],
  idPrefix: string,
): string {
  const artifactSections: string[] = [];

  if (videoPath) {
    artifactSections.push(`
      <details class="artifact-section">
        <summary class="artifact-summary">Video</summary>
        <div class="artifact-content">
          <div class="video-container">
            <video controls preload="metadata" class="artifact-video">
              <source src="${escapeHtml(videoPath)}" type="video/webm" />
            </video>
            <button class="enlarge-btn" onclick="openVideoOverlay(this)" title="Enlarge">&#x26F6;</button>
          </div>
        </div>
      </details>`);
  }

  const gallerySteps = steps
    .filter(s => s.screenshot)
    .map(s => ({
      src: s.screenshot!,
      stepId: s.stepId,
      description: s.description,
      status: s.status,
      message: s.message || s.error || '',
    }));

  if (gallerySteps.length > 0) {
    const galleryDataAttr = escapeHtml(JSON.stringify(gallerySteps));
    const thumbs = gallerySteps.map((s, i) => `
      <div class="screenshot-thumb" onclick="openGalleryAt(this, ${i})" data-gallery="${galleryDataAttr}">
        <img src="${escapeHtml(s.src)}" alt="${escapeHtml(s.stepId)}" />
        <span class="thumb-label">${escapeHtml(s.stepId)}</span>
      </div>`).join('');

    artifactSections.push(`
      <details class="artifact-section">
        <summary class="artifact-summary">Screenshots (${gallerySteps.length})</summary>
        <div class="artifact-content">
          <div class="screenshot-grid">${thumbs}</div>
        </div>
      </details>`);
  }

  if (tracePath) {
    const traceAbsPath = escapeHtml(tracePath);
    artifactSections.push(`
      <details class="artifact-section">
        <summary class="artifact-summary">Trace</summary>
        <div class="artifact-content">
          <div class="trace-actions">
            <code class="trace-command" id="trace-cmd-${idPrefix}">npx playwright show-trace ${traceAbsPath}</code>
            <button class="copy-btn" onclick="copyTraceCmd('${idPrefix}')" title="Copy command">Copy</button>
          </div>
          <p class="trace-hint">Run this command in your terminal to open the interactive Trace Viewer</p>
          <p class="trace-hint"><a href="${escapeHtml(tracePath)}" class="attachment-link" download>Download trace.zip</a></p>
        </div>
      </details>`);
  }

  if (artifactSections.length === 0) return '';
  return `<div class="test-artifacts">${artifactSections.join('')}</div>`;
}

function renderAttemptBody(
  steps: ReportStep[],
  error: string | undefined,
  videoPath: string | undefined,
  tracePath: string | undefined,
  idPrefix: string,
): string {
  const stepsHtml = steps.map(renderStep).join('\n');

  let errorBlock = '';
  if (error && !steps.some(s => s.error)) {
    errorBlock = `<div class="test-error"><pre>${escapeHtml(error)}</pre></div>`;
  }

  const artifacts = renderArtifacts(videoPath, tracePath, steps, idPrefix);

  return `
    ${errorBlock}
    <div class="steps-list">
      ${stepsHtml || '<div class="no-steps">No YAML step details available</div>'}
    </div>
    ${artifacts}`;
}

function renderTest(test: ReportTest, index: number): string {
  const displayStatus = test.flaky ? 'flaky' : test.status;
  const icon = statusIcon(displayStatus);

  let bodyContent: string;

  if (test.attempts && test.attempts.length > 1) {
    // Tabbed view for any test with multiple attempts (flaky or all-failed retries)
    const tabGroupId = `tabs-${index}`;
    const totalAttempts = test.attempts.length;
    // For flaky tests default to the last (passed) tab; for all-failed show the last attempt too
    const defaultTab = totalAttempts - 1;

    const tabHeaders = test.attempts.map((attempt, i) => {
      const isActive = i === defaultTab;
      const tabStatus = attempt.status === 'passed' ? 'passed' : 'failed';
      const label = `Attempt ${attempt.attemptNumber}`;
      return `<button class="attempt-tab ${isActive ? 'active' : ''} attempt-tab-${tabStatus}"
        onclick="switchAttemptTab('${tabGroupId}', ${i})"
        data-tab-index="${i}">${statusIcon(tabStatus)} ${label} <span class="attempt-tab-badge badge-${tabStatus}">${attempt.status}</span></button>`;
    }).join('');

    const tabPanels = test.attempts.map((attempt, i) => {
      const isActive = i === defaultTab;
      const panelBody = renderAttemptBody(
        attempt.steps,
        attempt.error,
        attempt.videoPath,
        attempt.tracePath,
        `${index}-attempt-${i}`,
      );
      return `<div class="attempt-panel ${isActive ? 'active' : ''}" data-panel-index="${i}">
        <div class="attempt-meta">
          ${statusIcon(attempt.status === 'passed' ? 'passed' : 'failed')}
          <span class="attempt-meta-text">Attempt ${attempt.attemptNumber} &mdash; ${attempt.status} in ${formatDuration(attempt.duration)}</span>
        </div>
        ${panelBody}
      </div>`;
    }).join('');

    const noteLabel = test.flaky
      ? `Flaky &mdash; ${formatRetryLabel(test.retries)}`
      : `Retried &mdash; ${formatRetriedLabel(test.retries, test.status)}`;
    const noteClass = test.flaky ? 'flaky-note' : 'retried-note';

    bodyContent = `
      <div class="${noteClass}">${noteLabel}</div>
      <div class="attempt-tabs" id="${tabGroupId}">
        <div class="attempt-tab-bar">${tabHeaders}</div>
        ${tabPanels}
      </div>`;
  } else {
    bodyContent = renderAttemptBody(test.steps, test.error, test.videoPath, test.tracePath, String(index));
  }

  return `
    <details class="test-details" ${test.status === 'failed' || test.status === 'timedOut' ? 'open' : ''}>
      <summary class="test-summary test-${displayStatus}">
        ${icon}
        <span class="test-title">${escapeHtml(test.title)}</span>
        <span class="test-file">${escapeHtml(test.file)}</span>
        ${statusBadge(displayStatus)}
        <span class="test-duration">${formatDuration(test.duration)}</span>
      </summary>
      <div class="test-body">
        ${bodyContent}
      </div>
    </details>`;
}

function resolveTracePath(tracePath: string | undefined, outputDir: string | undefined): string | undefined {
  if (!tracePath || !outputDir) return tracePath;
  if (path.isAbsolute(tracePath)) return tracePath;
  return path.join(outputDir, tracePath);
}

function resolveTestTracePaths(test: ReportTest, outputDir: string | undefined): ReportTest {
  if (!outputDir) return test;
  return {
    ...test,
    tracePath: resolveTracePath(test.tracePath, outputDir),
    attempts: test.attempts?.map(a => ({ ...a, tracePath: resolveTracePath(a.tracePath, outputDir) })),
  };
}

export function generateHtml(data: ReportData): string {
  const flaky = data.tests.filter(t => t.flaky).length;
  const retried = data.tests.filter(t => !t.flaky && t.retries != null && t.retries > 0).length;
  const passed = data.tests.filter(t => t.status === 'passed' && !t.flaky).length;
  const failed = data.tests.filter(t => t.status === 'failed' || t.status === 'timedOut').length;
  const skipped = data.tests.filter(t => t.status === 'skipped').length;
  const total = data.tests.length;

  const tests = data.tests.map(t => resolveTestTracePaths(t, data.outputDir));
  const testsHtml = tests.map((t, i) => renderTest(t, i)).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Shiplight Test Report</title>
  <style>
    :root {
      --color-bg: #1a1a2e;
      --color-surface: #16213e;
      --color-surface-hover: #1a2744;
      --color-border: #2a3a5c;
      --color-text: #e0e0e0;
      --color-text-secondary: #8892a4;
      --color-passed: #4caf50;
      --color-failed: #f44336;
      --color-skipped: #ff9800;
      --color-pending: #9e9e9e;
      --color-flaky: #ffab40;
      --color-accent: #64b5f6;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--color-bg);
      color: var(--color-text);
      line-height: 1.5;
      padding: 24px;
    }

    .container { max-width: 960px; margin: 0 auto; }

    .header {
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--color-border);
    }

    .header h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 12px;
    }

    .summary {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      align-items: center;
    }

    .summary-stat {
      font-size: 14px;
      padding: 4px 12px;
      border-radius: 4px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
    }

    .summary-stat.passed { border-color: var(--color-passed); }
    .summary-stat.flaky { border-color: var(--color-flaky); }
    .summary-stat.failed { border-color: var(--color-failed); }
    .summary-stat.retried { border-color: var(--color-flaky); }
    .summary-stat.skipped { border-color: var(--color-skipped); }

    .test-list { display: flex; flex-direction: column; gap: 8px; }

    .test-details {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      overflow: hidden;
    }

    .test-summary {
      padding: 12px 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      user-select: none;
      list-style: none;
    }

    .test-summary::-webkit-details-marker { display: none; }

    .test-summary:hover { background: var(--color-surface-hover); }

    .test-title { font-weight: 500; flex: 1; }

    .test-file {
      font-size: 12px;
      color: var(--color-text-secondary);
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .test-duration {
      font-size: 12px;
      color: var(--color-text-secondary);
      min-width: 50px;
      text-align: right;
    }

    .badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      font-weight: 600;
    }

    .badge-passed { background: rgba(76,175,80,0.2); color: var(--color-passed); }
    .badge-flaky { background: rgba(255,171,64,0.2); color: var(--color-flaky); }
    .badge-failed, .badge-timedOut { background: rgba(244,67,54,0.2); color: var(--color-failed); }
    .badge-skipped { background: rgba(255,152,0,0.2); color: var(--color-skipped); }
    .badge-interrupted { background: rgba(244,67,54,0.2); color: var(--color-failed); }

    .test-body { padding: 0 16px 16px; }

    .step-message {
      font-size: 12px;
      color: var(--color-text-secondary);
      margin: 4px 0;
      line-height: 1.4;
    }

    .flaky-note {
      background: rgba(255,171,64,0.1);
      border: 1px solid rgba(255,171,64,0.3);
      border-radius: 4px;
      padding: 6px 12px;
      margin-bottom: 8px;
      font-size: 13px;
      color: var(--color-flaky);
    }

    .retried-note {
      background: rgba(255,171,64,0.1);
      border: 1px solid rgba(255,171,64,0.3);
      border-radius: 4px;
      padding: 6px 12px;
      margin-bottom: 8px;
      font-size: 13px;
      color: var(--color-flaky);
    }

    .attempt-tabs { margin-top: 4px; }

    .attempt-tab-bar {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--color-border);
      padding-bottom: 0;
      margin-bottom: 12px;
    }

    .attempt-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 500;
      background: transparent;
      color: var(--color-text-secondary);
      border: 1px solid transparent;
      border-bottom: none;
      border-radius: 6px 6px 0 0;
      cursor: pointer;
      position: relative;
      bottom: -1px;
    }

    .attempt-tab:hover {
      background: var(--color-surface-hover);
      color: var(--color-text);
    }

    .attempt-tab.active {
      background: var(--color-surface);
      color: var(--color-text);
      border-color: var(--color-border);
    }

    .attempt-tab-badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 3px;
      text-transform: uppercase;
      font-weight: 600;
    }

    .attempt-panel {
      display: none;
    }

    .attempt-panel.active {
      display: block;
    }

    .attempt-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--color-text-secondary);
      margin-bottom: 8px;
      padding: 4px 0;
    }

    .attempt-meta-text {
      font-weight: 500;
    }

    .test-error, .step-error {
      background: rgba(244,67,54,0.1);
      border: 1px solid rgba(244,67,54,0.3);
      border-radius: 4px;
      padding: 8px 12px;
      margin: 8px 0;
    }

    .test-error pre, .step-error pre {
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      color: #ef9a9a;
    }

    .steps-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 8px;
    }

    .step, .step-details {
      padding: 6px 12px;
      border-radius: 4px;
      border-left: 3px solid transparent;
    }

    .step-success { border-left-color: var(--color-passed); }
    .step-failure { border-left-color: var(--color-failed); }
    .step-skipped { border-left-color: var(--color-skipped); }
    .step-pending { border-left-color: var(--color-pending); }

    .step-details { cursor: pointer; }
    .step-details > summary { list-style: none; }
    .step-details > summary::-webkit-details-marker { display: none; }
    .step-details > summary::before {
      content: '\\25B6';
      font-size: 9px;
      color: var(--color-text-secondary);
      margin-right: 4px;
      display: inline-block;
      transition: transform 0.15s;
    }
    .step-details[open] > summary::before {
      transform: rotate(90deg);
    }
    .step-details:hover { background: var(--color-surface-hover); }

    .step-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }

    .step-expanded {
      padding: 8px 0 4px 26px;
    }

    .step-id {
      font-family: monospace;
      font-size: 11px;
      color: var(--color-text-secondary);
      min-width: 60px;
    }

    .step-description { flex: 1; }
    .step-description-collapsed { flex: 1; }
    .step-details[open] .step-description-collapsed { display: none; }

    .step-description-full {
      font-size: 13px;
      margin-bottom: 4px;
    }

    .step-duration {
      font-size: 11px;
      color: var(--color-text-secondary);
      min-width: 40px;
      text-align: right;
    }

    .status-icon { font-size: 14px; width: 18px; text-align: center; display: inline-block; }
    .status-icon.passed { color: var(--color-passed); }
    .status-icon.flaky { color: var(--color-flaky); }
    .status-icon.failed { color: var(--color-failed); }
    .status-icon.skipped { color: var(--color-skipped); }
    .status-icon.pending { color: var(--color-pending); }

    .step-screenshot {
      max-width: 100%;
      border-radius: 4px;
      margin-bottom: 8px;
      border: 1px solid var(--color-border);
    }

    .test-artifacts {
      margin-top: 12px;
      padding-top: 8px;
      border-top: 1px solid var(--color-border);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .artifact-section {
      border: 1px solid var(--color-border);
      border-radius: 6px;
      overflow: hidden;
    }
    .artifact-summary {
      padding: 8px 12px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      user-select: none;
      color: var(--color-accent);
      list-style: none;
    }
    .artifact-summary::-webkit-details-marker { display: none; }
    .artifact-summary::before {
      content: '\\25B6';
      font-size: 9px;
      color: var(--color-text-secondary);
      margin-right: 6px;
      display: inline-block;
      transition: transform 0.15s;
    }
    .artifact-section[open] > .artifact-summary::before {
      transform: rotate(90deg);
    }
    .artifact-summary:hover { background: var(--color-surface-hover); }
    .artifact-content { padding: 8px 12px 12px; }

    .video-container { position: relative; display: inline-block; max-width: 100%; }
    .artifact-video {
      max-width: 100%;
      max-height: 400px;
      border-radius: 4px;
      border: 1px solid var(--color-border);
      display: block;
    }
    .enlarge-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(0,0,0,0.6);
      border: 1px solid rgba(255,255,255,0.2);
      color: white;
      font-size: 16px;
      width: 32px;
      height: 32px;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .video-container:hover .enlarge-btn { opacity: 1; }
    .enlarge-btn:hover { background: rgba(0,0,0,0.8); }

    .screenshot-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
    }
    .screenshot-thumb {
      cursor: pointer;
      border-radius: 4px;
      border: 1px solid var(--color-border);
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .screenshot-thumb:hover { border-color: var(--color-accent); }
    .screenshot-thumb img {
      width: 100%;
      display: block;
      aspect-ratio: 16/9;
      object-fit: cover;
    }
    .thumb-label {
      display: block;
      font-size: 10px;
      font-family: monospace;
      color: var(--color-text-secondary);
      padding: 3px 6px;
      text-align: center;
      background: var(--color-surface);
    }

    .trace-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .trace-command {
      flex: 1;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 4px;
      padding: 8px 12px;
      font-size: 12px;
      color: var(--color-text);
      white-space: nowrap;
      overflow-x: auto;
    }
    .copy-btn {
      background: var(--color-surface-hover);
      border: 1px solid var(--color-border);
      color: var(--color-accent);
      font-size: 12px;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      white-space: nowrap;
    }
    .copy-btn:hover { background: var(--color-border); }
    .trace-hint {
      font-size: 12px;
      color: var(--color-text-secondary);
      margin-top: 6px;
    }

    .attachment-link { color: var(--color-accent); text-decoration: none; }
    .attachment-link:hover { text-decoration: underline; }

    /* Video overlay */
    .video-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0,0,0,0.92);
      align-items: center;
      justify-content: center;
    }
    .video-overlay.active { display: flex; }
    .video-overlay video {
      max-width: 90vw;
      max-height: 90vh;
      border-radius: 4px;
    }
    .video-overlay .gallery-close {
      position: absolute;
      top: 12px;
      right: 16px;
    }

    .no-steps {
      font-size: 13px;
      color: var(--color-text-secondary);
      font-style: italic;
      padding: 8px 0;
    }

    .footer {
      margin-top: 24px;
      padding-top: 12px;
      border-top: 1px solid var(--color-border);
      font-size: 12px;
      color: var(--color-text-secondary);
      text-align: center;
    }

    /* Gallery lightbox */
    .gallery-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0,0,0,0.92);
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .gallery-overlay.active { display: flex; }

    .gallery-top {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      padding: 16px 24px;
      background: linear-gradient(rgba(0,0,0,0.6), transparent);
      text-align: center;
    }
    .gallery-step-id {
      font-family: monospace;
      font-size: 13px;
      color: var(--color-text-secondary);
      margin-right: 8px;
    }
    .gallery-description {
      font-size: 15px;
      color: var(--color-text);
    }
    .gallery-counter {
      font-size: 12px;
      color: var(--color-text-secondary);
      margin-top: 4px;
    }

    .gallery-img-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 60px 80px;
      min-height: 0;
      width: 100%;
    }
    .gallery-img-container img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 4px;
    }

    .gallery-bottom {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 16px 24px;
      background: linear-gradient(transparent, rgba(0,0,0,0.6));
      text-align: center;
    }
    .gallery-message {
      font-size: 13px;
      color: var(--color-text-secondary);
      max-height: 80px;
      overflow-y: auto;
      line-height: 1.4;
    }

    .gallery-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      color: white;
      font-size: 24px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
    }
    .gallery-nav:hover { background: rgba(255,255,255,0.2); }
    .gallery-nav.prev { left: 16px; }
    .gallery-nav.next { right: 16px; }

    .gallery-close {
      position: absolute;
      top: 12px;
      right: 16px;
      background: none;
      border: none;
      color: white;
      font-size: 28px;
      cursor: pointer;
      opacity: 0.7;
      z-index: 1;
    }
    .gallery-close:hover { opacity: 1; }

    .gallery-status {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 6px;
      vertical-align: middle;
    }
    .gallery-status.success { background: var(--color-passed); }
    .gallery-status.failure { background: var(--color-failed); }
    .gallery-status.skipped { background: var(--color-skipped); }
    .gallery-status.pending { background: var(--color-pending); }

    .step-code {
      margin: 6px 0 4px;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid var(--color-border);
    }
    .code-block {
      background: #0d1117;
      padding: 4px 0;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 12px;
      line-height: 1.6;
      overflow-x: auto;
      display: block;
      margin: 0;
    }
    .code-line {
      display: block;
      padding: 0 12px;
      white-space: pre;
      color: var(--color-text-secondary);
    }
    .code-line-active {
      background: rgba(100, 181, 246, 0.1);
      color: var(--color-text);
      border-left: 2px solid var(--color-accent);
      padding-left: 10px;
    }
    .code-line-body {
      color: var(--color-text);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Shiplight Test Report</h1>
      <div class="summary">
        <span class="summary-stat">${total} test${total !== 1 ? 's' : ''}</span>
        ${passed > 0 ? `<span class="summary-stat passed">${passed} passed</span>` : ''}
        ${flaky > 0 ? `<span class="summary-stat flaky">${flaky} flaky</span>` : ''}
        ${retried > 0 ? `<span class="summary-stat retried">${retried} retried</span>` : ''}
        ${failed > 0 ? `<span class="summary-stat failed">${failed} failed</span>` : ''}
        ${skipped > 0 ? `<span class="summary-stat skipped">${skipped} skipped</span>` : ''}
        <span class="summary-stat">${formatDuration(data.totalDuration)}</span>
        ${data.timestamp ? `<span class="summary-stat" style="margin-left:auto;color:var(--color-text-secondary)">${new Date(data.timestamp).toLocaleString()}</span>` : ''}
      </div>
    </div>${data.cacheSummary || hasCacheExecutionSignal(data.cacheExecutionSummary) ? `
    <div class="cache-stats" style="margin-bottom:16px;padding:12px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--color-text-secondary);">Action Entity Cache</div>${
        hasCacheExecutionSignal(data.cacheExecutionSummary) ? renderCacheExecution(data.cacheExecutionSummary) : ''
      }${data.cacheSummary ? `
      <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:4px;">Across all transpiled statements</div>
      <div class="summary">
        ${data.cacheSummary.cache_hits > 0 ? `<span class="summary-stat" style="color:var(--color-accent)">${data.cacheSummary.cache_hits} cached</span>` : ''}
        ${data.cacheSummary.healed > 0 ? `<span class="summary-stat" style="color:var(--color-flaky)">${data.cacheSummary.healed} healed</span>` : ''}
        ${data.cacheSummary.original > 0 ? `<span class="summary-stat">${data.cacheSummary.original} original</span>` : ''}
        ${data.cacheSummary.failed > 0 ? `<span class="summary-stat failed">${data.cacheSummary.failed} failed</span>` : ''}
      </div>` : ''}
    </div>` : ''}
    <div class="test-list">
      ${testsHtml}
    </div>
    <div class="footer">
      Generated by Shiplight Reporter${data.shiplightVersion ? ` · shiplightai v${escapeHtml(data.shiplightVersion)}` : ''}${
        data.modelTierProvenance
          ? ` · tier: ${escapeHtml(data.modelTierProvenance.tier)} (${escapeHtml(tierSourceLabel(data.modelTierProvenance.tierSource))}) → ${escapeHtml(data.modelTierProvenance.webagentPrimary)} [${data.modelTierProvenance.mapSource === 'server' ? 'org settings' : 'built-in defaults'}]`
          : ''
      }
    </div>
  </div>

  <!-- Video overlay -->
  <div class="video-overlay" id="videoOverlay">
    <button class="gallery-close" onclick="closeVideoOverlay()">&times;</button>
    <video controls autoplay id="overlayVideo"><source src="" type="video/webm" /></video>
  </div>

  <!-- Gallery lightbox -->
  <div class="gallery-overlay" id="gallery">
    <button class="gallery-close" onclick="closeGallery()">&times;</button>
    <div class="gallery-top">
      <div>
        <span class="gallery-status" id="gallery-status"></span>
        <span class="gallery-step-id" id="gallery-step-id"></span>
        <span class="gallery-description" id="gallery-description"></span>
      </div>
      <div class="gallery-counter" id="gallery-counter"></div>
    </div>
    <button class="gallery-nav prev" onclick="galleryNav(-1)">&#x2039;</button>
    <div class="gallery-img-container">
      <img id="gallery-img" src="" alt="" />
    </div>
    <button class="gallery-nav next" onclick="galleryNav(1)">&#x203A;</button>
    <div class="gallery-bottom">
      <div class="gallery-message" id="gallery-message"></div>
    </div>
  </div>

  <script>
    /* Attempt tabs */
    function switchAttemptTab(groupId, index) {
      const group = document.getElementById(groupId);
      group.querySelectorAll('.attempt-tab').forEach(function(tab) {
        tab.classList.toggle('active', Number(tab.dataset.tabIndex) === index);
      });
      group.querySelectorAll('.attempt-panel').forEach(function(panel) {
        panel.classList.toggle('active', Number(panel.dataset.panelIndex) === index);
      });
    }

    /* Trace */
    function copyTraceCmd(idx) {
      const el = document.getElementById('trace-cmd-' + idx);
      navigator.clipboard.writeText(el.textContent).then(function() {
        const btn = el.nextElementSibling;
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
      });
    }

    /* Gallery */
    let galleryData = [];
    let galleryIndex = 0;

    function openGalleryAt(el, idx) {
      galleryData = JSON.parse(el.dataset.gallery);
      galleryIndex = idx || 0;
      document.getElementById('gallery').classList.add('active');
      renderGallerySlide();
    }

    function closeGallery() {
      document.getElementById('gallery').classList.remove('active');
    }

    function galleryNav(dir) {
      galleryIndex = (galleryIndex + dir + galleryData.length) % galleryData.length;
      renderGallerySlide();
    }

    function renderGallerySlide() {
      const s = galleryData[galleryIndex];
      document.getElementById('gallery-img').src = s.src;
      document.getElementById('gallery-step-id').textContent = s.stepId;
      document.getElementById('gallery-description').textContent = s.description;
      document.getElementById('gallery-counter').textContent =
        (galleryIndex + 1) + ' / ' + galleryData.length;
      document.getElementById('gallery-status').className = 'gallery-status ' + s.status;
      const msgEl = document.getElementById('gallery-message');
      msgEl.textContent = s.message || '';
      msgEl.style.display = s.message ? 'block' : 'none';
    }

    document.getElementById('gallery').addEventListener('click', function(e) {
      if (e.target === this) closeGallery();
    });

    /* Video overlay */
    function openVideoOverlay(btn) {
      const video = btn.closest('.video-container').querySelector('video');
      const src = video.querySelector('source').src;
      const overlay = document.getElementById('videoOverlay');
      const overlayVideo = document.getElementById('overlayVideo');
      overlayVideo.querySelector('source').src = src;
      overlayVideo.load();
      overlayVideo.currentTime = video.currentTime;
      overlay.classList.add('active');
    }

    function closeVideoOverlay() {
      const overlay = document.getElementById('videoOverlay');
      overlay.classList.remove('active');
      document.getElementById('overlayVideo').pause();
    }

    document.getElementById('videoOverlay').addEventListener('click', function(e) {
      if (e.target === this) closeVideoOverlay();
    });

    /* Keyboard */
    document.addEventListener('keydown', function(e) {
      const galleryActive = document.getElementById('gallery').classList.contains('active');
      const videoActive = document.getElementById('videoOverlay').classList.contains('active');
      if (e.key === 'Escape') {
        if (galleryActive) closeGallery();
        if (videoActive) closeVideoOverlay();
      }
      if (galleryActive) {
        if (e.key === 'ArrowLeft') galleryNav(-1);
        else if (e.key === 'ArrowRight') galleryNav(1);
      }
    });
  </script>
</body>
</html>`;
}
