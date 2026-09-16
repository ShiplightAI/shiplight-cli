import * as path from "path";
import {
  scaffoldProject,
  hasMeaningfulPreExistingEntries,
  resolveEnvSetupState,
  type EnvSetupState,
  type MergeStrategy,
  type ScaffoldResult,
} from "../scaffold/index.js";
import { resolveCliVersion } from "../cliVersion.js";
import { writeStdoutFlushed } from "../stdoutFlushed.js";

/**
 * Human-facing next-step line for each env state.
 *
 * The renderer owns the wording only — `resolveEnvSetupState` owns which
 * branch we are in, so the JSON payload and this prose can never disagree
 * about whether it is safe to `cp` over an existing `.env`.
 *
 * Credential ordering mirrors the scaffolded `.env.example`
 * (src/scaffold/templates/env.example.tpl): `SHIPLIGHT_API_TOKEN` first
 * (obtained via `npx shiplight setup-api-token`; routes AI calls through the Shiplight
 * LLM proxy), then a provider key as the alternative (BYOK — bypasses the
 * proxy, see dotenvSource.ts). Both maps below MUST present both paths; an
 * instruction that names only provider keys contradicts the template it sits
 * next to and silently steers every new project onto BYOK.
 */
export const ENV_STEP_PROSE: Record<EnvSetupState, string> = {
  merge_example_then_diff:
    "# .env AND .env.example both exist: merge .env.example first, then add any newly-required keys to your .env — credentials are SHIPLIGHT_API_TOKEN (run: npx shiplight setup-api-token) or an AI provider key (GOOGLE_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY); do NOT cp over your existing .env",
  diff_fresh_example:
    "# A fresh .env.example was just written next to your existing .env — diff them and add any new required keys; credentials are SHIPLIGHT_API_TOKEN (run: npx shiplight setup-api-token) or an AI provider key (e.g. GOOGLE_API_KEY); do NOT overwrite",
  review_existing_env:
    "# .env already exists — review it and ensure credentials are set: SHIPLIGHT_API_TOKEN (run: npx shiplight setup-api-token) or an AI provider key (GOOGLE_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY); do NOT overwrite",
  copy_example_after_merge:
    "# AFTER merging .env.example above, run: cp .env.example .env, then: npx shiplight setup-api-token  (or set an AI provider key like GOOGLE_API_KEY)",
  copy_example:
    "cp .env.example .env      # then run: npx shiplight setup-api-token  (or set an AI provider key like GOOGLE_API_KEY in .env)",
};

/**
 * Agent-facing instruction for each env state.
 *
 * Same decision, different audience: an agent needs an imperative it can act
 * on, not a shell comment to paste. Keep each state's credential guidance in
 * lockstep with ENV_STEP_PROSE above — same two paths, same order.
 */
export const ENV_STEP_INSTRUCTION: Record<EnvSetupState, string> = {
  merge_example_then_diff:
    "An existing .env was found AND .env.example is being merged: review your .env against the merged .env.example for any newly-required keys, and ensure credentials are present — either SHIPLIGHT_API_TOKEN (run 'npx shiplight setup-api-token'; it writes the token to .env) or an AI provider key such as GOOGLE_API_KEY or ANTHROPIC_API_KEY. Do NOT overwrite the existing .env with cp.",
  diff_fresh_example:
    "An existing .env was found AND a fresh .env.example was just written: diff your .env against the new .env.example to spot any newly-required keys, and ensure credentials are present — either SHIPLIGHT_API_TOKEN (run 'npx shiplight setup-api-token') or an AI provider key such as GOOGLE_API_KEY or ANTHROPIC_API_KEY. Do NOT overwrite the existing .env.",
  review_existing_env:
    ".env already exists — review it and ensure credentials are set: either SHIPLIGHT_API_TOKEN (run 'npx shiplight setup-api-token'; it writes the token to .env) or at least one AI provider key like GOOGLE_API_KEY or ANTHROPIC_API_KEY. Do NOT overwrite.",
  copy_example_after_merge:
    "AFTER the .env.example merge has been applied: copy .env.example to .env, then set credentials — either run 'npx shiplight setup-api-token' to write SHIPLIGHT_API_TOKEN into .env, or set at least one AI provider key such as GOOGLE_API_KEY or ANTHROPIC_API_KEY.",
  copy_example:
    "Copy .env.example to .env, then set credentials — either run 'npx shiplight setup-api-token' to write SHIPLIGHT_API_TOKEN into .env, or set at least one AI provider key such as GOOGLE_API_KEY or ANTHROPIC_API_KEY.",
};

/** One conflicted file in the `--json` payload. Wire names are snake_case. */
export interface CreateJsonMergeEntry {
  path: string;
  abs_path: string;
  merge_strategy: MergeStrategy;
  template: string;
  instructions: string;
  human_summary: string;
  merge_key?: string;
  lines_to_ensure?: string[];
}

/**
 * The `--json` payload — the agent-facing scaffolding contract that replaced
 * the MCP `scaffold_project` tool (spec 002 FR-019). Declared as a type so a
 * renamed or dropped field is a compile error, not a silent wire change; it
 * MUST stay non-lossy relative to the human output.
 */
