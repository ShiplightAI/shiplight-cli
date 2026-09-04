/**
 * Size cap for the per-step variable snapshots (`contextBefore` / `contextAfter`).
 *
 * The runtime copies the *whole* variable store into every step, twice
 * (sdk-core `webAgent.ts` `snapshotVariables`). The values are display-only —
 * nothing reads them back — so one oversized variable is pure report weight
 * multiplied by the step count. A real run showed a test storing downloaded
 * file bytes in `exportedBuffers`: Node Buffers JSON-encode as
 * `{"type":"Buffer","data":[35,35,…]}`, 2 MB per snapshot, and two-space
 * indentation puts every byte on its own line — 87 MB from a single 13-step
 * test.
 *
 * Capping is applied here, at report-assembly time, not in sdk-core: the SDK's
 * `StepExecutionResult` is a public type and its live values stay complete.
 *
 * The recorded form is contractual — a consumer may detect the markers to
 * annotate a value as truncated. See §7 of
 * specs/002-shiplightai-cli/contracts/report-artifact.md.
 */

/**
 * Values longer than this are replaced by a truncation marker. A string is
 * measured in its own characters and an object in the characters of its JSON —
 * each in the unit the marker then reports, so the threshold, the kept prefix
 * and the reported size cannot disagree.
 *
 * Measured against a 264-test run: 512 B, 1 KB, 2 KB and 4 KB all land within
 * 0.3 MB of each other (~-33%), because only a handful of values are oversized.
 * The limit is about bounding the worst case, not about shaving bytes.
 */
export const VARIABLE_VALUE_LIMIT = 1024;

/** First characters of an oversized non-string value, kept so the marker still identifies it. */
const PREVIEW_LENGTH = 120;

/**
 * The recorded form of one oversized value, or `undefined` when it fits — or
 * when replacing it would not actually make it shorter, which is the case just
 * above the limit, where the marker costs more than the characters it drops.
 */
function capValue(value: unknown, limit: number): string | undefined {
  if (typeof value === 'string') {
    if (value.length <= limit) return undefined;
    const marker = `${value.slice(0, limit)}… [truncated, ${value.length} chars]`;
    return marker.length < value.length ? marker : undefined;
  }

  const json = JSON.stringify(value);
  // `undefined` for functions/undefined — nothing to measure, and
  // JSON.stringify drops the key from the report anyway.
  if (json === undefined || json.length <= limit) return undefined;
  const marker = `[truncated, ${json.length} chars] ${json.slice(0, PREVIEW_LENGTH)}…`;
  return marker.length < json.length ? marker : undefined;
}

/**
 * Replace oversized values in one variable snapshot, leaving everything else
 * untouched. Returns the original object when nothing needed truncating, so an
 * ordinary step keeps its exact snapshot (and its object identity).
 */
export function capVariableSnapshot(
  snapshot: Record<string, unknown>,
  limit: number = VARIABLE_VALUE_LIMIT,
): Record<string, unknown> {
  let capped: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(snapshot)) {
    const marker = capValue(value, limit);
    if (marker === undefined) continue;
    capped ??= { ...snapshot };
    capped[key] = marker;
  }
  return capped ?? snapshot;
}
