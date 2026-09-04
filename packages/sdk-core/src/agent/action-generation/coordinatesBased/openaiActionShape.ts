/**
 * Normalize an OpenAI CUA action to a common shape.
 *
 * GA (`gpt-5.4`) returns actions like `{type: "drag", path: [[x, y], ...]}`
 * with tuple-array paths that can contain many points tracing a curve. The
 * path may also appear as an array of `{x, y}` objects per the docs.
 *
 * This function is kept in its own module so it can be unit-tested without
 * transitively importing any of sdk-core's runtime modules (playwright, dom
 * service with `?raw` imports, OpenAI client, etc).
 */
export interface NormalizedOpenAIAction {
  type?: string;
  x?: number;
  y?: number;
  button?: string;
  path?: { x: number; y: number }[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

function asNumber(value: unknown): number | undefined {
  // Reject NaN and +/-Infinity — `typeof NaN === 'number'` is true, so a
  // naive check lets them through and produces a mis-aimed (0, 0) drag.
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Return a {x, y} point only if both coordinates parse to finite numbers.
 * Points with missing or non-numeric coordinates return `null` so the caller
 * can filter them out — silently zeroing bad values would produce mis-aimed
 * drags at the top-left corner with no warning.
 */
function normalizePathPoint(raw: unknown): { x: number; y: number } | null {
  let x: number | undefined;
  let y: number | undefined;
  if (Array.isArray(raw)) {
    x = asNumber(raw[0]);
    y = asNumber(raw[1]);
  } else if (isObject(raw)) {
    x = asNumber(raw.x);
    y = asNumber(raw.y);
  }
  if (x === undefined || y === undefined) return null;
  return { x, y };
}

export function normalizeOpenAIAction(raw: unknown): NormalizedOpenAIAction {
  if (!isObject(raw)) return {};
  const path = Array.isArray(raw.path)
    ? raw.path
        .map(normalizePathPoint)
        .filter((p): p is { x: number; y: number } => p !== null)
    : undefined;
  return {
    type: asString(raw.type),
    x: asNumber(raw.x),
    y: asNumber(raw.y),
    button: asString(raw.button),
    path,
  };
}