export interface CreateJsonPayload {
  project_path: string;
  project_name: string;
  original_project_name: string;
  name_was_normalized: boolean;
  into_existing_repo: boolean;
  files_created: string[];
  files_skipped: string[];
  files_needing_agent_merge: CreateJsonMergeEntry[];
  env_setup_state: EnvSetupState;
  env_setup_instruction: string;
}

export function buildCreateJsonPayload(result: ScaffoldResult): CreateJsonPayload {
  const envSetupState = resolveEnvSetupState(result);
  return {
    project_path: result.projectPath,
    project_name: result.projectName,
    original_project_name: result.originalProjectName,
    name_was_normalized: result.projectName !== result.originalProjectName,
    into_existing_repo: hasMeaningfulPreExistingEntries(
      result.preExistingTopLevelEntries,
    ),
    files_created: result.filesCreated,
    files_skipped: result.filesSkipped,
    files_needing_agent_merge: result.filesNeedingAgentMerge.map((f) => ({
      path: f.path,
      abs_path: f.absPath,
      merge_strategy: f.mergeStrategy,
      template: f.template,
      instructions: f.instructions,
      human_summary: f.humanSummary,
      ...(f.mergeKey !== undefined ? { merge_key: f.mergeKey } : {}),
      ...(f.linesToEnsure !== undefined
        ? { lines_to_ensure: f.linesToEnsure }
        : {}),
    })),
    env_setup_state: envSetupState,
    env_setup_instruction: ENV_STEP_INSTRUCTION[envSetupState],
  };
}

function shellQuote(p: string): string {
  // POSIX shells: wrap in single quotes and escape any embedded single quote
  // by closing, escaping, and reopening (foo'bar → 'foo'\''bar'). If the
  // string is "safe" (alphanumerics and a small set of harmless chars),
  // print it raw for readability.
  if (/^[A-Za-z0-9_./~+-]+$/.test(p)) return p;
  return `'${p.replace(/'/g, "'\\''")}'`;
}

function printUsage(): void {
  console.log(`
Usage: shiplight create <path> [options]

Scaffold a Shiplight test project at <path>. Writes package.json,
playwright.config.ts, .gitignore, .env.example, .mcp.json, and an example
auth helper and test. Safe to run against an existing repo — files
that already exist are reported as conflicts for you to merge manually
rather than overwritten.

Options:
  --name <name>    Override the package.json "name" field (default: directory basename)
  --json           Emit the result as a single JSON object on stdout instead of
                   prose. Includes, for every file left untouched, the template
                   content and a merge strategy — enough for a coding agent to
                   apply the merges itself.
  --help, -h       Show this help message

Examples:
  shiplight create ./my-tests
  shiplight create ./my-tests --name acme-e2e
  shiplight create .                # scaffold into the current repo
  shiplight create . --json         # machine-readable output for an agent
`);
}

/**
 * Emit a parse/validation failure. In --json mode an agent is reading stdout,
 * so the failure must be a parseable object there — empty stdout plus a
 * message on stderr makes the caller's JSON.parse throw with no diagnostic.
 * (Found in review: the --name validation path previously exited with empty
 * stdout even under --json, unlike the scaffold-throw path.)
 */
async function emitCreateError(msg: string, json: boolean, usage = false): Promise<void> {
  if (json) await writeStdoutFlushed(JSON.stringify({ error: msg }, null, 2) + "\n");
  console.error(`Error: ${msg}`);
  if (usage && !json) printUsage();
}

