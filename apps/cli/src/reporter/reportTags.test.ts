import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReportTags } from './reportTags.js';

describe('resolveReportTags', () => {
  it('reports the tags Playwright resolved, verbatim', () => {
    // `TestCase.tags` keeps the `@` (playwright/lib/common/index.js `get tags()`
    // returns the validated options tags unchanged, and validation rejects a
    // tag without the prefix). Reporting a stripped name would hand the cloud
    // something that no longer pastes back into `--grep`.
    assert.deepEqual(resolveReportTags(['@auth', '@smoke']), ['@auth', '@smoke']);
  });

  it('returns undefined for an untagged test, so the field is omitted', () => {
    // Not `[]` — an empty array would ship in report-data.json and in the
    // create-run payload as a meaningless empty list.
    assert.equal(resolveReportTags([]), undefined);
    assert.equal(resolveReportTags(undefined), undefined);
  });

  it('copies rather than aliasing Playwright\'s array', () => {
    // The report is mutated after assembly; writing through to Playwright's own
    // TestCase would corrupt every later reader of it.
    const playwrightTags = ['@auth'];
    const result = resolveReportTags(playwrightTags);

    result?.push('@injected');

    assert.deepEqual(playwrightTags, ['@auth']);
  });

  it('preserves the order Playwright reported', () => {
    // Playwright emits inherited describe tags before the test's own; keeping
    // the order means a reader sees the same list the runner printed.
    assert.deepEqual(
      resolveReportTags(['@suite-level', '@test-level', '@admin']),
      ['@suite-level', '@test-level', '@admin'],
    );
  });
});
