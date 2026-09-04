/**
 * Writing the two report artifacts (`report-data.json`, `index.html`) without
 * assuming the whole document fits in one JavaScript string.
 *
 * `JSON.stringify(reportData, null, 2)` throws
 * `RangeError: Invalid string length` as soon as the result passes V8's maximum
 * string length (~512 MB on 64-bit). A merged CI run reaches that: every step
 * carries a full `contextBefore`/`contextAfter` snapshot of the test variables
 * plus its raw `llmUsage` records, so a few hundred tests across a couple dozen
 * shards serialize to hundreds of megabytes — and two-space indentation roughly
 * doubles it. The crash landed in `shiplight report --merge` *before* the cloud
 * upload runs, so an oversized run lost its results entirely.
 *
 * `serializeReportData` emits the document one test at a time, so the largest
 * string that ever exists is a single test's JSON. Its output is byte-identical
 * to `JSON.stringify(data, null, 2)`.
 */

import * as fs from 'fs';
import { generateHtml, type ReportData, type ReportTest } from './template.js';

const INDENT = '  ';

/** Re-indent an already-serialized JSON block so it can be nested. */
function indentBlock(json: string, spaces: number): string {
  return json.split('\n').join('\n' + ' '.repeat(spaces));
}

function* serializeTests(tests: ReportTest[]): Generator<string> {
  if (tests.length === 0) {
    yield `${INDENT}"tests": []`;
    return;
  }
  yield `${INDENT}"tests": [\n`;
  for (let i = 0; i < tests.length; i++) {
    // `?? 'null'` mirrors JSON.stringify's handling of an undefined array slot.
    const json = JSON.stringify(tests[i], null, 2) ?? 'null';
    yield `${' '.repeat(4)}${indentBlock(json, 4)}${i === tests.length - 1 ? '\n' : ',\n'}`;
  }
  yield `${INDENT}]`;
}

/**
 * Yield `JSON.stringify(data, null, 2)` in chunks, one test per chunk.
 *
 * Chunked deliberately: the point of this module is that no single string ever
 * holds the whole run. Anything that re-joins the chunks in memory before
 * writing them puts the `RangeError` back.
 */
export function* serializeReportData(data: ReportData): Generator<string> {
  // `undefined` values are dropped, matching JSON.stringify. Key order is
  // insertion order in both.
  const entries = Object.entries(data).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    yield '{}';
    return;
  }
  yield '{\n';
  for (let i = 0; i < entries.length; i++) {
    const [key, value] = entries[i];
    const separator = i === entries.length - 1 ? '\n' : ',\n';
    if (key === 'tests' && Array.isArray(value)) {
      yield* serializeTests(value as ReportTest[]);
      yield separator;
    } else {
      yield `${INDENT}${JSON.stringify(key)}: ${indentBlock(JSON.stringify(value, null, 2), 2)}${separator}`;
    }
  }
  yield '}';
}

/**
 * Write `report-data.json`, streaming so an oversized run still lands on disk.
 *
 * Written to a sibling temp file and renamed on success. Opening the real path
 * with `'w'` truncates it immediately, so a failure part-way through
 * serialization would leave an unparseable file where a previous run's report
 * had been — the one-shot `JSON.stringify` this replaced threw before writing
 * any bytes at all.
 */
export function writeReportDataFile(filePath: string, data: ReportData): void {
  const tempPath = `${filePath}.tmp`;
  const fd = fs.openSync(tempPath, 'w');
  try {
    for (const chunk of serializeReportData(data)) {
      // writeFileSync on an fd writes at the current position and loops until
      // the whole chunk is out, so successive calls append.
      fs.writeFileSync(fd, chunk, 'utf-8');
    }
  } catch (err) {
    fs.closeSync(fd);
    fs.rmSync(tempPath, { force: true });
    throw err;
  }
  fs.closeSync(fd);
  try {
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    // A rename can still fail (a cross-device temp dir, a permission change
    // mid-run). The fd is closed by now, so the catch above no longer covers
    // this — clean up rather than strand a .tmp beside the report.
    fs.rmSync(tempPath, { force: true });
    throw err;
  }
}

/**
 * Render and write `index.html`, returning false instead of throwing when the
 * report cannot be rendered.
 *
 * The HTML carries far less than `report-data.json` (variable snapshots and LLM
 * usage records are not rendered), so it stays well under the string limit for
 * runs whose JSON does not. If it ever does not, losing the HTML must not also
 * lose the cloud upload that runs after it.
 */
export function writeHtmlReport(
  htmlPath: string,
  data: ReportData,
  render: (data: ReportData) => string = generateHtml,
): boolean {
  let html: string;
  try {
    html = render(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Remove any earlier run's HTML at this path. Regenerating over an existing
    // report directory is exactly where a stale index.html survives, and a
    // stale report that looks current is worse than a missing one — CI would
    // upload it as this run's result.
    let stale = '';
    try {
      if (fs.existsSync(htmlPath)) {
        fs.rmSync(htmlPath, { force: true });
        stale = ' A previous report at that path was removed.';
      }
    } catch { /* best effort: the message below still tells the truth */ }
    console.error(`Error: Failed to render ${htmlPath}: ${message}`);
    console.error(`report-data.json was still written, so the run can still be uploaded to Shiplight cloud.${stale}`);
    return false;
  }
  fs.writeFileSync(htmlPath, html, 'utf-8');
  return true;
}
