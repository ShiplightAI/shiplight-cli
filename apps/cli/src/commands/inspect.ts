/**
 * Inspect Command
 *
 * Parses a YAML test file and outputs the resulting TestFlow JSON.
 * Useful for verifying YAML → JSON conversion, especially for suites
 * with testGroup.
 */

import * as fs from "fs";
import * as path from "path";
import { yamlToTestFlow, extractYamlMetadata } from "shiplight-types";
import type { TestFlow, Statement, Step } from "shiplight-types";

export async function runInspect(args: string[]) {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    console.log("Usage: shiplight inspect <file.test.yaml> [options]");
    console.log("");
    console.log("Parse a YAML test file and output the resulting TestFlow JSON.");
    console.log("Useful for verifying YAML → JSON conversion.");
    console.log("");
    console.log("Options:");
    console.log("  --pretty       Pretty-print JSON (default)");
    console.log("  --compact      Compact JSON output");
    console.log("  --stats        Show statement statistics only");
    console.log("");
    console.log("Examples:");
    console.log("  shiplight inspect tests/login.test.yaml");
    console.log("  shiplight inspect tests/suite.test.yaml --stats");
    console.log("  shiplight inspect tests/login.test.yaml --compact | jq .");
    process.exit(args.length === 0 ? 1 : 0);
  }

  const compact = args.includes("--compact");
  const statsOnly = args.includes("--stats");
  const filePath = args.find((a) => !a.startsWith("--"));

  if (!filePath) {
    console.error("Error: no file specified");
    process.exit(1);
  }

  const resolved = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(resolved)) {
    console.error(`Error: file not found: ${resolved}`);
    process.exit(1);
  }

  const yamlString = fs.readFileSync(resolved, "utf-8");

  try {
    const metadata = extractYamlMetadata(yamlString);
    const testFlow: TestFlow = yamlToTestFlow(yamlString);

    if (statsOnly) {
      printStats(testFlow, metadata);
    } else {
      const output = {
        ...(metadata.test_case_id !== undefined
          ? { test_case_id: metadata.test_case_id }
          : {}),
        ...(metadata.name ? { name: metadata.name } : {}),
        testFlow,
      };
      console.log(JSON.stringify(output, null, compact ? 0 : 2));
    }
  } catch (error: any) {
    console.error(`Error parsing ${filePath}: ${error.message}`);
    process.exit(1);
  }
}

function printStats(
  testFlow: TestFlow,
  metadata: { test_case_id?: number; name?: string },
) {
  console.log(`File: ${metadata.name || "(unnamed)"}`);
  if (metadata.test_case_id !== undefined) {
    console.log(`Cloud ID: ${metadata.test_case_id}`);
  }
  console.log(`Version: ${testFlow.version || "unknown"}`);

  if (testFlow.testGroup) {
    const group = testFlow.testGroup;
    console.log(`Type: suite (testGroup)`);
    console.log(`Tests: ${group.tests.length}`);
    for (const test of group.tests) {
      const skip = test.skip ? ` [SKIP${typeof test.skip === "string" ? `: ${test.skip}` : ""}]` : "";
      console.log(
        `  - ${test.name}: ${test.statements.length} statements${test.teardown ? `, ${test.teardown.length} teardown` : ""}${skip}`
      );
    }
    if (group.beforeAll?.length) console.log(`Hooks: beforeAll (${group.beforeAll.length})`);
    if (group.afterAll?.length) console.log(`Hooks: afterAll (${group.afterAll.length})`);
    if (group.beforeEach?.length) console.log(`Hooks: beforeEach (${group.beforeEach.length})`);
    if (group.afterEach?.length) console.log(`Hooks: afterEach (${group.afterEach.length})`);
  } else {
    console.log(`Type: single test`);
    console.log(`Goal: ${testFlow.goal}`);
    if (testFlow.url) console.log(`URL: ${testFlow.url}`);
    if (testFlow.baseURL) console.log(`Base URL: ${testFlow.baseURL}`);
    console.log(`Statements: ${testFlow.statements?.length ?? 0}`);
    if (testFlow.teardown?.length) console.log(`Teardown: ${testFlow.teardown.length}`);

    const stats = countStatements(testFlow.statements ?? []);
    console.log(`  DRAFT: ${stats.drafts}, ACTION: ${stats.actions}, STEP: ${stats.steps}`);
  }
}

function countStatements(stmts: Statement[]): {
  drafts: number;
  actions: number;
  steps: number;
} {
  const stats = { drafts: 0, actions: 0, steps: 0 };
  for (const stmt of stmts) {
    if (stmt.type === "DRAFT") stats.drafts++;
    else if (stmt.type === "ACTION") stats.actions++;
    else if (stmt.type === "STEP") {
      stats.steps++;
      const nested = countStatements((stmt as Step).statements ?? []);
      stats.drafts += nested.drafts;
      stats.actions += nested.actions;
      stats.steps += nested.steps;
    }
  }
  return stats;
}
