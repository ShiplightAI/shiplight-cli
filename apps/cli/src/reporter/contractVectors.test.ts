import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeStepContexts, expandStepContexts, orderStepList } from './contextDelta.js';
import type { ReportStep } from './template.js';

/**
 * The writer's half of the report-artifact contract, run against the same
 * vectors file the cloud reader is implemented from.
 *
 * The point is cross-repo: the cloud service implements its reader from
 * specs/002-shiplightai-cli/contracts/report-artifact.md and copies this file.
 * If the two implementations drift, a case fails here rather than turning into a
 * rendering bug nobody attributes to the encoding.
 */

const VECTORS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../specs/002-shiplightai-cli/contracts/report-artifact-vectors.json',
);

interface Vector {
  name: string;
  why: string;
  direction: 'both' | 'decode';
  encoded: ReportStep[];
  resolved: ReportStep[];
}

interface ObjectCarrierVector {
  why: string;
  resultJson: Record<string, ReportStep & { seq?: number }>;
  expectedOrder: string[];
  expectedResolved?: ReportStep[];
  legacyNoSeq: { why: string; resultJson: Record<string, { seq?: number }>; expectedOrder: string[] };
}

const vectors = JSON.parse(fs.readFileSync(VECTORS_PATH, 'utf-8')) as {
  contractVersion: number;
  schemaVersion: number;
  cases: Vector[];
  objectCarrier: ObjectCarrierVector;
};

/** Only the context fields are under contract; the rest of a step is carried through. */
function contextsOf(steps: ReportStep[]): Array<Record<string, unknown>> {
  return steps.map((step) => {
    const view: Record<string, unknown> = { stepId: step.stepId };
    for (const field of ['contextBefore', 'contextAfter', 'contextBeforeDelta', 'contextAfterDelta'] as const) {
      if (field in step) view[field] = step[field];
    }
    return view;
  });
}

describe('report-artifact contract vectors', () => {
  it('pins the contract and artifact versions the vectors describe', () => {
    assert.equal(vectors.contractVersion, 1);
    assert.equal(vectors.schemaVersion, 3);
  });

  it('covers both directions', () => {
    assert.ok(vectors.cases.length >= 8, `expected the full case set, got ${vectors.cases.length}`);
    assert.ok(vectors.cases.some((c) => c.direction === 'both'));
    assert.ok(vectors.cases.some((c) => c.direction === 'decode'));
  });

  describe('object carrier', () => {
    const carrier = vectors.objectCarrier;

    it('orders resultJson entries by seq', () => {
      assert.deepEqual(orderStepList(carrier.resultJson).map((e) => e.stepId), carrier.expectedOrder, carrier.why);
    });

    it('falls back to insertion order without seq', () => {
      const legacy = carrier.legacyNoSeq;
      assert.deepEqual(orderStepList(legacy.resultJson).map((e) => e.stepId), legacy.expectedOrder, legacy.why);
    });

    it('resolves the chain once ordered', () => {
      const ordered = orderStepList(carrier.resultJson).map(({ stepId, step }) => ({ ...step, stepId }));
      assert.deepEqual(contextsOf(expandStepContexts(ordered)), contextsOf(carrier.expectedResolved ?? []), carrier.why);
    });
  });

  for (const vector of vectors.cases) {
    it(`reads: ${vector.name}`, () => {
      assert.deepEqual(
        contextsOf(expandStepContexts(vector.encoded)),
        contextsOf(vector.resolved),
        vector.why,
      );
    });

    if (vector.direction === 'both') {
      it(`writes: ${vector.name}`, () => {
        assert.deepEqual(
          contextsOf(encodeStepContexts(vector.resolved)),
          contextsOf(vector.encoded),
          vector.why,
        );
      });
    }
  }
});
