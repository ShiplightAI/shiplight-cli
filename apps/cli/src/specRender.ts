/**
 * Pure transforms used by scripts/render-spec-assets.mts when rendering
 * `shiplight spec actions` at build time.
 *
 * Split out of the build script for one reason: the script executes `main()`
 * on import (it IS the build step) and statically imports sdk-core, so a
 * unit test could not reach this logic without running a build. Living here,
 * the `element_index` presentation rule has a proof that runs in the plain
 * unit lane on every PR — not only in the post-build release lane where the
 * rendered-doc guards run. Nothing from this module is imported by any
 * bundled entry point, so it adds no weight to cli.js.
 */

/**
 * Present an action's schema as the kwargs a `.test.yaml` statement accepts.
 *
 * This is a PRESENTATION rule, not a second schema. The one source of truth
 * stays `packages/sdk-core/src/actions/impl/*.ts` — this only drops the
 * live-session targeting field (`element_index`), and only for actions the
 * registry itself flags with `usesElementIndex`. Nothing here is
 * hand-maintained per action, so a new element-targeted action is handled
 * correctly the day it registers.
 *
 * Why dropping it matters: `element_index` is meaningful only against a DOM
 * `act` has just inspected. Written into YAML it is silently discarded by the
 * transpiler and the step runs with no target — so advertising it produces
 * tests that validate clean and do the wrong thing.
 *
 * It deliberately does not validate or constrain kwargs; the YAML layer
 * passes unrecognised fields through by design.
 */
export function toYamlKwargsSchema(
  schema: unknown,
  usesElementIndex: boolean,
): unknown {
  if (!usesElementIndex || typeof schema !== "object" || schema === null) {
    return schema;
  }

  const s = schema as {
    properties?: Record<string, unknown>;
    required?: string[];
    [k: string]: unknown;
  };
  if (!s.properties || !("element_index" in s.properties)) return schema;

  const { element_index: _dropped, ...properties } = s.properties;
  const required = s.required?.filter((r) => r !== "element_index");

  const out: Record<string, unknown> = { ...s, properties };
  if (required && required.length > 0) out.required = required;
  else delete out.required;
  return out;
}
