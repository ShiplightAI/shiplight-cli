/**
 * Render the `shiplight spec` assets into dist/ at build time.
 *
 * Two outputs:
 *   dist/spec/yaml.md    — copy of the normative YAML language spec
 *   dist/spec/actions.md — the action vocabulary, RENDERED from the engine's
 *                          action registry
 *
 * Why build time rather than a runtime import (spec 002 FR-015): the registry
 * lives in sdk-core, and importing it from CLI source pulls the whole
 * registry — with every action's zod schema and description — into `cli.js`.
 * Measured: registry-only action names such as `perform_accurate_operation`
 * are absent from `dist/cli.js` (~226 KB post-move; 219 KB before), so the
 * registry really would be new weight, paid by every `shiplight test` run
 * that never asks for the spec.
 *
 * Rendering here keeps ONE source (the registry) behind TWO renderers — this
 * one and the MCP server's `shiplight://schemas/action-entity` resource. If
 * the two ever disagree, they were built from different engine versions, which
 * is a signal worth surfacing rather than papering over.
 */
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getToolRegistry, ensureToolsRegistered } from "sdk-core";
import { getActionTranspiler } from "../src/yaml-transpiler";
import { toYamlKwargsSchema } from "../src/specRender.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const outDir = resolve(pkgRoot, "dist", "spec");

async function renderActions(): Promise<string> {
  await ensureToolsRegistered();
  const registry = getToolRegistry();
  // Sorted so the output is byte-stable across builds — an unstable ordering
  // would make every rebuild look like a content change in review.
  const allNames = [...registry.getToolNames()].sort();

  // The registry is the shared SOURCE; each renderer applies its own FILTER.
  // Ours is "can the YAML transpiler emit this?" — the MCP server's is "can
  // `act` dispatch this?", which is a different subset. Without this filter
  // the document would list actions such as `perform_accurate_operation` that
  // a `.test.yaml` cannot actually name, which is worse than omitting them:
  // an agent would write a statement that validates and then fails to
  // transpile.
  const names = allNames.filter((n) => getActionTranspiler(n) !== undefined);
  const excluded = allNames.filter((n) => !names.includes(n));

  const lines: string[] = [
    "# Shiplight Actions",
    "",
    "Every action a `.test.yaml` statement can name in its `action:` field, with",
    "its parameters. Generated from the engine's action registry at build time and",
    "filtered to the actions the YAML transpiler can emit, so this list cannot",
    "describe an action the installed version does not support, or omit one it does.",
    "",
    "Fields other than `intent`, `action`, `locator`, and `xpath` are passed to",
    "the action as arguments — see `shiplight spec yaml` for the statement",
    "grammar itself.",
    "",
    "## Targeting an element",
    "",
    "Actions marked **element-targeted** below act on a specific element. In a",
    "`.test.yaml` you address it with `locator:` (preferred) or `xpath:`.",
    "",
    "The engine's own schema for these actions takes an `element_index` instead —",
    "that is the *live session* form, where `act` works against a DOM it has just",
    "inspected and indices are still meaningful. A saved test cannot use it: an",
    "index is meaningless once the page reloads, which is why a locator is what",
    "gets persisted. `element_index` is therefore omitted from the schemas below;",
    "writing it into YAML has no effect (the transpiler ignores it, and the",
    "resulting step runs with no target).",
    "",
    `${names.length} actions.`,
    "",
  ];

  if (excluded.length > 0) {
    // Say what was dropped rather than letting the omission read as "these do
    // not exist". They are real engine actions, reachable through the agent.
    lines.push(
      `> Engine actions with no YAML form (agent-only): ${excluded
        .map((n) => `\`${n}\``)
        .join(", ")}.`,
      "",
    );
  }

  for (const name of names) {
    const tool = registry.get(name);
    if (!tool) continue;
    lines.push(`## ${tool.name}`);
    lines.push("");
    if (tool.description) {
      lines.push(String(tool.description).trim());
      lines.push("");
    }
    if (tool.usesElementIndex) {
      lines.push("**Element-targeted** — address it with `locator:` or `xpath:`.");
      lines.push("");
    }
    lines.push("```json");
    lines.push(
      JSON.stringify(
        toYamlKwargsSchema(
          zodToJsonSchema(tool.schema, { $refStrategy: "none" }),
          Boolean(tool.usesElementIndex),
        ),
        null,
        2,
      ),
    );
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });

  copyFileSync(
    resolve(pkgRoot, "docs", "YAML-TEST-LANGUAGE-SPEC.md"),
    resolve(outDir, "yaml.md"),
  );
  // Deliberately NOT rendered: docs/YAML-TEST-LANGUAGE-SPEC-APPENDIX.md
  // (transpilation internals). No `spec` topic serves it, the spec never
  // references it, and it was never an MCP resource either — shipping it
  // would add tarball weight with no reachable consumer. It stays in docs/
  // for repo readers.
  writeFileSync(resolve(outDir, "actions.md"), await renderActions());

  console.log(`[spec] wrote yaml.md and actions.md to ${outDir}`);
}

main().catch((err) => {
  // Fail the build loudly. A silent skip ships a package whose `spec` commands
  // report "not built" to every user — the same class of failure as the
  // debugger assets silently falling back to placeholder HTML.
  console.error("[spec] failed to render spec assets:", err);
  process.exit(1);
});
