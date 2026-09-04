/**
 * Tag resolution for the report.
 *
 * The tags a test carries are read straight off Playwright's `TestCase.tags`
 * rather than re-derived from the YAML the spec was transpiled from. Playwright
 * already computes the answer: `TestCase.tags` merges the tags declared on the
 * `test` with those inherited from every enclosing `test.describe`, plus any
 * `@`-token in the titles (playwright/lib/common/index.js, `get tags()`), which
 * is exactly the set `--grep` selects on.
 *
 * Re-deriving from YAML got this wrong three ways. It missed hand-written
 * `.spec.ts` tests entirely, because the lookup keys off a `.test.yaml` sitting
 * next to the spec and silently gives up when there is none. It missed any tag
 * added by a route other than the YAML `tags:` key. And it had to re-implement
 * suite inheritance and parameter-set naming, both of which Playwright had
 * already done.
 *
 * Names are kept verbatim, `@` included. That prefix is mandatory in Playwright
 * (a tag without it throws at collection time) and is part of the name
 * everywhere else a user sees it: `--grep '@smoke'`, the list reporter, the
 * Playwright HTML report. Stripping it would hand the cloud a name that no
 * longer pastes back into a Playwright command.
 */

/**
 * The tags to report for one test, or `undefined` when it has none.
 *
 * Returns a copy so a later edit to the report cannot mutate Playwright's
 * array, and `undefined` rather than `[]` so the field is omitted from the
 * report JSON and the upload payload instead of shipping an empty list.
 */
export function resolveReportTags(testCaseTags: readonly string[] | undefined): string[] | undefined {
  if (!testCaseTags || testCaseTags.length === 0) return undefined;
  return [...testCaseTags];
}
