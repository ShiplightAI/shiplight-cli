import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveShardUploadIdentity } from './index.js';

describe('resolveShardUploadIdentity', () => {
  it('derives batch identity from Playwright only when a shared run id is explicit', () => {
    assert.deepEqual(resolveShardUploadIdentity({ current: 2, total: 4 }, { SHIPLIGHT_RUN_ID: 'shared-run' }), {
      clientRunId: 'shared-run',
      batchId: 'shard-2',
      expectedBatchCount: 4,
    });
  });

  it('keeps Playwright shards independent when no shared run id is set', () => {
    assert.deepEqual(
      resolveShardUploadIdentity(
        { current: 2, total: 4 },
        {
          SHIPLIGHT_RUN_ID: 'generated-per-process-id',
          SHIPLIGHT_INTERNAL_RUN_ID_SOURCE: 'generated',
        },
      ),
      {
        clientRunId: 'generated-per-process-id',
        batchId: undefined,
        expectedBatchCount: undefined,
      },
    );
  });

  it('keeps explicit batch settings as the override', () => {
    assert.deepEqual(
      resolveShardUploadIdentity(
        { current: 2, total: 4 },
        {
          SHIPLIGHT_RUN_ID: 'shared-run',
          SHIPLIGHT_BATCH_ID: 'region-us',
          SHIPLIGHT_BATCH_COUNT: '8',
        },
      ),
      {
        clientRunId: 'shared-run',
        batchId: 'region-us',
        expectedBatchCount: 8,
      },
    );
  });

  it('ignores a blank batch id and derives the Playwright shard identity', () => {
    assert.deepEqual(
      resolveShardUploadIdentity(
        { current: 2, total: 4 },
        {
          SHIPLIGHT_RUN_ID: 'shared-run',
          SHIPLIGHT_BATCH_ID: '   ',
        },
      ),
      {
        clientRunId: 'shared-run',
        batchId: 'shard-2',
        expectedBatchCount: 4,
      },
    );
  });

  it('rejects explicit batch settings without a caller-provided shared run id', () => {
    assert.throws(
      () =>
        resolveShardUploadIdentity(
          { current: 2, total: 4 },
          {
            SHIPLIGHT_RUN_ID: 'generated-per-process-id',
            SHIPLIGHT_INTERNAL_RUN_ID_SOURCE: 'generated',
            SHIPLIGHT_BATCH_ID: 'shard-2',
            SHIPLIGHT_BATCH_COUNT: '4',
          },
        ),
      /SHIPLIGHT_RUN_ID must be set explicitly/,
    );
  });

  it('uses an explicit run id without batch fields for an unsharded run', () => {
    assert.deepEqual(resolveShardUploadIdentity(null, { SHIPLIGHT_RUN_ID: 'single-run' }), {
      clientRunId: 'single-run',
      batchId: undefined,
      expectedBatchCount: undefined,
    });
  });
});
