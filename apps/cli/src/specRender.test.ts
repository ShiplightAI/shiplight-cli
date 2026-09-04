import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toYamlKwargsSchema } from "./specRender.js";

/**
 * Build-independent proof of the `element_index` presentation rule.
 *
 * The rendered-doc guards in commands/spec.test.ts assert the same rule over
 * dist/spec/actions.md, but they self-skip when dist/ is unbuilt — which is
 * every PR unit-lane run. This suite runs always, so a change that stops
 * stripping the live-session targeting field fails review, not release.
 */
describe("toYamlKwargsSchema", () => {
  const clickLike = () => ({
    type: "object",
    properties: {
      element_index: { type: "integer" },
      timeout_ms: { type: "number" },
    },
    required: ["element_index"],
    additionalProperties: false,
  });

  it("drops element_index from properties and required for element-targeted actions", () => {
    const out = toYamlKwargsSchema(clickLike(), true) as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    assert.equal("element_index" in out.properties, false);
    assert.equal("timeout_ms" in out.properties, true);
    // required contained only element_index — the key must be gone entirely,
    // not left as an empty array (invalid-ish JSON Schema noise).
    assert.equal("required" in out, false);
  });

  it("keeps other required fields when element_index is not the only one", () => {
    const schema = clickLike();
    schema.required = ["element_index", "text"];
    (schema.properties as Record<string, unknown>).text = { type: "string" };
    const out = toYamlKwargsSchema(schema, true) as { required?: string[] };
    assert.deepEqual(out.required, ["text"]);
  });

  it("returns the schema untouched when the action is not element-targeted", () => {
    // The flag comes from the registry (`usesElementIndex`); the transform
    // must not second-guess it by dropping the field everywhere.
    const schema = clickLike();
    const out = toYamlKwargsSchema(schema, false);
    assert.equal(out, schema);
  });

  it("returns the schema untouched when element_index is absent", () => {
    const schema = { type: "object", properties: { keys: { type: "string" } } };
    assert.equal(toYamlKwargsSchema(schema, true), schema);
  });

  it("passes through non-object schemas rather than crashing", () => {
    assert.equal(toYamlKwargsSchema(null, true), null);
    assert.equal(toYamlKwargsSchema("boolean-schema", true), "boolean-schema");
  });

  it("does not mutate its input", () => {
    const schema = clickLike();
    const snapshot = JSON.stringify(schema);
    toYamlKwargsSchema(schema, true);
    assert.equal(JSON.stringify(schema), snapshot);
  });
});
