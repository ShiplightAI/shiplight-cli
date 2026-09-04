import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { encodeStepContexts, expandStepContexts, orderStepList } from './contextDelta.js';
import type { ReportStep } from './template.js';

function step(id: string, before?: Record<string, unknown>, after?: Record<string, unknown>): ReportStep {
  return {
    stepId: id,
    description: `step ${id}`,
    status: 'success',
    ...(before ? { contextBefore: before } : {}),
    ...(after ? { contextAfter: after } : {}),
  };
}

/** The shape the engine hands the reporter: the whole store, twice per step. */
const RUN: ReportStep[] = [
  step('main.0', { user: 'a@example.com', env: 'beta' }, { user: 'a@example.com', env: 'beta' }),
  step('main.1', { user: 'a@example.com', env: 'beta' }, { user: 'a@example.com', env: 'beta', fileId: 42 }),
  step('main.2', { user: 'a@example.com', env: 'beta', fileId: 42 }, { user: 'a@example.com', env: 'beta', fileId: 43 }),
];

describe('encodeStepContexts', () => {
  it('records the whole store on the first step and only changes after it', () => {
    const encoded = encodeStepContexts(RUN);

    assert.deepEqual(encoded[0].contextBeforeDelta, { set: { user: 'a@example.com', env: 'beta' } });
    assert.deepEqual(encoded[0].contextAfterDelta, {}, 'nothing changed during the first step');
    assert.deepEqual(encoded[1].contextBeforeDelta, {});
    assert.deepEqual(encoded[1].contextAfterDelta, { set: { fileId: 42 } });
    assert.deepEqual(encoded[2].contextAfterDelta, { set: { fileId: 43 } });
  });

  it('drops the full form it replaced', () => {
    const encoded = encodeStepContexts(RUN);
    for (const s of encoded) {
      assert.equal('contextBefore' in s, false);
      assert.equal('contextAfter' in s, false);
    }
  });

  it('records removals explicitly rather than by absence', () => {
    const encoded = encodeStepContexts([
      step('main.0', { a: 1, b: 2 }, { a: 1, b: 2 }),
      step('main.1', { a: 1 }, { a: 1 }),
    ]);

    assert.deepEqual(encoded[1].contextBeforeDelta, { removed: ['b'] });
  });

  it('distinguishes an unchanged snapshot from no snapshot', () => {
    const encoded = encodeStepContexts([
      step('main.0', { a: 1 }, { a: 1 }),
      { stepId: 'main.1', description: 'no snapshot', status: 'success' },
      step('main.2', { a: 1 }, { a: 1 }),
    ]);

    assert.equal('contextBeforeDelta' in encoded[1], false, 'absent means no snapshot was taken');
    assert.deepEqual(encoded[2].contextBeforeDelta, {}, 'empty means a snapshot with no change');
  });

  it('does not mutate the steps it is given', () => {
    const original = structuredClone(RUN);
    encodeStepContexts(RUN);
    assert.deepEqual(RUN, original);
  });

  it('is a no-op on already-encoded steps', () => {
    const once = encodeStepContexts(RUN);
    assert.deepEqual(encodeStepContexts(once), once);
  });

  it('treats a value JSON cannot represent as unchanged rather than re-recording it', () => {
    const fn = () => {};
    const encoded = encodeStepContexts([
      step('main.0', { fn }, { fn }),
      step('main.1', { fn }, { fn }),
    ]);

    assert.deepEqual(encoded[1].contextBeforeDelta, {});
  });
});

describe('expandStepContexts', () => {
  it('round-trips the recorded values', () => {
    assert.deepEqual(expandStepContexts(encodeStepContexts(RUN)), RUN);
  });

  it('round-trips removals', () => {
    const run = [
      step('main.0', { a: 1, b: 2 }, { a: 1, b: 2 }),
      step('main.1', { a: 1 }, { a: 1, c: 3 }),
    ];
    assert.deepEqual(expandStepContexts(encodeStepContexts(run)), run);
  });

  it('reads the full form untouched — an artifact written before the change', () => {
    assert.deepEqual(expandStepContexts(RUN), RUN);
  });

  it('reads a list that mixes both forms, letting a full snapshot reset the state', () => {
    const encoded = encodeStepContexts(RUN);
    // A full snapshot dropped into the middle: authoritative, so the accumulated
    // `fileId` must not survive it.
    const mixed: ReportStep[] = [
      encoded[0],
      { ...step('main.1', { user: 'b@example.com' }, { user: 'b@example.com' }) },
      encoded[2],
    ];

    const expanded = expandStepContexts(mixed);

    assert.deepEqual(expanded[1].contextAfter, { user: 'b@example.com' });
    assert.deepEqual(expanded[2].contextAfter, { user: 'b@example.com', fileId: 43 });
  });

  it('leaves a step that recorded no snapshot without one', () => {
    const expanded = expandStepContexts(
      encodeStepContexts([
        step('main.0', { a: 1 }, { a: 1 }),
        { stepId: 'main.1', description: 'no snapshot', status: 'success' },
      ]),
    );

    assert.equal('contextBefore' in expanded[1], false);
    assert.equal('contextAfter' in expanded[1], false);
  });

  it('does not mutate the steps it is given', () => {
    const encoded = encodeStepContexts(RUN);
    const original = structuredClone(encoded);
    expandStepContexts(encoded);
    assert.deepEqual(encoded, original);
  });

  it('gives each step its own resolved state', () => {
    const expanded = expandStepContexts(encodeStepContexts(RUN));
    assert.notEqual(expanded[1].contextAfter, expanded[2].contextAfter);
    assert.deepEqual(expanded[1].contextAfter, { user: 'a@example.com', env: 'beta', fileId: 42 });
  });
});

