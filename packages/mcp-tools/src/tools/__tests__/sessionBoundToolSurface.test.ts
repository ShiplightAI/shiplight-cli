import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalTestTools } from "../localTestTools.js";
import { TOOL_TO_METHOD } from "../../registry/toolRegistry.js";

/**
 * Spec 003 SC-006 — the session-bound boundary is a standing guard, not a
 * one-time cleanup.
 *
 * The MCP server owns live browser sessions. Test authoring — scaffolding,
 * `.test.yaml` validation, YAML->spec transpilation — belongs to the CLI, so
 * that the artifact which validates a test is the same artifact, at the same
 * version, that runs it. Before this split, validation shipped in
 * `@shiplightai/mcp` while execution shipped in `shiplightai`; an agent could
 * validate green against one YAML schema and fail at run time against another,
 * with nothing detecting the skew.
 *
 * If one of these tools is reintroduced here, this test fails and the reviewer
 * gets the reason rather than rediscovering it.
 */
describe("LocalTestTools registered surface is session-bound", () => {
  const registered = LocalTestTools.toolDefinitions.map((t) => t.name);

  const AUTHORING_TOOLS = [
    "scaffold_project",
    "validate_yaml_test",
    "export_yaml_to_test",
  ];

  for (const name of AUTHORING_TOOLS) {
    it(`does not expose ${name} — it belongs to the shiplightai CLI`, () => {
      assert.equal(
        registered.includes(name),
        false,
        `${name} was reintroduced to LocalTestTools.toolDefinitions. Authoring tools must ship with the parser that runs them; use the CLI equivalent instead.`,
      );
    });
  }

  it("exposes only tools that operate on a browser session", () => {
    // generate_html_report qualifies: it takes a session_id and reports on
    // that session's recording. Its cloud counterpart upload_html_report was
    // removed along with the rest of the v1 cloud surface.
    assert.deepEqual(registered, ["generate_html_report"]);
  });

  it("backs every registered definition with a handler", () => {
    // A definition without a method is a tool the agent can see and not call.
    // Resolve through the real registry mapping rather than a hardcoded
    // ternary — a ternary would silently resolve any future tool name to an
    // always-present method and mask a missing handler.
    const instance = new LocalTestTools();
    for (const name of registered) {
      const method = TOOL_TO_METHOD[name];
      assert.ok(method, `${name} has no entry in TOOL_TO_METHOD`);
      assert.equal(
        typeof (instance as unknown as Record<string, unknown>)[method!],
        "function",
        `${name} has no backing handler`,
      );
    }
  });
});

/**
 * The registry's name<->method table is a second place an authoring tool can
 * reappear, and the guard above does not see it: it reads `toolDefinitions`
 * only. That blind spot is exactly how two dead reverse-map rows
 * (`scaffoldProject`, `validateTestYaml`) survived the tool removal.
 *
 * The inverse map is now derived rather than hand-written, so forward/reverse
 * cannot drift from each other. What is still hand-edited — and therefore
 * still worth guarding — is the forward table itself.
 */
describe("tool registry mapping table is session-bound", () => {
  const registrySrc = readFileSync(
    path.resolve(fileURLToPath(import.meta.url), "../../../registry/toolRegistry.ts"),
    "utf-8",
  );

  // Assert against the EXPORTED map object, not a source-text parse: the
  // regex approach was fragile to whitespace/comment drift around the map
  // literal, and a partial parse could under-count silently. The import is
  // the same object the registry dispatches through, so it cannot lie.
  const forward = TOOL_TO_METHOD;

  it("reads a plausibly-sized forward table (guards against a gutted map)", () => {
    // Was >20 before the v1 cloud tools (test cases, templates, functions, test
    // accounts, test results, report upload) were removed. The remaining
    // entries are session/browser tools plus generate_html_report; the floor is
    // set just under that so a genuinely gutted map still fails.
    assert.ok(Object.keys(forward).length >= 15, "expected the forward map to be populated");
  });

  for (const tool of ["scaffold_project", "validate_yaml_test", "export_yaml_to_test"]) {
    it(`does not map ${tool} to a handler`, () => {
      assert.equal(
        tool in forward,
        false,
        `${tool} is back in TOOL_TO_METHOD. Authoring tools live in the shiplightai CLI.`,
      );
    });
  }

  for (const method of ["scaffoldProject", "validateTestYaml", "exportYamlToTest"]) {
    it(`does not map any tool to ${method}()`, () => {
      const tools = Object.entries(forward)
        .filter(([, m]) => m === method)
        .map(([t]) => t);
      assert.deepEqual(tools, [], `${method}() is reachable via ${tools.join(", ")}`);
    });
  }

  it("keeps the reverse map derived, not hand-written", () => {
    // If someone reintroduces a literal inverse table, the drift this test
    // exists to prevent becomes possible again.
    assert.match(
      registrySrc,
      /const METHOD_TO_TOOLS[\s\S]{0,200}Object\.entries\(\s*TOOL_TO_METHOD/,
      "METHOD_TO_TOOLS must be derived from TOOL_TO_METHOD",
    );
  });
});
