/**
 * Capture of a test's stdout/stderr for the report.
 *
 * These strings are written into report-data.json and forwarded to the cloud by
 * `buildReportV2`, so an unbounded capture puts the entire console output of
 * every test — a chatty debug run, a dependency logging every request — into
 * one JSON document and then into an upload. The cap keeps a report from a
 * single noisy test from dominating the payload.
 *
 * The tail is kept rather than the head: a test that failed printed the useful
 * part last, and a truncated head is what most log viewers already show.
 *
 * NOTE: nothing here redacts secrets. Whatever a test prints — tokens, customer
 * data echoed for debugging — is reported verbatim, exactly as Playwright's own
 * HTML reporter does with the same streams. Treat run reports as carrying
 * whatever the tests logged.
 */

/**
 * Maximum characters of captured output kept per stream — roughly 64 KB, which
 * holds a normal test's output many times over while bounding the pathological
 * case.
 *
 * This bounds the *content*, not the returned string: a truncated result also
 * carries a one-line marker saying how much was dropped, so it runs ~50 bytes
 * over. Named for the content because that is the number worth reasoning about
 * when estimating what a run uploads.
 */
export const MAX_CONSOLE_CONTENT_CHARS = 64 * 1024;

/**
 * Join Playwright's stdout/stderr chunks into one capped string.
 *
 * @returns The captured text, or `undefined` when nothing was written, so the
 *   field is omitted from the report rather than shipped as an empty string.
 */
export function captureConsoleOutput(
  chunks: ReadonlyArray<string | Buffer>,
  maxChars: number = MAX_CONSOLE_CONTENT_CHARS,
): string | undefined {
  if (chunks.length === 0) return undefined;

  const text = chunks.map((c) => (typeof c === 'string' ? c : c.toString())).join('');
  if (text.length === 0) return undefined;
  if (text.length <= maxChars) return text;

  const dropped = text.length - maxChars;
  return `[shiplight] ${dropped} earlier character(s) truncated\n${text.slice(-maxChars)}`;
}