/** Returns the process exit code; cli.ts translates it into process.exit. */
export async function runCreate(argv: string[]): Promise<number> {
  let projectPath: string | undefined;
  let projectName: string | undefined;
  // Pre-scan so validation failures on other flags know the output mode
  // regardless of argument order (`--name X --json` vs `--json --name X`).
  const json = argv.includes("--json");

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      printUsage();
      return 0;
    } else if (arg === "--json") {
      // handled by the pre-scan
    } else if (arg === "--name") {
      projectName = argv[++i];
      if (!projectName || !projectName.trim()) {
        await emitCreateError("--name requires a non-empty value", json);
        return 1;
      }
      // Basic npm package-name validation: lowercase alphanumerics,
      // hyphens, underscores, and dots only; must not start with a dot
      // or underscore, and consecutive dots are rejected (npm refuses
      // them for their path-traversal semantics). Intentionally looser
      // than the full npm spec otherwise — enough to catch the obvious
      // mistakes without getting into scoped-name or length edge cases.
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(projectName) || projectName.includes("..")) {
        await emitCreateError(
          `--name "${projectName}" is not a valid package name.\n` +
            `  npm package names must be lowercase.\n` +
            `  Use only lowercase letters, digits, hyphens, underscores, and dots;\n` +
            `  must start with a lowercase letter or digit.`,
          json,
        );
        return 1;
      }
    } else if (arg.startsWith("--")) {
      await emitCreateError(`Unknown option: ${arg}`, json, true);
      return 1;
    } else if (!projectPath) {
      projectPath = arg;
    } else {
      await emitCreateError(`Unexpected argument: ${arg}`, json, true);
      return 1;
    }
  }

  if (!projectPath) {
    await emitCreateError("missing required <path> argument", json, true);
    return 1;
  }

  const absPath = path.resolve(projectPath);

  // R3-7: warn early if the user is on a Node older than Shiplight requires.
  // The scaffolded package.json stamps engines.node>=22, but npm defaults to
  // engine-strict=false — without this warning the user gets a clean install
  // and cryptic runtime failures later.
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (Number.isFinite(nodeMajor) && nodeMajor < 22) {
    console.warn(
      `Warning: you are on Node ${process.versions.node}. Shiplight requires Node 22 or newer; tests will fail at runtime on older versions.`
    );
  }

  let result;
  try {
    // The scaffolded package.json pins `^<this version>` rather than the
    // dist-tag `latest`. `latest` reads as self-updating but is resolved once
    // at install time, so a project can sit on a stale CLI while everyone who
    // opens the file assumes otherwise.
    result = scaffoldProject({
      projectPath: absPath,
      projectName,
      shiplightVersion: resolveCliVersion(),
    });
  } catch (err) {
    // scaffoldProject throws a clean Error when the target path is not a
    // directory (e.g. user typo'd `shiplight create ./README.md`) or a parent
    // path conflicts with a non-directory. Surface the message, hide the
    // stack — the message is intentionally user-friendly. Defensive
    // coercion for non-Error throws (a string, null, etc.) prevents an
    // "Error: undefined" final line.
    const msg = err instanceof Error ? err.message : String(err);
    await emitCreateError(msg, json);
    return 1;
  }

  if (json) {
    // Everything else this command prints goes to stderr (warnings) or is
    // suppressed here, so stdout stays a single parseable object — flushed
    // before return, because cli.ts exits immediately after.
    await writeStdoutFlushed(JSON.stringify(buildCreateJsonPayload(result), null, 2) + "\n");
    return 0;
  }

  // R3-10 + R4-11 + R6-4: filter "noise" entries that don't meaningfully
  // indicate a populated project (`.git/`, `.husky/`, `.DS_Store`, stale
  // `node_modules/`, …). The noise set lives in scaffold.ts so the CLI and
  // a future MCP-side "existing repo" UX share one source of truth.
  const intoExistingRepo = hasMeaningfulPreExistingEntries(
    result.preExistingTopLevelEntries,
  );

  // R3-9: surface name rewrites (e.g. derived basename was a Node core
  // module name, or `--name` was lowercase-normalized) so the user can
  // override with `--name` if they didn't want the rewrite.
  if (
    result.projectName !== result.originalProjectName &&
    result.originalProjectName.trim().length > 0
  ) {
    console.warn(
      `Note: project name '${result.originalProjectName}' was normalized to '${result.projectName}'. ` +
        `Override with --name <name> if you want a different value.`
    );
  }
  const headerVerb = intoExistingRepo
    ? "Added Shiplight files to existing project at"
    : "Scaffolded Shiplight test project at";
  console.log(`\n${headerVerb} ${result.projectPath}\n`);
  console.log(`  Name: ${result.projectName}`);

  if (result.filesCreated.length > 0) {
    console.log(`\n  Files created:`);
    for (const f of result.filesCreated) {
      console.log(`    + ${f}`);
    }
  }

  if (result.filesSkipped.length > 0) {
    console.log(`\n  Files skipped (already exist, no action needed):`);
    for (const f of result.filesSkipped) {
      console.log(`    = ${f}`);
    }
  }

  if (result.filesNeedingAgentMerge.length > 0) {
    // Same shell-quoted path the "cd" line below uses — the hint must paste
    // cleanly even for paths with spaces.
    const jsonHintPath = shellQuote(
      path.relative(process.cwd(), result.projectPath) || "."
    );
    console.log(
      `\n  Files that already exist — left alone (you need to merge them):`
    );
    for (const f of result.filesNeedingAgentMerge) {
      console.log(`    ! ${f.path}`);
      console.log(`        ${f.humanSummary}`);
    }
    console.log(
      `\n  Open each file and apply the change yourself, or let your coding\n` +
        `  agent do it: \`shiplight create ${jsonHintPath} --json\` returns the full\n` +
        `  template content + per-file merge_strategy for each conflict.`
    );
  }

  // Which env branch we are in is decided once, in scaffold.ts, and shared
  // with the --json renderer; only the wording lives here. See the note on
  // resolveEnvSetupState for why this decision must not be re-derived.
  const envStep = ENV_STEP_PROSE[resolveEnvSetupState(result)];

  const cdTarget = shellQuote(
    path.relative(process.cwd(), result.projectPath) || "."
  );
  const mergeHint =
    result.filesNeedingAgentMerge.length > 0
      ? "\n  # resolve the merge-required files listed above first"
      : "";
  console.log(`
Next steps:

  cd ${cdTarget}${mergeHint}
  ${envStep}
  npm install
  npx playwright install chromium
  npx shiplight test
`);
  return 0;
}
