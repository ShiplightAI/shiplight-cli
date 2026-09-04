/**
 * Transpile Command
 *
 * Transpiles YAML test files to Playwright spec files (.yaml.spec.ts).
 * Validates syntax, reports action coverage warnings, and generates
 * runnable test files users can inspect and debug.
 */

import * as path from "path";
import { unlinkSync } from "fs";
import { glob } from "glob";
import { transpileYamlFile } from "../yaml-transpiler";
import { isBelowCoverageThreshold } from "shiplight-types";
import { TRANSPILER_CACHE_KEY } from "../transpiler/version.js";

export interface TranspileArgs {
  pattern: string;
  strict: boolean;
}

/**
 * Split argv into the glob and the flags.
 *
 * Exported for testing: the naive `args[0]` reading silently treats a leading
 * `--strict` as the glob, so `shiplight transpile --strict` would match no
 * files and exit 0 — a strict gate that passes by matching nothing is worse
 * than no gate at all.
 */
export function parseTranspileArgs(args: string[]): TranspileArgs {
  return {
    pattern: args.find((a) => !a.startsWith("--")) || "**/*.test.yaml",
    strict: args.includes("--strict"),
  };
}

/** Returns the process exit code; cli.ts translates it into process.exit. */
export async function runTranspile(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: shiplight transpile [glob] [--strict]");
    console.log("");
    console.log("Transpiles YAML test files to Playwright spec files (.yaml.spec.ts).");
    console.log("Validates syntax and reports action coverage warnings.");
    console.log("Default glob: **/*.test.yaml");
    console.log("");
    console.log("Options:");
    console.log("  --strict    Treat low action coverage as an error instead of a warning.");
    console.log("              Use this when generating tests programmatically: a suite of");
    console.log("              bare drafts transpiles fine but re-detects every element with");
    console.log("              the model at run time, which is slow and non-deterministic.");
    console.log("");
    console.log("Examples:");
    console.log("  shiplight transpile                           # transpile all YAML tests");
    console.log('  shiplight transpile "tests/**/*.test.yaml"    # transpile specific directory');
    console.log("  shiplight transpile tests/login.test.yaml     # transpile a single file");
    console.log("  shiplight transpile --strict                  # fail on unenriched drafts");
    return 0;
  }

  const { pattern, strict } = parseTranspileArgs(args);
  const cwd = process.cwd();

  const files = await glob(pattern, {
    cwd,
    ignore: ["node_modules/**", "*.yaml.spec.ts"],
  });

  if (files.length === 0) {
    if (strict) {
      // A strict gate that "passes" because its glob matched nothing is worse
      // than no gate at all — CI would go green on a typo'd path while zero
      // files were actually validated.
      console.error(`Error: --strict requires at least one matching file; nothing matched: ${pattern}`);
      return 1;
    }
    console.log(`No files matched: ${pattern}`);
    return 0;
  }

  let errorCount = 0;
  let warningCount = 0;
  let transpiled = 0;

  for (const file of files.sort()) {
    const yamlPath = path.resolve(cwd, file);
    const result = transpileYamlFile(yamlPath, { version: TRANSPILER_CACHE_KEY, basePath: cwd });

    if (!result.valid) {
      errorCount++;
      console.log(`\n✗ ${file}`);
      for (const err of result.errors) {
        console.log(`  ERROR: ${err}`);
      }
      continue;
    }

    // specFile is always set when valid === true
    const outName = path.basename(result.specFile!);

    // Strict mode changes the VERDICT on low coverage, never the measurement:
    // the figures below come from the same `stats` that produced the warning.
    // Decide from stats rather than `warnings.length` so an unrelated future
    // warning is not mislabelled as a coverage failure.
    const s = result.stats;
    const coverageShortfall = strict && s !== undefined && isBelowCoverageThreshold(s);

    if (coverageShortfall && s) {
      // Counted as an error, not as transpiled — one file, one bucket.
      errorCount++;
      // The shared pipeline wrote the .yaml.spec.ts before we could gate it.
      // Remove it: the nonzero exit stops CI, but a developer running
      // `shiplight test` right after a failed --strict would otherwise
      // silently execute the under-enriched spec (or a stale earlier one).
      try {
        unlinkSync(result.specFile!);
      } catch {
        // Best-effort: a vanished file changes nothing about the verdict.
      }
      console.log(`\n✗ ${file} → ${outName}`);
      console.log(
        `  ERROR: insufficient action coverage — ${s.action}/${s.total} statements (${s.coverage}%) are enriched with action/js; ${s.draft} draft(s) remain.`
      );
      console.log(
        `  Walk the flow in a browser (MCP: new_session → inspect_page → act → get_locators), then embed the captured locator/xpath into each draft statement.`
      );
      continue;
    }

    transpiled++;

    if (result.warnings.length > 0) {
      warningCount++;
      console.log(`⚠ ${file} → ${outName}`);
      for (const warn of result.warnings) {
        console.log(`  WARNING: ${warn}`);
      }
    } else {
      console.log(`✓ ${file} → ${outName}`);
    }
  }

  console.log(`\n${files.length} file(s): ${transpiled} transpiled, ${errorCount} error(s), ${warningCount} warning(s)`);

  return errorCount > 0 ? 1 : 0;
}
