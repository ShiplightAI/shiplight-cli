import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { parseSpecArgs, resolveSpecAsset, runSpec } from "./spec.js";

describe("parseSpecArgs", () => {
  it("accepts the two supported topics", () => {
    assert.deepEqual(parseSpecArgs(["yaml"]), { topic: "yaml" });
    assert.deepEqual(parseSpecArgs(["actions"]), { topic: "actions" });
  });

  it("errors with the valid topics listed when the topic is unknown", () => {
    const result = parseSpecArgs(["yamls"]);
    assert.ok("error" in result);
    // The message must name the alternatives — a bare "unknown topic" leaves
    // the caller guessing, and the caller is often an agent.
    assert.match(result.error, /yaml, actions/);
  });

  it("errors when no topic is given", () => {
    const result = parseSpecArgs([]);
    assert.ok("error" in result);
    assert.match(result.error, /missing required/);
  });

  it("errors on a second positional rather than silently ignoring it", () => {
    const result = parseSpecArgs(["yaml", "actions"]);
    assert.ok("error" in result);
    assert.match(result.error, /unexpected argument: actions/);
  });

  it("ignores flags when reading the topic", () => {
    assert.deepEqual(parseSpecArgs(["--no-color", "yaml"]), { topic: "yaml" });
  });
});

