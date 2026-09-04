import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateRunId, resolveRunId } from './runId.js';

describe('generateRunId', () => {
  it('produces a filename-safe, sortable timestamp', () => {
    const id = generateRunId();

    // `YYYY-MM-DDTHH-MM-SS-mmm` — the shape `test-results/<runId>` and
    // `shiplight-report/<runId>` are built from. No colons: they are illegal in
    // Windows paths.
    assert.match(id, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}$/);
  });
});

describe('resolveRunId', () => {
  it('honors an already-published SHIPLIGHT_RUN_ID', () => {
    // This is what keeps `shiplight test` and the shiplightConfig() call inside
    // the spawned Playwright process on the SAME output directory — the parent
    // publishes the id, the child reads it back. If they disagreed, the parent's
    // post-test scan would look in a directory the child never wrote to.
    assert.equal(resolveRunId({ SHIPLIGHT_RUN_ID: '2026-08-24T09-27-29-166' }), '2026-08-24T09-27-29-166');
  });

  it('mints a fresh id when none is published', () => {
    const id = resolveRunId({});

    assert.match(id, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}$/);
  });

  it('treats an empty SHIPLIGHT_RUN_ID as absent', () => {
    // An empty value would resolve `test-results/<runId>` back to
    // `test-results/` — the unscoped directory full of previous runs' artifacts
    // that the run scoping exists to skip.
    assert.match(resolveRunId({ SHIPLIGHT_RUN_ID: '' }), /^\d{4}-\d{2}-\d{2}T/);
  });
});
