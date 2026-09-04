import { describe, it } from "node:test";
import assert from "node:assert";
import { getResource, listResources } from "../index.js";

describe("getResource URI resolution", () => {
  it("resolves the canonical action-entity URI", async () => {
    assert.ok(await getResource("shiplight://schemas/action-entity"));
  });

  it("returns undefined for an unknown URI", async () => {
    assert.equal(await getResource("shiplight://does-not-exist"), undefined);
  });

  it("advertises exactly the action-entity resource", () => {
    // This server is browser-only, so it has exactly one resource. Asserted as
    // an exact set: a resource quietly reappearing is as much a regression as
    // one disappearing.
    assert.deepEqual(listResources().map((r) => r.uri), [
      "shiplight://schemas/action-entity",
    ]);
  });

  // The TestFlow JSON schema described the v1 cloud format consumed by
  // save_test_case / get_test_case. Those tools were backed solely by the
  // deprecated monots core-api and have been removed, so the schema documents a
  // format this server no longer speaks. The legacy versioned aliases must stop
  // resolving too — a live alias would keep serving a spec nothing here owns.
  it("no longer serves the TestFlow JSON schema", async () => {
    for (const uri of [
      "shiplight://schemas/testflow-json",
      "shiplight://schemas/testflow-json-v1.2.0",
      "shiplight://schemas/testflow-json-v1.3.0",
    ]) {
      assert.equal(await getResource(uri), undefined, `${uri} must no longer resolve`);
      assert.equal(listResources().some((r) => r.uri === uri), false, `${uri} must not be listed`);
    }
  });

  // Spec 003 FR-012 / 002 FR-014: the normative YAML language spec ships with
  // the CLI (`npx shiplight spec yaml`), not this server, so an agent cannot
  // read a spec describing syntax the installed transpiler does not accept.
  // Both the canonical URI and its legacy alias must stop resolving — a live
  // alias would keep serving a spec this package no longer owns or updates.
  it("no longer serves the YAML language spec", async () => {
    assert.equal(await getResource("shiplight://yaml-test-spec"), undefined);
    assert.equal(await getResource("shiplight://yaml-test-spec-v1.3.0"), undefined);
    const uris = listResources().map((r) => r.uri);
    assert.equal(uris.includes("shiplight://yaml-test-spec"), false);
  });

  // Spec 003 FR-015: the action-entity resource documents what THIS server
  // produces. It must not teach `.test.yaml` authoring via tools this server
  // no longer exposes — its trailing section once walked agents through
  // `scaffold_project`, which now fails as an unknown tool.
  it("action-entity content references no removed tool and no removed resource", async () => {
    const body = await getResource("shiplight://schemas/action-entity");
    assert.ok(body);
    for (const gone of [
      "scaffold_project",
      "validate_yaml_test",
      "export_yaml_to_test",
      "shiplight://yaml-test-spec",
    ]) {
      assert.equal(
        body!.includes(gone),
        false,
        `action-entity resource still references removed surface: ${gone}`,
      );
    }
    // The authoring pointer it should carry instead.
    assert.match(body!, /shiplight (create|transpile|spec)/);
  });
});
