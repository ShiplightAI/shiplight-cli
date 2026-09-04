/**
 * Changed-only encoding for the per-step variable snapshots.
 *
 * The engine copies the whole variable store into every step, twice
 * (sdk-core `webAgent.ts` `snapshotVariables`). On a measured 264-test customer
 * run that was 8,751 snapshots of ~220 variables — 58% of the report, more than
 * half of it the repeated variable *names* — and a ~435-test run serialized past
 * V8's maximum string length, killing `shiplight report --merge` before it could
 * upload anything. Recording only what changed since the previous step brings the
 * same run from 217.8 MB to 18.9 MB (9.1 MB with the value cap).
 *
 * The snapshots are display-only, so this is lossless where it matters:
 * `expandStepContexts` reconstructs exactly what `encodeStepContexts` was given.
 * Both functions are pure — they never mutate the steps handed to them, which is
 * what lets a test's `steps` array be shared with its final attempt's.
 *
 * The wire contract, including the reader half implemented in the cloud, is
 * specs/002-shiplightai-cli/contracts/report-artifact.md.
 */

import { capVariableSnapshot } from './contextSnapshot.js';
import type { ReportStep, VariableDelta } from './template.js';

/** The two snapshot positions, and the field names each form uses. */
const POSITIONS = [
  { full: 'contextBefore', delta: 'contextBeforeDelta' },
  { full: 'contextAfter', delta: 'contextAfterDelta' },
] as const;

/**
 * Stand-in for a value `JSON.stringify` cannot represent (a function, an
 * explicit `undefined`). Such a value is dropped from the report either way;
 * the sentinel only has to compare equal to itself so it is not re-recorded
 * as a change on every step.
 */
const UNSERIALIZABLE = ' unserializable';

function serialize(value: unknown): string {
  return JSON.stringify(value) ?? UNSERIALIZABLE;
}

/**
 * Diff one snapshot against the accumulated state, advancing that state.
 *
 * The state holds each variable's **uncapped** serialization, and the cap is
 * applied only to what is emitted. Comparing capped values instead would make
 * two different oversized values that share a length and a 120-character prefix
 * — two `Buffer`s of the same size, say — compare equal, so a real change would
 * be recorded as no change.
 *
 * Empty members are omitted, so an unchanged snapshot encodes as `{}` — which
 * still says "a snapshot was taken here", unlike an absent field.
 */
function diffAgainst(state: Map<string, string>, snapshot: Record<string, unknown>): VariableDelta {
  const set: Record<string, unknown> = {};
  let changed = false;
  for (const [key, value] of Object.entries(snapshot)) {
    const json = serialize(value);
    if (state.get(key) === json) continue;
    state.set(key, json);
    set[key] = value;
    changed = true;
  }

  // `VariableStore` supports delete()/clear(), so a key can genuinely go away.
  const removed: string[] = [];
  for (const key of state.keys()) {
    if (!(key in snapshot)) removed.push(key);
  }
  for (const key of removed) state.delete(key);

  const delta: VariableDelta = {};
  if (changed) delta.set = capVariableSnapshot(set);
  if (removed.length > 0) delta.removed = removed;
  return delta;
}

/**
 * Advance the state across a delta this function did not produce (see below).
 *
 * The values in such a delta may already be truncation markers, so the state
 * then holds the marker's serialization rather than the original value's. A
 * later full-form step carrying the uncapped original would diff as changed and
 * re-record it. That costs a few bytes on a path only a mixed list reaches; it
 * cannot make the decoded values wrong, which is what the state exists to
 * protect.
 */
function applyDeltaToState(state: Map<string, string>, delta: VariableDelta): void {
  for (const [key, value] of Object.entries(delta.set ?? {})) state.set(key, serialize(value));
  for (const key of delta.removed ?? []) state.delete(key);
}

/**
 * Replace each step's full snapshots with what changed since the previous step.
 *
 * The accumulated state is scoped to this one step list — a retry's attempt
 * starts from an empty store, because the run does.
 *
 * A step already carrying the delta form is passed through, but its delta is
 * still applied to the accumulated state: a list that mixes the two forms (a
 * merged report combining shards from either era) would otherwise diff its
 * full-form steps against a stale state and encode values that decode wrong.
 */
export function encodeStepContexts(steps: ReportStep[]): ReportStep[] {
  const state = new Map<string, string>();
  return steps.map((step) => {
    let encoded: ReportStep | undefined;
    for (const { full, delta } of POSITIONS) {
      const alreadyEncoded = step[delta];
      if (alreadyEncoded) {
        applyDeltaToState(state, alreadyEncoded);
        continue;
      }
      const snapshot = step[full];
      if (!snapshot) continue;
      encoded ??= { ...step };
      delete encoded[full];
      encoded[delta] = diffAgainst(state, snapshot);
    }
    return encoded ?? step;
  });
}

/**
 * Resolve each step's snapshots back to full stores.
 *
 * Accepts the full form, the delta form, and a list mixing them: a full
 * snapshot is authoritative and replaces the accumulated state, which is what
 * makes a mixed list well defined. This is the reference implementation of the
 * reader described in the contract — the cloud implements the same algorithm.
 *
 * The list must already be in recorded order; see `orderStepList` for the
 * object-keyed carrier.
 */
export function expandStepContexts(steps: ReportStep[]): ReportStep[] {
  let state: Record<string, unknown> = {};
  return steps.map((step) => {
    let expanded: ReportStep | undefined;
    for (const { full, delta } of POSITIONS) {
      const encodedDelta = step[delta];
      if (step[full]) {
        // Authoritative: a full snapshot resets everything accumulated so far.
        state = { ...step[full] };
        continue;
      }
      if (!encodedDelta) continue;
      state = { ...state, ...(encodedDelta.set ?? {}) };
      for (const key of encodedDelta.removed ?? []) delete state[key];
      expanded ??= { ...step };
      delete expanded[delta];
      expanded[full] = state;
    }
    return expanded ?? step;
  });
}

/**
 * Put the object-keyed carrier (`segments[].resultJson`) into recorded order.
 *
 * A delta chain only resolves in the order the steps were recorded, and a
 * consumer of this carrier does not necessarily iterate it that way — the cloud,
 * for one, builds its step list from `actionStepsMap` and looks each id up here,
 * partitioned by phase and rebuilt as a tree. `seq` makes the order data rather
 * than a property of iteration; artifacts written before `seq` existed fall back
 * to key insertion order, which is what they relied on.
 *
 * Resolve over this ordered list, then render in whatever order the UI wants.
 */
export function orderStepList<T extends { seq?: number }>(
  resultJson: Record<string, T>,
): Array<{ stepId: string; step: T }> {
  const entries = Object.entries(resultJson).map(([stepId, step], index) => ({ stepId, step, index }));
  const ordered = entries.every((entry) => typeof entry.step.seq === 'number')
    ? [...entries].sort((a, b) => a.step.seq! - b.step.seq! || a.index - b.index)
    : entries;
  return ordered.map(({ stepId, step }) => ({ stepId, step }));
}