describe("resolveSpecAsset", () => {
  function withTree(
    layout: Record<string, string>,
    fn: (root: string) => void,
  ): void {
    const root = mkdtempSync(path.join(tmpdir(), "spec-asset-"));
    try {
      for (const [rel, body] of Object.entries(layout)) {
        const abs = path.join(root, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, body);
      }
      fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it("finds built assets next to the bundle (published layout)", () => {
    withTree({ "dist/spec/yaml.md": "built" }, (root) => {
      const moduleDir = path.join(root, "dist");
      assert.equal(
        resolveSpecAsset("yaml", moduleDir),
        path.join(root, "dist", "spec", "yaml.md"),
      );
    });
  });

  it("finds built assets from a source checkout (src/commands layout)", () => {
    withTree({ "dist/spec/actions.md": "built" }, (root) => {
      const moduleDir = path.join(root, "src", "commands");
      assert.equal(
        resolveSpecAsset("actions", moduleDir),
        path.join(root, "dist", "spec", "actions.md"),
      );
    });
  });

  it("prefers the built YAML spec over the source doc", () => {
    // A stale checkout must never shadow the artifact that actually shipped.
    withTree(
      {
        "dist/spec/yaml.md": "built",
        "docs/YAML-TEST-LANGUAGE-SPEC.md": "source",
      },
      (root) => {
        const moduleDir = path.join(root, "src", "commands");
        assert.equal(
          resolveSpecAsset("yaml", moduleDir),
          path.join(root, "dist", "spec", "yaml.md"),
        );
      },
    );
  });

  it("falls back to the source doc for yaml when nothing is built", () => {
    withTree({ "docs/YAML-TEST-LANGUAGE-SPEC.md": "source" }, (root) => {
      const moduleDir = path.join(root, "src", "commands");
      assert.equal(
        resolveSpecAsset("yaml", moduleDir),
        path.join(root, "docs", "YAML-TEST-LANGUAGE-SPEC.md"),
      );
    });
  });

  it("has no source fallback for actions — it is generated, not authored", () => {
    // Returning null here is what makes `spec actions` say "run the build"
    // instead of printing a stale hand-written list that has drifted from the
    // engine registry.
    withTree({ "docs/YAML-TEST-LANGUAGE-SPEC.md": "source" }, (root) => {
      const moduleDir = path.join(root, "src", "commands");
      assert.equal(resolveSpecAsset("actions", moduleDir), null);
    });
  });

  it("returns null when the asset is missing entirely", () => {
    withTree({}, (root) => {
      assert.equal(resolveSpecAsset("yaml", path.join(root, "dist")), null);
    });
  });
});

describe("rendered action reference (dist/spec/actions.md)", () => {
  // Skipped rather than failed when unbuilt: the unit lane runs pre-build in
  // CI. The release path builds first, so these do gate a publish.
  const assetPath = resolveSpecAsset(
    "actions",
    path.join(process.cwd(), "src", "commands"),
  );

  const doc = assetPath ? readFileSync(assetPath, "utf-8") : null;

  function schemaBlocks(src: string): Array<{ name: string; schema: Record<string, unknown> }> {
    const re = /^## (\w+)\n[\s\S]*?```json\n([\s\S]*?)\n```/gm;
    return [...src.matchAll(re)].map((m) => ({
      name: m[1]!,
      schema: JSON.parse(m[2]!) as Record<string, unknown>,
    }));
  }

  it("never advertises element_index as a YAML kwarg", (t) => {
    if (!doc) return t.skip("dist/spec/actions.md not built");
    // element_index is the live-session (`act`) targeting form. Writing it into
    // a .test.yaml is silently dropped by the transpiler and the step runs with
    // no target — so advertising it here produces tests that validate clean and
    // do the wrong thing. Prose may mention it to explain the rule; schemas
    // must not offer it.
    for (const { name, schema } of schemaBlocks(doc)) {
      const props = (schema.properties ?? {}) as Record<string, unknown>;
      const required = (schema.required ?? []) as string[];
      assert.equal("element_index" in props, false, `${name} exposes element_index`);
      assert.equal(required.includes("element_index"), false, `${name} requires element_index`);
    }
  });

  it("tells the reader how to target every element-targeted action", (t) => {
    if (!doc) return t.skip("dist/spec/actions.md not built");
    // Dropping element_index without saying what replaces it would leave those
    // actions looking like they take no target at all.
    const annotated = [...doc.matchAll(/\*\*Element-targeted\*\*/g)].length;
    assert.ok(annotated > 0, "expected element-targeted actions to be annotated");
    assert.match(doc, /`locator:`/);
  });

  it("parses a plausible number of schema blocks", (t) => {
    if (!doc) return t.skip("dist/spec/actions.md not built");
    // Guards the regexes above from passing vacuously if the format changes.
    assert.ok(schemaBlocks(doc).length > 20, "expected the action blocks to parse");
  });
});

describe("shipped spec documents are MCP-free (002 FR-016 / SC-008)", () => {
  // Documents inside the shiplightai package are read in contexts with no MCP
  // server — CI, a plain terminal, a non-MCP agent — where a `shiplight://`
  // URI resolves to nothing. This regressed once already: the relocated YAML
  // spec kept two `shiplight://schemas/action-entity` deferrals for weeks,
  // pointing authors at the act-only document with the element_index trap.
  const specDir = path.join(process.cwd(), "dist", "spec");

  for (const name of ["yaml.md", "actions.md"]) {
    it(`${name} contains no shiplight:// URI`, (t) => {
      const p = path.join(specDir, name);
      let body: string;
      try {
        body = readFileSync(p, "utf-8");
      } catch {
        return t.skip("dist/spec not built");
      }
      const hits = body.match(/shiplight:\/\/[^\s`)]*/g) ?? [];
      assert.deepEqual(hits, [], `${name} references MCP resources: ${hits.join(", ")}`);
    });
  }
});

describe("runSpec exit codes", () => {
  async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
    const origLog = console.log;
    const origErr = console.error;
    const origWrite = process.stdout.write;
    let out = "", err = "";
    console.log = (...a: unknown[]) => { out += a.join(" ") + "\n"; };
    console.error = (...a: unknown[]) => { err += a.join(" ") + "\n"; };
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      out += String(chunk);
      // Honor the Node write callback: production code may await the flush
      // (create.ts's writeStdoutFlushed does); a mock that drops it would
      // deadlock such a caller.
      const cb = rest.find((a) => typeof a === "function") as
        | ((err?: Error) => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await runSpec(args);
      return { code, out, err };
    } finally {
      console.log = origLog;
      console.error = origErr;
      process.stdout.write = origWrite;
    }
  }

  it("bad topic returns 1 and names the alternatives", async () => {
    const { code, err } = await run(["nope"]);
    assert.equal(code, 1);
    assert.match(err, /yaml, actions/);
  });

  it("missing topic returns 1", async () => {
    const { code } = await run([]);
    assert.equal(code, 1);
  });

  it("--help returns 0 without needing any asset", async () => {
    const { code, out } = await run(["--help"]);
    assert.equal(code, 0);
    assert.match(out, /Usage: shiplight spec/);
  });

  it("yaml topic returns 0 and streams the spec (docs/ fallback guarantees an asset in-repo)", async () => {
    const { code, out } = await run(["yaml"]);
    assert.equal(code, 0);
    assert.match(out, /# YAML Test Language Specification/);
  });
});

describe("source YAML spec doc is boundary-clean (PR-lane guard)", () => {
  // The dist/spec guards above self-skip when dist/ is unbuilt — every PR
  // unit-lane run. This suite reads the SOURCE doc (always present), so the
  // two shipped-once bug classes are caught at review, not at release:
  // dangling shiplight:// URIs and mentions of tools removed from the MCP
  // server. dist/spec/yaml.md is a byte-for-byte copy of this file.
  const srcDoc = readFileSync(
    path.join(process.cwd(), "docs", "YAML-TEST-LANGUAGE-SPEC.md"),
    "utf-8",
  );

  it("contains no shiplight:// URI", () => {
    const hits = srcDoc.match(/shiplight:\/\/[^\s`)]*/g) ?? [];
    assert.deepEqual(hits, []);
  });

  it("references no removed MCP authoring tool", () => {
    for (const gone of ["scaffold_project", "validate_yaml_test", "export_yaml_to_test"]) {
      assert.equal(
        srcDoc.includes(gone),
        false,
        `the shipped YAML spec still names removed tool ${gone}`,
      );
    }
  });

  it("documents extensionActionPopup for code steps and function arguments", () => {
    const codeSection = srcDoc.match(/### 4\.8 Code[\s\S]*?### 4\.9 /)?.[0] ?? "";
    const functionsSection = srcDoc.match(/## 6\. Functions[\s\S]*?## 7\./)?.[0] ?? "";

    assert.match(codeSection, /\| `extensionActionPopup` \|/);
    assert.match(
      functionsSection,
      /\| `page`, `request`, `testContext`, `extensionActionPopup` \|/,
    );
  });
});

describe("tpl-loader wiring stays consistent across lanes", () => {
  // The .tpl text loader must be carried by every lane that imports the
  // scaffold module from SOURCE. dev:run shipped broken once because only
  // test:unit was updated; this pins both. (The tsup builds carry their own
  // loader config and are covered by the build itself.)
  it("dev:run and test:unit both import ./tpl-loader.mjs", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf-8"),
    );
    for (const script of ["dev:run", "test:unit"]) {
      assert.match(
        pkg.scripts[script],
        /--import \.\/tpl-loader\.mjs/,
        `${script} lost the .tpl loader — 'shiplight create' will crash in that lane`,
      );
    }
  });
});
