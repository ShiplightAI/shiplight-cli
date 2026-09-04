/**
 * Action Entity Fingerprint — validity token for a cached action entity.
 *
 * The action-entity cache is keyed by statement UID, and entries are written only by
 * self-healing. So an entry's premise is: "the inline entity that was at this statement
 * failed, and this is what worked instead." Nothing ever re-checked that premise. The UID
 * is derived from position and description only — deliberately, since it is also the
 * statement's identity for debug artifacts and post-run attribution — so editing a
 * `locator:`, an `xpath:`, or an action's kwargs left the key unchanged and the healed
 * entity kept winning the priority contest in `transpileAction`, silently shadowing the
 * fix with the entity it superseded. (Editing `text:` on an input was the sharpest form:
 * the run kept typing the old value.)
 *
 * The fingerprint closes that without touching identity. A heal records what the inline
 * entity looked like at heal time; a later transpile serves the entry only if the inline
 * entity still fingerprints the same. Edit the YAML and the entry stops applying — the
 * edit runs, and if it is still broken it heals again and re-stamps the SAME key, so
 * nothing accumulates.
 */

import type { ActionEntity } from './actionEntity';

/**
 * Fingerprint the parts of an inline action entity that decide what actually runs:
 * the action name, its kwargs, and the element locators.
 *
 * Deliberately not the whole entity. `action_description` is carried by the statement
 * description (already part of the UID), and the remaining fields (`text`, `tag`, `url`,
 * `feedback`, `artifacts`, …) are capture-time debris that YAML round-tripping strips
 * anyway — including them would invalidate on noise the user never wrote. `action` is read
 * as a fallback for `action_data` because the entity type keeps it as a backward-compatible
 * alias and other producers still populate it.
 *
 * kwargs are included WHOLESALE and that is intentional, even though it means a
 * `timeout_seconds` bump — which has nothing to do with element identity — costs a
 * mismatch. A store entry replaces the inline entity in full, kwargs included, so any
 * kwarg the fingerprint ignores is a kwarg the cache can silently override with its
 * heal-time value. Under this design a mismatch is cheap and self-correcting: the
 * statement runs its inline entity, heals if needed, and re-stamps the same key. That is
 * a far better trade than a class of edits the user's YAML cannot express.
 *
 * Returns the empty string when there is no inline entity. That is a real fingerprint
 * value, distinct from `undefined` — which on a store entry means "written before
 * fingerprinting existed". Conflating them would let an entry that superseded nothing be
 * grandfathered forever.
 */
export function fingerprintActionEntity(entity: ActionEntity | undefined): string {
  if (!entity) return '';
  const actionData = entity.action_data ?? entity.action;
  return stableStringify({
    action_name: actionData?.action_name,
    kwargs: actionData?.kwargs,
    locator: entity.locator,
    xpath: entity.xpath,
  });
}

/**
 * Whether a store entry may serve this statement.
 *
 * `undefined` on the entry means it predates fingerprinting. Those are GRANDFATHERED —
 * served as before — because the alternative is to strand every existing user's cache in
 * one release, forcing a full re-heal of every entity-bearing statement (slow, and red
 * wherever healing does not converge). They lose the grandfather clause the first time
 * they heal, since the write-back stamps every entry it touches.
 *
 * The empty string is NOT that case: it is the fingerprint of "no inline entity", so such
 * an entry stops applying as soon as the YAML grows one.
 */
export function isStoreEntryApplicable(
  entryFingerprint: string | undefined,
  inlineEntity: ActionEntity | undefined,
): boolean {
  if (entryFingerprint === undefined) return true;
  return entryFingerprint === fingerprintActionEntity(inlineEntity);
}

/**
 * JSON with object keys sorted at every depth, and scalars normalised to strings.
 *
 * Two hazards this defends against, both of which would drop a valid cache entry over a
 * change the user did not make:
 * - `kwargs` comes straight off the YAML document, so plain `JSON.stringify` would order
 *   keys as they happened to be written and a pure reordering would look like an edit.
 * - YAML is untyped at the source. `text: 123` parses to a number and `text: "123"` to a
 *   string; a formatter adding quotes must not read as a different value.
 */
function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  // Scalars compare as their string form, so YAML retyping is not an edit.
  return JSON.stringify(String(value));
}
