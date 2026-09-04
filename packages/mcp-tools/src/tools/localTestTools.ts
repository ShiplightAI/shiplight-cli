/**
 * Local Test Tools
 *
 * Session-scoped reporting over a recorded browser session.
 *
 * Scaffolding, `.test.yaml` validation, and YAML->spec transpilation used to
 * live here. They moved to the `shiplightai` CLI (`shiplight create --json`,
 * `shiplight transpile --strict`) so the artifact that validates a test is the
 * same artifact, at the same version, that runs it -- see spec 003 FR-012.
 * Do not reintroduce non-session tools in this file.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import axios from "axios";
import { logger } from "sdk-core";
import type { SessionManager } from "../backends/SessionManager.js";
import type { ActionLogEntry, ConsoleLog, NetworkLog } from "../backends/sessionTypes.js";

type ReportData = {
  recordEvidence: boolean;
  tracePath?: string;
  createdAt: Date;
  actionLog: ActionLogEntry[];
  consoleLogs: ConsoleLog[];
  networkLogs: NetworkLog[];
};

async function readReportSnapshot(runDir: string, sessionId: string): Promise<ReportData> {
  const snapshotPath = path.join(runDir, sessionId, 'report-data.json');
  try {
    await fs.promises.access(snapshotPath);
  } catch {
    throw new Error(`Session ${sessionId} not found and no saved report data exists`);
  }
  const raw = JSON.parse(await fs.promises.readFile(snapshotPath, 'utf8'));
  return {
    recordEvidence: raw.recordEvidence ?? false,
    tracePath: raw.tracePath,
    createdAt: new Date(raw.createdAt),
    actionLog: raw.actionLog ?? [],
    consoleLogs: raw.consoleLogs ?? [],
    networkLogs: raw.networkLogs ?? [],
  };
}

export class LocalTestTools {
  private sessionManager: SessionManager | null;

  constructor(sessionManager?: SessionManager | null) {
    this.sessionManager = sessionManager ?? null;
  }

  // ============================================================================
  // Generate Report HTML Tool
  // ============================================================================

  static readonly generateHtmlReportTool = {
    name: "generate_html_report",
    description:
      "Generate a self-contained HTML session report. " +
      "Can be called while the session is live OR after close_session. " +
      "Embeds per-step screenshots, an optional video player, and a Playwright trace viewer link. " +
      "The session must have been started with record_evidence: true. " +
      "Pass local_video_path (returned by close_session) to embed the video. " +
      "Pass local_trace_path (returned by close_session) to include trace info for later upload. " +
      "Pass trace_url if the trace has already been uploaded (shows an interactive viewer link). " +
      "Pass summary to describe what was tested. " +
      "Pass checks — a list of acceptance criteria derived from what you were asked to build — each with a pass/fail result and the step indices that prove it (step indices are 1-based: first action = step 1). The agent should fill these in itself based on the task and steps taken; no user input required. " +
      "Pass highlight_steps to feature specific screenshots in a Summary section at the top. " +
      "Returns the file path of the written report.",
    inputSchema: zodToJsonSchema(
      z.object({
        session_id: z.string().describe("The session ID — works for live sessions and closed sessions"),
        title: z
          .string()
          .optional()
          .describe("Optional report title (e.g. 'Todo App — Install MCP button')"),
        summary: z
          .string()
          .optional()
          .describe(
            "Text summary of what the agent tested and the outcome — shown prominently at the top of the report. " +
            "Example: 'Verified that the Install MCP button appears on the dashboard and opens the install dialog correctly. All 3 checks passed.'"
          ),
        checks: z
          .array(
            z.object({
              description: z.string().describe("One acceptance criterion, e.g. 'Tasks persist after page reload'"),
              passed: z.boolean().describe("Whether this criterion passed"),
              step_indices: z.array(z.number()).optional().describe(
                "Step indices whose screenshots are evidence for this check. " +
                "Use the step_index returned directly by inspect_page and act — no manual counting needed. " +
                "1-based: first action = step 1."
              ),
              note: z.string().optional().describe("Optional detail — e.g. what failed, or a caveat"),
            })
          )
          .optional()
          .describe(
            "Acceptance criteria checklist derived from the feature you were asked to build and verify. " +
            "Fill these in yourself based on the task and what you verified — the user does not need to provide them. " +
            "Each check maps to one or more step screenshots as evidence. Step indices are 1-based (first action = step 1). " +
            "Example: [{ description: 'User can add a task', passed: true, step_indices: [2] }, { description: 'Task persists after reload', passed: true, step_indices: [8] }]"
          ),
        highlight_steps: z
          .array(z.number())
          .optional()
          .describe(
            "Step indices to feature as key screenshots (fallback if checks is not provided). Step indices are 1-based (first action = step 1). " +
            "If omitted and no checks given, auto-selects first, last, and failed steps."
          ),
        local_video_path: z
          .string()
          .optional()
          .describe(
            "Local .webm file path returned by close_session. Embeds the video directly in the report."
          ),
        video_url: z
          .string()
          .optional()
          .describe("Public URL of the .webm recording (alternative to local_video_path for uploaded videos)"),
        local_trace_path: z
          .string()
          .optional()
          .describe("Local .zip trace path returned by close_session. Stored in the report for local reference; pass trace_url instead to render the 'Open Trace Viewer' button."),
        trace_url: z
          .string()
          .optional()
          .describe("Public URL of the Playwright trace .zip (after uploading). Renders an 'Open Trace Viewer' button."),
        output_path: z
          .string()
          .optional()
          .describe("Where to write the file (default: /tmp/report.html)"),
      }),
      { $refStrategy: "none" }
    ),
  };

  async generateHtmlReport(args: unknown): Promise<string> {
    const { session_id, title, summary, checks, highlight_steps, local_video_path, video_url, local_trace_path, trace_url, output_path } = z
      .object({
        session_id: z.string(),
        title: z.string().optional(),
        summary: z.string().optional(),
        checks: z.array(z.object({
          description: z.string(),
          passed: z.boolean(),
          step_indices: z.array(z.number()).optional(),
          note: z.string().optional(),
        })).optional(),
        highlight_steps: z.array(z.number()).optional(),
        local_video_path: z.string().optional(),
        video_url: z.string().optional(),
        local_trace_path: z.string().optional(),
        trace_url: z.string().optional(),
        output_path: z.string().optional(),
      })
      .parse(args);

    if (!this.sessionManager) {
      throw new Error("No session manager available");
    }

    if (this.sessionManager.hasSession(session_id)) {
      throw new Error(
        `Session "${session_id}" is still open. Call close_session first, then generate_html_report.`
      );
    }
    const data = await readReportSnapshot(this.sessionManager.getRunDir(), session_id);

    if (!data.recordEvidence) {
      throw new Error(
        `Session ${session_id} was not started with record_evidence: true. ` +
          "This must be enabled to generate a report."
      );
    }

    const filePath = output_path ?? path.join(os.tmpdir(), "report.html");

    // Escapes &, <, >, and " for use in double-quoted HTML attributes and text content.
    // Security-critical: never shorten or remove — prevents XSS in user-supplied strings.
    const escapeHtml = (s: string): string =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    // Resolve video source: prefer local file path, fall back to remote URL.
    // Local paths are served as file:// URLs (works when the HTML is opened locally).
    // Only allow http/https for remote URLs to prevent javascript: URIs.
    const safeVideoUrl = local_video_path && fs.existsSync(local_video_path)
      ? encodeURI(`file://${local_video_path}`)
      : video_url && /^https?:\/\//i.test(video_url)
        ? escapeHtml(video_url)
        : null;

    const reportTitle = title ?? `Session Report`;
    const sessionDate = data.createdAt.toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const { actionLog } = data;
    const passCount = actionLog.filter((s) => s.success).length;
    const failCount = actionLog.filter((s) => !s.success).length;
    const durationMs =
      actionLog.length > 0
        ? actionLog[actionLog.length - 1].timestamp - actionLog[0].timestamp
        : 0;
    const durationSec = (durationMs / 1000).toFixed(1);

    // Pre-load all screenshot data URLs asynchronously with a per-file size cap.
    // Using an async pre-pass avoids blocking the event loop when embedding screenshots.
    const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB
    const screenshotCache = new Map<string, string>();
    await Promise.all(
      [...new Set(actionLog.map((e) => e.screenshotPath).filter((p): p is string => !!p))].map(
        async (p) => {
          try {
            const stat = await fs.promises.stat(p);
            if (stat.size > MAX_SCREENSHOT_BYTES) return; // skip — renders as "No screenshot"
            const buf = await fs.promises.readFile(p);
            screenshotCache.set(p, `data:image/png;base64,${buf.toString("base64")}`);
          } catch {
            // screenshot unavailable — ignore
          }
        }
      )
    );

    // Look up a pre-loaded screenshot data URL, returning empty string if unavailable.
    const toDataUrl = (imgPath?: string): string => {
      if (!imgPath) return "";
      return screenshotCache.get(imgPath) ?? "";
    };

    // --- Summary section ---
    // Overall verdict from checks (if provided), else from action success rate
    const overallPassed = failCount === 0;
    const verdictClass = overallPassed ? "verdict-pass" : "verdict-fail";
    const verdictLabel = overallPassed ? "✅ PASS" : "❌ FAIL";

    // --- Step cards ---
    const stepCards = actionLog
      .map((entry) => {
        const imgSrc = toDataUrl(entry.screenshotPath);
        const isVerify = entry.actionName === "verify";
        const statusClass = isVerify ? (entry.success ? "pass" : "fail") : "";
        const statusLabel = isVerify ? (entry.success ? "✅ pass" : "❌ fail") : "";
        const relMs = actionLog[0] ? entry.timestamp - actionLog[0].timestamp : 0;
        const relSec = (relMs / 1000).toFixed(2);
        const imgHtml = imgSrc
          ? `<img class="thumb" src="${imgSrc}" alt="Step ${entry.stepIndex} screenshot" data-description="${escapeHtml(entry.description)}" onclick="openModal(event, this)" style="display:none">`
          : "";
        const errorHtml = !entry.success && entry.error
          ? `<div class="step-error">${escapeHtml(entry.error)}</div>`
          : "";
        return `
    <div class="step-wrapper" ${imgSrc ? `onclick="collapseWrapper(event, this)"` : ""}>
      ${imgHtml}
      <div class="step-card ${statusClass}" ${imgSrc ? `onclick="toggleStepImg(this)"` : ""}>
        <div class="step-header">
          <span class="step-desc">${escapeHtml(entry.description)}</span>
          ${statusLabel ? `<span class="step-status ${statusClass}">${statusLabel}</span>` : ""}
          <span class="step-time">${relSec}s</span>
          ${imgSrc ? `<span class="step-expand-hint">▸</span>` : ""}
        </div>
        <div class="step-url">${escapeHtml(entry.url)}</div>
        ${errorHtml}
      </div>
    </div>`;
      })
      .join("\n");

    const videoSection = safeVideoUrl
      ? `<section class="section">
    <h2 class="section-title">Recording</h2>
    <div class="section-body">
    <video controls>
      <source src="${safeVideoUrl}" type="video/webm">
      Your browser does not support the video tag.
    </video>
    </div>
  </section>`
      : `<section class="section">
    <h2 class="section-title">Recording</h2>
    <div class="section-body">
    <div class="no-video">Video will be available after closing the session and uploading the recording.</div>
    </div>
  </section>`;

    // Validate trace_url is a safe https URL
    const safeTraceUrl = trace_url && /^https?:\/\//i.test(trace_url)
      ? escapeHtml(trace_url)
      : null;

    const traceSection = safeTraceUrl
      ? `<section class="section">
    <h2 class="section-title">Trace</h2>
    <div class="section-body">
      <a class="trace-btn" href="https://trace.playwright.dev/?trace=${encodeURIComponent(safeTraceUrl)}" target="_blank" rel="noopener noreferrer">Open Trace Viewer →</a>
    </div>
  </section>`
      : local_trace_path
        ? `<section class="section">
    <h2 class="section-title">Trace</h2>
    <div class="section-body">
      <p class="no-trace">Trace will be available after uploading.</p>
    </div>
  </section>`
        : ``;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(reportTitle)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f5f7; color: #1a1a2e; font-size: 14px; line-height: 1.5; }

    /* Header */
    .header { background: #1a1a2e; color: #fff; padding: 28px 40px; }
    .header h1 { font-size: 22px; font-weight: 600; margin-bottom: 6px; }
    .header .meta { color: #9ba3bf; font-size: 13px; margin-bottom: 20px; }
    .stats { display: flex; gap: 24px; flex-wrap: wrap; }
    .stat { display: flex; flex-direction: column; align-items: flex-start; }
    

    /* Layout */
    .container { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
    .section { background: #fff; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.08); margin-bottom: 24px; overflow: hidden; }
    .section-title { font-size: 15px; font-weight: 600; padding: 16px 20px; border-bottom: 1px solid #eef0f4; display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
    .section-title .count { background: #eef0f4; color: #555; font-size: 12px; font-weight: 500; padding: 2px 8px; border-radius: 10px; }
    .section-body { padding: 0 20px 20px; }
    .collapsible-body { }

    /* Video */
    video { width: 100%; border-radius: 6px; background: #000; display: block; margin: 20px 0 4px; }
    .no-video { color: #888; font-size: 13px; padding: 20px 0 4px; }

    /* Trace */
    .trace-btn { display: inline-block; background: #6366f1; color: #fff; font-size: 14px; font-weight: 600; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin: 16px 0 8px; transition: background 0.15s; }
    .trace-btn:hover { background: #4f46e5; }
    .no-trace { color: #888; font-size: 13px; padding: 20px 0 4px; }

    /* Step cards */
    .step-card { border-left: 3px solid #e0e0e0; margin: 12px 0; padding: 12px 14px; border-radius: 6px; background: #fafafa; cursor: pointer; }
    .step-card.pass { border-left-color: #4ade80; }
    .step-card.fail { border-left-color: #f87171; background: #fff8f8; }
    .step-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 3px; }
    .step-desc { flex: 1; font-size: 13px; color: #222; line-height: 1.4; }
    .step-status { font-size: 12px; font-weight: 600; white-space: nowrap; }
    .step-status.pass { color: #16a34a; }
    .step-status.fail { color: #dc2626; }
    .step-time { color: #aaa; font-size: 11px; white-space: nowrap; }
    .step-url { font-size: 11px; color: #c0c6d4; margin-bottom: 8px; word-break: break-all; font-family: monospace; }
    .step-error { font-size: 12px; color: #dc2626; background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; padding: 8px 10px; margin-top: 4px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .step-expand-hint { font-size: 11px; color: #9ba3bf; flex-shrink: 0; transition: transform 0.15s; }
    .step-expand-hint.open { transform: rotate(90deg); }
    .step-wrapper.expanded { background: #f0f4ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 10px; margin: 12px 0; cursor: pointer; }
    .step-wrapper.expanded .step-card { margin: 0; background: #fff; }
    .step-wrapper.expanded .thumb { border-color: #a5b4fc; }
    .thumb { max-width: 100%; max-height: 320px; border-radius: 6px; border: 1px solid #e0e0e0; cursor: zoom-in; display: block; margin-bottom: 8px; object-fit: contain; background: #f0f0f0; }

    /* Verdict badge */
    .verdict-badge { display: inline-block; font-size: 13px; font-weight: 700; padding: 3px 12px; border-radius: 20px; margin-left: 12px; vertical-align: middle; letter-spacing: .04em; }
    .verdict-pass { background: #dcfce7; color: #16a34a; }
    .verdict-fail { background: #fee2e2; color: #dc2626; }

    /* Tabs */
    .tabs { display: flex; gap: 0; border-bottom: 2px solid #eef0f4; margin-bottom: 24px; }
    .tab-btn { background: none; border: none; font-size: 14px; font-weight: 600; color: #9ba3bf; padding: 10px 20px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: color 0.15s, border-color 0.15s; }
    .tab-btn:hover { color: #6366f1; }
    .tab-btn.active { color: #6366f1; border-bottom-color: #6366f1; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* Modal */
    .modal { display: none; position: fixed; inset: 0; z-index: 1000; align-items: center; justify-content: center; }
    .modal.open { display: flex; }
    .modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.88); cursor: zoom-out; }
    .modal-content { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; max-width: min(90vw, 1000px); }
    .modal-content img { max-width: 100%; max-height: 76vh; border-radius: 8px; box-shadow: 0 8px 40px rgba(0,0,0,.6); display: block; }
    .modal-caption { color: #e5e7eb; font-size: 14px; text-align: center; margin-top: 14px; max-width: 720px; line-height: 1.5; padding: 0 8px; }
    .modal-counter { color: #6b7280; font-size: 12px; text-align: center; margin-top: 5px; }
    .modal-arrow { position: relative; z-index: 1; background: rgba(255,255,255,.12); border: none; color: #fff; font-size: 36px; line-height: 1; width: 52px; height: 52px; border-radius: 50%; cursor: pointer; flex-shrink: 0; transition: background 0.15s; margin: 0 14px; display: flex; align-items: center; justify-content: center; }
    .modal-arrow:hover:not(:disabled) { background: rgba(255,255,255,.25); }
    .modal-arrow:disabled { opacity: 0.2; cursor: default; }
    .modal-close { position: fixed; top: 20px; right: 24px; z-index: 2; background: rgba(255,255,255,.12); border: none; color: #fff; font-size: 18px; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; transition: background 0.15s; display: flex; align-items: center; justify-content: center; }
    .modal-close:hover { background: rgba(255,255,255,.25); }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(reportTitle)}</h1>
    <div class="meta">${escapeHtml(sessionDate)} · Session ${escapeHtml(session_id)} <span class="verdict-badge ${verdictClass}">${verdictLabel}</span></div>
  </div>

  <div class="container">
${summary ? `
    <section class="section" style="border-left: 4px solid #6366f1;">
      <div class="section-body" style="padding: 16px 20px;">
        <p style="font-size: 14px; line-height: 1.6; color: #333;">${escapeHtml(summary)}</p>
      </div>
    </section>
` : ""}
    <div class="tabs">
      <button class="tab-btn active" data-tab="all-steps" onclick="switchTab('all-steps')">Steps <span class="count">${actionLog.length}</span></button>
      ${safeVideoUrl || local_video_path ? `<button class="tab-btn" data-tab="recording" onclick="switchTab('recording')">Recording</button>` : ""}
      ${safeTraceUrl || local_trace_path ? `<button class="tab-btn" data-tab="trace" onclick="switchTab('trace')">Trace</button>` : ""}
    </div>

    <div id="tab-all-steps" class="tab-panel active">
      <section class="section">
        <h2 class="section-title">Steps <span class="count">${actionLog.length}</span></h2>
        <div class="section-body">
          ${stepCards}
        </div>
      </section>
    </div>

    <div id="tab-recording" class="tab-panel">
      ${videoSection}
    </div>

    <div id="tab-trace" class="tab-panel">
      ${traceSection}
    </div>

  </div>

  <!-- Full-size screenshot modal with gallery navigation -->
  <div id="modal" class="modal">
    <div class="modal-backdrop" onclick="closeModal()"></div>
    <button class="modal-arrow" id="modal-prev" onclick="navigateModal(-1)">&#8249;</button>
    <div class="modal-content">
      <img id="modal-img" src="" alt="">
      <div id="modal-caption" class="modal-caption"></div>
      <div id="modal-counter" class="modal-counter"></div>
    </div>
    <button class="modal-arrow" id="modal-next" onclick="navigateModal(1)">&#8250;</button>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>

  <script>
    function switchTab(name) {
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('tab-' + name).classList.add('active');
      document.querySelectorAll('.tab-btn').forEach(b => {
        if (b.dataset.tab === name) b.classList.add('active');
      });
    }
    function collapseWrapper(event, wrapper) {
      if (event.target !== wrapper) return;
      var img = wrapper.querySelector('.thumb');
      var hint = wrapper.querySelector('.step-expand-hint');
      if (!img || img.style.display === 'none') return;
      img.style.display = 'none';
      wrapper.classList.remove('expanded');
      if (hint) hint.classList.remove('open');
    }
    function toggleStepImg(card) {
      const wrapper = card.parentElement;
      const img = wrapper ? wrapper.querySelector('.thumb') : null;
      const hint = card.querySelector('.step-expand-hint');
      if (!img) return;
      if (img.style.display === 'none') {
        img.style.display = '';
        wrapper.classList.add('expanded');
        if (hint) hint.classList.add('open');
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        img.style.display = 'none';
        wrapper.classList.remove('expanded');
        if (hint) hint.classList.remove('open');
      }
    }
    function toggle(id) {
      const el = document.getElementById(id);
      el.style.display = el.style.display === 'none' ? '' : 'none';
    }
    let _gallery = [], _galleryIdx = 0;

    function openModal(event, img) {
      event.stopPropagation();
      // Scope gallery to the active tab panel, include all images (even collapsed)
      var panel = document.querySelector('.tab-panel.active');
      if (!panel) panel = document;
      _gallery = Array.from(panel.querySelectorAll('img.thumb'));
      _galleryIdx = _gallery.indexOf(img);
      if (_galleryIdx === -1) _galleryIdx = 0;
      _renderModal();
      document.getElementById('modal').classList.add('open');
    }

    function _renderModal() {
      const img = _gallery[_galleryIdx];
      document.getElementById('modal-img').src = img.src;
      document.getElementById('modal-caption').textContent = img.dataset.description || img.alt || '';
      document.getElementById('modal-counter').textContent =
        _gallery.length > 1 ? (_galleryIdx + 1) + ' / ' + _gallery.length : '';
      document.getElementById('modal-prev').disabled = _galleryIdx === 0;
      document.getElementById('modal-next').disabled = _galleryIdx === _gallery.length - 1;
    }

    function navigateModal(dir) {
      const next = _galleryIdx + dir;
      if (next >= 0 && next < _gallery.length) {
        _galleryIdx = next;
        _renderModal();
      }
    }

    function closeModal() {
      document.getElementById('modal').classList.remove('open');
    }

    document.addEventListener('keydown', e => {
      if (!document.getElementById('modal').classList.contains('open')) return;
      if (e.key === 'Escape') closeModal();
      if (e.key === 'ArrowLeft') navigateModal(-1);
      if (e.key === 'ArrowRight') navigateModal(1);
    });
  </script>
</body>
</html>`;

    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, html, "utf8");

    return JSON.stringify({ success: true, file_path: filePath });
  }

  // ============================================================================
  // Upload Report Tool (cloud-dependent)
  // ============================================================================

  // ============================================================================
  // Tool Definitions
  // ============================================================================

  static readonly toolDefinitions = [
    // Session-bound only (003 FR-012). generate_html_report qualifies: it
    // requires a closed session id and reports on that session's recording.
    // Scaffolding, YAML validation, and transpilation moved to the CLI so the
    // artifact that validates a test is the one that runs it — see
    // `shiplight create --json`, `shiplight transpile --strict`.
    LocalTestTools.generateHtmlReportTool,
  ];

}