describe('mixed input to the encoder', () => {
  it('advances state through a step already in delta form', () => {
    // A merged report can combine shards from either era. Passing an encoded
    // step through without applying it left the accumulated state stale, so a
    // later full-form step encoded a delta that decodes to the wrong values.
    const alreadyEncoded = encodeStepContexts([step('main.0', { a: 1 }, { a: 1, b: 2 })]);
    const mixed: ReportStep[] = [...alreadyEncoded, step('main.1', { a: 1, b: 2 }, { a: 1, b: 3 })];

    const encoded = encodeStepContexts(mixed);

    assert.deepEqual(encoded[1].contextBeforeDelta, {}, 'nothing changed since the previous step');
    assert.deepEqual(encoded[1].contextAfterDelta, { set: { b: 3 } });
    assert.deepEqual(expandStepContexts(encoded)[1].contextAfter, { a: 1, b: 3 });
  });
});

describe('oversized values', () => {
  it('records a change between two values that cap to the same marker', () => {
    // Two Buffers of the same length whose JSON shares its first 120 characters
    // produce an identical marker. Diffing the capped values would call that
    // "unchanged" and drop a real change from the delta.
    const buffer = (tail: number) => ({
      type: 'Buffer',
      data: [...Array.from({ length: 900 }, () => 35), tail],
    });
    const encoded = encodeStepContexts([
      step('main.0', { exported: buffer(1) }, { exported: buffer(1) }),
      step('main.1', { exported: buffer(1) }, { exported: buffer(2) }),
    ]);

    const first = encoded[0].contextBeforeDelta?.set?.exported as string;
    const second = encoded[1].contextAfterDelta?.set?.exported as string;
    assert.equal(typeof first, 'string', 'the oversized value is recorded as a marker');
    assert.equal(first, second, 'and the two markers are indeed identical');
    assert.ok('set' in (encoded[1].contextAfterDelta ?? {}), 'the change is still recorded');
  });
});

describe('orderStepList', () => {
  it('orders the object-keyed carrier by seq, not by how it is iterated', () => {
    const shuffled = {
      'main.10': { seq: 3 },
      'main.1': { seq: 1 },
      'main.1.2': { seq: 2 },
      'main.0': { seq: 0 },
    };
    assert.deepEqual(
      orderStepList(shuffled).map((entry) => entry.stepId),
      ['main.0', 'main.1', 'main.1.2', 'main.10'],
    );
  });

  it('falls back to insertion order for an artifact written before seq existed', () => {
    const legacy = { 'main.0': {}, 'main.1': {}, 'main.2': {} };
    assert.deepEqual(orderStepList(legacy).map((entry) => entry.stepId), ['main.0', 'main.1', 'main.2']);
  });

  it('falls back to insertion order when seq is only partly present', () => {
    const partial = { 'main.1': { seq: 1 }, 'main.0': {} };
    assert.deepEqual(orderStepList(partial).map((entry) => entry.stepId), ['main.1', 'main.0']);
  });
});

describe('attempt scope', () => {
  it('starts each attempt from an empty store, so a retry is self-contained', () => {
    // The reporter encodes per attempt; a retry re-runs from scratch, so its
    // first step must carry the whole store again.
    const attemptOne = encodeStepContexts(RUN);
    const attemptTwo = encodeStepContexts(RUN);

    assert.deepEqual(attemptTwo[0].contextBeforeDelta, { set: { user: 'a@example.com', env: 'beta' } });
    assert.deepEqual(expandStepContexts(attemptTwo), RUN);
    assert.deepEqual(attemptOne, attemptTwo);
  });
});
