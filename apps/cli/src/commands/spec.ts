/**
 * Spec Command
 *
 * Prints the authoring references that ship inside this package:
 *   shiplight spec yaml     — the normative YAML test language spec
 *   shiplight spec actions  — the action vocabulary and each action's parameters
 *
 * These live here rather than in the MCP server so they are version-locked to
 * the transpiler that enforces them (spec 002 FR-014). A spec distributed on
 * its own cadence can describe syntax the installed parser does not accept;
 * shipping it in the package makes agreement structural instead of a release
 * coordination problem.
 *
 * Both documents are produced by scripts/render-spec-assets.mts at build time
 * into dist/spec/. In a source checkout they are read from docs/ instead, so
 * `dev:run` works without a build — except `actions`, which has no source
 * equivalent because it is rendered from the engine registry.
 */

import { existsSync, readFileSync } from "fs";
import { writeStdoutFlushed } from "../stdoutFlushed.js";
import * as path from "path";
import { fileURLToPath } from "url";

export type SpecTopic = "yaml" | "actions";

const TOPICS: SpecTopic[] = ["yaml", "actions"];

function printUsage(): void {
  console.log(`
Usage: shiplight spec <topic>

Print an authoring reference for the installed version of shiplightai.

Topics:
  yaml       The YAML test language spec — statement types, keys, and grammar
  actions    Every action a statement can name, with its parameters

Options:
  --help, -h  Show this help message

Examples:
  shiplight spec yaml
  shiplight spec actions
  shiplight spec yaml > yaml-spec.md
`);
}

/**
 * Resolve a rendered spec asset.
 *
 * Exported for testing. Returns the first path that exists, or null. The
 * built asset wins over the source doc so a stale checkout never shadows the
 * artifact that actually shipped.
 */
export function resolveSpecAsset(
  topic: SpecTopic,
  moduleDir: string,
): string | null {
  const asset = topic === "yaml" ? "yaml.md" : "actions.md";

  const candidates = [
    // Built + published: moduleDir is dist/, assets sit in dist/spec/.
    path.resolve(moduleDir, "spec", asset),
    // Source checkout via `dev:run`: moduleDir is src/commands/, so the
    // built assets are two levels up in dist/spec/.
    path.resolve(moduleDir, "..", "..", "dist", "spec", asset),
  ];

  if (topic === "yaml") {
    // Only the YAML spec has a source-tree original to fall back to.
    // actions.md is rendered from the engine registry and has none — a
    // missing file there must surface as "run the build", not as silence.
    candidates.push(
      path.resolve(moduleDir, "..", "..", "docs", "YAML-TEST-LANGUAGE-SPEC.md"),
    );
  }

  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Parse argv into a topic, or an error describing what was wrong. */
export function parseSpecArgs(
  argv: string[],
): { topic: SpecTopic } | { error: string } {
  const positional = argv.filter((a) => !a.startsWith("-"));

  if (positional.length === 0) {
    return { error: "missing required <topic> argument" };
  }
  if (positional.length > 1) {
    return { error: `unexpected argument: ${positional[1]}` };
  }

  const topic = positional[0]!;
  if (!TOPICS.includes(topic as SpecTopic)) {
    return {
      error: `unknown topic "${topic}" — expected one of: ${TOPICS.join(", ")}`,
    };
  }
  return { topic: topic as SpecTopic };
}

/** Returns the process exit code; cli.ts translates it into process.exit. */
export async function runSpec(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return 0;
  }

  const parsed = parseSpecArgs(argv);
  if ("error" in parsed) {
    console.error(`Error: ${parsed.error}\n`);
    printUsage();
    return 1;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const assetPath = resolveSpecAsset(parsed.topic, moduleDir);

  if (!assetPath) {
    console.error(
      `Error: the "${parsed.topic}" spec was not found in this installation.\n` +
        `  It is generated during the package build. If you are running from a\n` +
        `  source checkout, run 'pnpm build' in apps/cli first.`,
    );
    return 1;
  }

  // Written straight to stdout so `shiplight spec yaml > spec.md` and piping
  // into a pager both behave — and AWAITED, because cli.ts calls process.exit
  // the moment we return and a piped stdout may still be buffered (the same
  // truncation race create.ts's --json payload guards against).
  await writeStdoutFlushed(readFileSync(assetPath, "utf-8"));
  return 0;
}
