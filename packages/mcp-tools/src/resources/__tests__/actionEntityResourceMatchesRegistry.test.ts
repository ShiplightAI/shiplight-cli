/**
 * SC-007: the action-entity resource must render every action in the live
 * registry and no others, so registry drift surfaces as a failing test rather
 * than as stale documentation an agent reads and trusts.
 *
 * Two directions are guarded here, because the existing act-surface guards
 * (`backends/__tests__/actSupportedActionsRegistered.test.ts`) only prove
 * `ACT_SUPPORTED_ACTIONS ⊆ registry` and that the list matches the act union
 * schema. Neither notices an action that exists in the registry but never
 * reaches the resource:
 *
 *   1. resource == advertised. `generateToolDocumentation` does
 *      `if (!tool) continue`, so an advertised-but-unregistered name is
 *      dropped from the resource without any error. Asserting the rendered
 *      headings equal the advertised list catches that silent skip.
 *   2. registry == advertised + a named exclusion set. A tool added to
 *      sdk-core's registry that nobody wires into `act` is invisible today.
 *      Failing here forces a deliberate decision: advertise it, or add it to
 *      the exclusion list with a reason.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getToolRegistry, ensureToolsRegistered } from "sdk-core";
import { getActionEntitySchemaResource } from "../index.js";
import { ACT_SUPPORTED_ACTIONS } from "../../backends/sessionTypes.js";

/**
 * Registry tools the act surface deliberately does NOT advertise.
 *
 * These are AI-driven or control-flow tools: they need a model, a statement or
 * an agent loop rather than a located element, so exposing them through `act`
 * would let an agent invoke a model call it cannot parameterise. The browser
 * lane pins the runtime half of this ("act refuses AI-driven actions over the
 * real tool surface"); this list pins the surface half.
 */
const DELIBERATELY_NOT_ADVERTISED = [
  "ai_extract",
  "ai_wait_until",
  "done",
  "extract_email_content",
  "generate_2fa_code",
  "perform_accurate_operation",
  "verify",
] as const;

/** Every `#### name` heading the resource renders under Supported Actions. */
function renderedActionNames(markdown: string): string[] {
  return [...markdown.matchAll(/^#### (.+)$/gm)].map((m) => m[1].trim()).sort();
}

describe("action-entity resource matches the live registry (SC-007)", () => {
  it("renders exactly the actions act advertises — no silent drops, no extras", async () => {
    const markdown = await getActionEntitySchemaResource();

    assert.deepEqual(
      renderedActionNames(markdown),
      [...ACT_SUPPORTED_ACTIONS].sort(),
      "the resource and ACT_SUPPORTED_ACTIONS have drifted. A missing entry means " +
        "generateToolDocumentation hit `if (!tool) continue` for a name that is not " +
        "registered, so the resource quietly under-documents the act surface.",
    );
  });

  it("accounts for every registered tool — advertised, or excluded on purpose", async () => {
    await ensureToolsRegistered();
    const registered = getToolRegistry().getToolNames();

    const advertised = new Set<string>(ACT_SUPPORTED_ACTIONS);
    const excluded = new Set<string>(DELIBERATELY_NOT_ADVERTISED);
    const unaccounted = registered.filter((n) => !advertised.has(n) && !excluded.has(n)).sort();

    assert.deepEqual(
      unaccounted,
      [],
      `these tools are in the registry but neither advertised by act nor listed as ` +
        `deliberately excluded: ${unaccounted.join(", ")}. Registry drift must be a ` +
        `decision, not a default — either add the action to ACT_SUPPORTED_ACTIONS so ` +
        `the resource documents it, or add it to DELIBERATELY_NOT_ADVERTISED with a reason.`,
    );
  });

  it("keeps the exclusion list honest — every excluded name still exists", async () => {
    await ensureToolsRegistered();
    const registered = new Set(getToolRegistry().getToolNames());

    const stale = DELIBERATELY_NOT_ADVERTISED.filter((n) => !registered.has(n));

    assert.deepEqual(
      stale,
      [],
      `these names are excluded from the act surface but no longer exist in the ` +
        `registry: ${stale.join(", ")}. A stale exclusion silently widens the ` +
        `unaccounted-for check above.`,
    );
  });
});
