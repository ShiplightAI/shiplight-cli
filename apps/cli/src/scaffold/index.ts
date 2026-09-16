/**
 * Scaffold logic for a new Shiplight test project.
 *
 * Backs `shiplight create` in both its renderings — human prose and the
 * agent-facing `--json` payload. It used to be shared with an MCP
 * `scaffold_project` tool; that tool was removed so test authoring ships and
 * versions with the parser that runs it (spec 003 FR-012).
 *
 * Design: this function does the easy half of the job — writing files that
 * don't yet exist — and defers the hard half (merging into files the user
 * already owns: package.json, .gitignore, .mcp.json, ...) to the coding
 * agent that called the MCP tool. The TS layer detects collisions per-file
 * and returns a structured `filesNeedingAgentMerge` payload with the full
 * template content plus a strategy + natural-language instructions for each
 * conflict. The agent then reads each existing file with its own tools and
 * applies the merge, which preserves comments / formatting / field ordering
 * far better than a generic JSON or text merger written in TS.
 */
import * as fs from "fs";
import * as path from "path";
import { builtinModules } from "node:module";

import packageJsonTpl from "./templates/package.json.tpl";
import playwrightConfigTpl from "./templates/playwright.config.tpl";
import gitignoreTpl from "./templates/gitignore.tpl";
import envExampleTpl from "./templates/env.example.tpl";
import mcpJsonTpl from "./templates/.mcp.json.tpl";

import exampleLoginTpl from "./templates/auth/example.login.ts.tpl";
import exampleTestTpl from "./templates/tests/example.test.yaml.tpl";

export interface ScaffoldOptions {
  /** Path where the project should be created. Relative paths are resolved against process.cwd(). */
  projectPath: string;
  /** package.json "name" field. Defaults to basename(projectPath). */
  projectName?: string;
  /**
   * Exact version of `shiplightai` doing the scaffolding, e.g. "0.1.93".
   * Written into the scaffolded package.json as a caret range (`^0.1.93`).
   *
   * Required, and deliberately has no default. The template previously
   * hardcoded `"latest"`, which reads as self-updating to everyone who opens
   * the file but is really a dist-tag resolved once at install time — so a
   * project could sit on a months-old CLI while every reader assumed it was
   * current. A hardcoded `^0.1.0` in the template would be worse: caret is
   * minor-locked below 1.0.0, so every new scaffold would silently pin to the
   * 0.1.x line forever once 0.2.0 shipped.
   *
   * The only correct value is the version of the tool actually running, which
   * this module cannot know — hence a required parameter rather than a
   * fallback. A fallback is just the bug with an extra step.
   */
  shiplightVersion: string;
}

/**
 * Convert an exact version into the dependency range written to package.json.
 *
 * Caret, so `npm update` stays bounded and predictable rather than crossing a
 * major without complaint. The range policy lives here, in one place, so
 * callers only have to report a fact ("I am version X") and cannot each invent
 * their own pinning scheme.
 */
export function toDependencyRange(version: string): string {
  const trimmed = version.trim();
  // Semver core plus optional prerelease/build. Rejects "latest", "dev", "",
  // and anything else that would produce an uninstallable package.json —
  // failing loudly at scaffold time beats shipping `"shiplightai": "^dev"`
  // and letting the user discover it at `npm install`.
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(trimmed)) {
    throw new Error(
      `Cannot scaffold: "${version}" is not an exact semver version. ` +
        `Pass the running shiplightai version (e.g. "0.1.93") so the scaffolded ` +
        `package.json pins a real range instead of a floating dist-tag.`,
    );
  }
  return `^${trimmed}`;
}

export type MergeStrategy =
  | "json_merge_deps_and_scripts"
  | "append_missing_lines"
  | "json_merge_under_key"
  | "append_missing_env_keys"
  | "review_and_decide";

const MUST_APPLY_STRATEGIES: ReadonlySet<MergeStrategy> = new Set([
  "json_merge_deps_and_scripts",
  "append_missing_lines",
  "json_merge_under_key",
  "append_missing_env_keys",
]);

export function isMustApplyStrategy(s: MergeStrategy): boolean {
  return MUST_APPLY_STRATEGIES.has(s);
}

export interface FileMergeRequest {
  path: string;
  absPath: string;
  mergeStrategy: MergeStrategy;
  template: string;
  instructions: string;
  /** Short, human-readable one-liner (no agent verbs) for CLI display. */
  humanSummary: string;
  mergeKey?: string;
  linesToEnsure?: string[];
}

export interface ScaffoldResult {
  projectPath: string;
  projectName: string;
  /** The pre-sanitization name the caller (or path.basename fallback) supplied. Useful for "we rewrote your name" warnings. */
  originalProjectName: string;
  filesCreated: string[];
  filesSkipped: string[];
  filesNeedingAgentMerge: FileMergeRequest[];
  /** Entries (basename, top level) that existed inside projectPath BEFORE scaffold wrote anything. Drives "scaffolded into existing repo" UX. */
  preExistingTopLevelEntries: string[];
}

type SkipPlan = {
  kind: "skip";
  relPath: string;
  content: string;
};

type AgentMergePlan = {
  kind: "agent_merge";
  relPath: string;
  content: string;
  /** Force the plan to be surfaced as a merge entry even when no file exists at relPath. */
  forceMerge?: boolean;
  merge: {
    strategy: MergeStrategy;
    instructions: string;
    humanSummary: string;
    mergeKey?: string;
    linesToEnsure?: string[];
  };
};

type FilePlan = SkipPlan | AgentMergePlan;

type PathState = "absent" | "directory" | "non-directory" | "broken-symlink" | "inaccessible";

function classifyPath(p: string): PathState {
  let lstat: fs.Stats;
  try {
    lstat = fs.lstatSync(p);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "absent";
    return "inaccessible";
  }
  if (lstat.isSymbolicLink()) {
    try {
      const target = fs.statSync(p);
      return target.isDirectory() ? "directory" : "non-directory";
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return "broken-symlink";
      return "inaccessible";
    }
  }
  return lstat.isDirectory() ? "directory" : "non-directory";
}

/**
 * Does any FS entry exist at this path? — uses lstat so dangling symlinks
 * count. Returns true ONLY for states where there's a usable on-disk entry
 * (real file/dir, or symlink that follows to one). Broken symlinks and
 * inaccessible entries are handled separately via `assertNoUnsafeLeafEntry`
 * so they never silently route through the collision-skip path.
 */
function pathEntryExists(p: string): boolean {
  const state = classifyPath(p);
  return state === "directory" || state === "non-directory";
}

/**
 * Resolve a path's real (symlink-followed) location. Unlike fs.realpathSync,
 * this NEVER silently swallows errors — callers that need a fail-closed
 * containment check must see the failure rather than fall back to a lexical
 * comparison (the silent fallback re-opened R3-2's directory-symlink escape).
 */
function safeRealpath(p: string, context: string): string {
  try {
    return fs.realpathSync(p);
  } catch (err) {
    throw new Error(
      `Cannot scaffold: failed to resolve real path of ${p} (${context}): ${(err as Error).message}. ` +
        `This is required for the project-root containment check that prevents writes outside the project.`,
    );
  }
}

/**
 * npm-rejected package names. Combines:
 *   - npm's explicit blacklist (validate-npm-package-name): node_modules, favicon.ico
 *   - npm's "looks like a Node ecosystem name": node, npm, js
 *   - the runtime-current builtinModules list (fs, path, os, crypto, ...)
 *   - explicit additions for names some Node versions include only with the
 *     `node:` prefix (test, sea) but that npm still rejects.
 */
const NPM_RESERVED_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  "favicon.ico",
  "node",
  "npm",
  "js",
  "test",
  "sea",
  ...builtinModules,
]);

/** npm's hard upper bound on `name` length. */
const NPM_MAX_NAME_LENGTH = 214;

function sanitizeProjectName(raw: string): { name: string; original: string } {
  const FALLBACK = "shiplight-test-project";
  const trimmed = raw.trim();
  if (!trimmed) return { name: FALLBACK, original: raw };
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[-_.]+$/, "");
  if (!normalized) return { name: FALLBACK, original: raw };
  if (NPM_RESERVED_NAMES.has(normalized)) return { name: FALLBACK, original: raw };
  if (normalized.length > NPM_MAX_NAME_LENGTH) return { name: FALLBACK, original: raw };
  return { name: normalized, original: raw };
}

function assertTargetIsDirOrAbsent(target: string): void {
  const state = classifyPath(target);
  if (state === "absent" || state === "directory") return;
  if (state === "broken-symlink") {
    throw new Error(
      `Cannot scaffold into ${target}: path is a broken symlink. Remove or fix the link before scaffolding.`,
    );
  }
  if (state === "inaccessible") {
    throw new Error(
      `Cannot scaffold into ${target}: cannot stat path (permission denied or other I/O error).`,
    );
  }
  throw new Error(
    `Cannot scaffold into ${target}: path exists and is not a directory.`,
  );
}

type PackageJsonType = "module" | "commonjs" | "unknown" | "absent";

const MAX_PACKAGE_JSON_BYTES = 1_048_576; // 1 MiB

function readExistingPackageJsonType(projectPath: string): PackageJsonType {
  const p = path.join(projectPath, "package.json");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "absent";
    return "unknown";
  }
  // Only read regular files. FIFOs, sockets, devices, and directories all
  // pass statSync but would either block (FIFO) or yield meaningless content.
  if (!stat.isFile()) return "unknown";
  if (stat.size > MAX_PACKAGE_JSON_BYTES) return "unknown";

  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf-8");
  } catch {
    return "unknown";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "unknown";
  }

  if (Array.isArray(parsed)) return "unknown";
  if (!parsed || typeof parsed !== "object") return "unknown";
  const obj = parsed as { type?: unknown };
  if (obj.type === "module") return "module";
  if (obj.type === "commonjs") return "commonjs";
  // No `type` field, or an unrecognized value. Critically, we return
  // "unknown" rather than defaulting to "commonjs" — Node treats a missing
  // `type` as CJS, but most existing repos that lack the field are happy
  // to use ESM. The playwright-defer path only fires on EXPLICIT
  // commonjs (see playwrightShouldDeferForCjs below).
  return "unknown";
}

const PLAYWRIGHT_CONFIG_VARIANTS = [
  "playwright.config.ts",
  "playwright.config.js",
  "playwright.config.mjs",
  "playwright.config.cjs",
];

/**
 * Top-level entries that don't meaningfully indicate "this is an existing
 * project" — a freshly-`git init`-ed dir contains only `.git/`; husky drops
 * a `.husky/`; macOS Finder leaves `.DS_Store`; a stale install leaves
 * `node_modules/` or `.next/`. Callers that surface "scaffolded fresh" vs
 * "added to existing project" UX should filter these from
 * `result.preExistingTopLevelEntries` before deciding.
 *
 * Exported from this module (rather than inlined per-call-site) so the CLI
 * and the MCP wrapper share one source of truth — see R6-4 in the round-6
 * code review for the drift hazard that motivated this.
 */
export const INTO_EXISTING_REPO_NOISE: ReadonlySet<string> = new Set([
  ".git",
  ".gitkeep",
  ".DS_Store",
  "Thumbs.db",
  ".idea",
  ".vscode",
  ".husky",
  "node_modules",
  ".next",
  ".turbo",
  ".cache",
  ".pnpm-store",
]);

/** True when projectPath had meaningful (non-noise) entries before scaffold ran. */
export function hasMeaningfulPreExistingEntries(entries: readonly string[]): boolean {
  return entries.some((entry) => !INTO_EXISTING_REPO_NOISE.has(entry));
}

/**
 * What the caller must tell the user to do about `.env`.
 *
 * The four inputs (does `.env` already exist, is `.env.example` pending a
 * merge, was `.env.example` just written) combine into five distinct
 * outcomes, and getting one wrong means telling somebody to `cp` over the
 * `.env` that holds their API keys.
 *
 * This lives here, next to the scaffold result it is derived from, because
 * the decision was previously duplicated verbatim in two renderers that
 * could — and did — drift. Renderers own the WORDING; they do not own the
 * DECISION. Same rule as `hasMeaningfulPreExistingEntries` and
 * `isMustApplyStrategy`.
 */
export type EnvSetupState =
  /** `.env` exists and `.env.example` is still pending a merge — merge first, then diff. Never `cp`. */
  | "merge_example_then_diff"
  /** `.env` exists and a fresh `.env.example` was just written — diff for newly required keys. Never `cp`. */
  | "diff_fresh_example"
  /** `.env` exists and `.env.example` did not change — just confirm a provider key is set. Never `cp`. */
  | "review_existing_env"
  /** No `.env`, but `.env.example` needs merging first — `cp` only after that. */
  | "copy_example_after_merge"
  /** No `.env` and `.env.example` is ready — `cp` it now. */
  | "copy_example";

export function resolveEnvSetupState(result: ScaffoldResult): EnvSetupState {
  // Uses the PRE-scaffold snapshot, not a post-scaffold existsSync: if scaffold
  // ever starts writing a fresh `.env` itself, an existsSync here would flip to
  // "exists" and start telling users not to copy a file they never had.
  const envExists = result.preExistingTopLevelEntries.includes(".env");
  const exampleNeedsMerge = result.filesNeedingAgentMerge.some(
    (f) => f.path === ".env.example",
  );
  const exampleNewlyCreated = result.filesCreated.includes(".env.example");

  if (envExists && exampleNeedsMerge) return "merge_example_then_diff";
  if (envExists && exampleNewlyCreated) return "diff_fresh_example";
  if (envExists) return "review_existing_env";
  if (exampleNeedsMerge) return "copy_example_after_merge";
  return "copy_example";
}

/** True if `child` is the same as, or nested below, `parent` after symlink resolution. */
function isPathContained(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === "") return true;
  if (rel === "..") return false;
  if (rel.startsWith(".." + path.sep)) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

/**
 * Throw if `leaf` exists in a state that would make scaffold misbehave.
 *
 * - For agent_merge plans the leaf becomes a `FileMergeRequest.abs_path` the
 *   agent will Read and Edit. If the entry is a DIRECTORY, a broken symlink,
 *   or an external-symlinked file, the agent gets a confusing error (EISDIR /
 *   ENOENT) or — worse — writes escape the project root via the symlink.
 *
 * - For skip plans nothing is ever written when the file exists, so the
 *   external-symlink containment check would be over-strict. Skip plans only
 *   reject states that would still misbehave downstream (broken-symlink and
 *   inaccessible) — see R5-2 in code-reviews/scaffold-existing-repo-merge.
 */
function assertNoUnsafeLeafEntry(
  leaf: string,
  realProjectPath: string,
  relPathForMessage: string,
  planKind: "skip" | "agent_merge",
): void {
  const state = classifyPath(leaf);
  if (state === "absent") return;

  // Try to read the lstat once so we can distinguish symlink-to-dir from
  // real dir in error messages. lstat failure here is recoverable — we fall
  // back to a generic message.
  let lstat: fs.Stats | null = null;
  try {
    lstat = fs.lstatSync(leaf);
  } catch {
    // ignore; the state above already classifies this case
  }
  const isSymlink = lstat?.isSymbolicLink() ?? false;

  if (state === "broken-symlink") {
    throw new Error(
      `Cannot scaffold ${relPathForMessage}: ${leaf} is a broken symlink. Remove or fix the link before scaffolding.`,
    );
  }
  if (state === "inaccessible") {
    throw new Error(
      `Cannot scaffold ${relPathForMessage}: cannot stat ${leaf} (permission denied or other I/O error). Resolve the access problem before scaffolding.`,
    );
  }
  if (state === "directory") {
    // R6-2: a directory at ANY leaf (skip OR agent_merge) is broken — a
    // SKIP plan would mark it "skipped" while the user's downstream test
    // run still fails reading the YAML/JS file. Reject in both cases so
    // the user gets one clear diagnostic now instead of a confusing one
    // later. R6-3: surface symlink-to-directory distinctly so the user
    // knows whether to remove a directory or a symlink.
    const subject = isSymlink ? "a symlink that resolves to a directory" : "a directory";
    const action = isSymlink
      ? "Remove the symlink (or point it at a file) before scaffolding."
      : "Remove or rename the directory before scaffolding.";
    throw new Error(
      `Cannot scaffold ${relPathForMessage}: ${leaf} is ${subject}, but a file is expected here. ${action}`,
    );
  }
  // state === "non-directory" — either a real file or a symlink to a file.
  if (!isSymlink) return; // plain file is fine
  // Symlink containment only matters when scaffold might WRITE through it.
  // Skip plans never write when the file exists, so the containment check
  // is over-strict for them — many users legitimately symlink example
  // fixtures from a shared monorepo location.
  if (planKind === "skip") return;
  const realLeaf = safeRealpath(leaf, `leaf symlink at ${relPathForMessage}`);
  if (!isPathContained(realProjectPath, realLeaf)) {
    throw new Error(
      `Cannot scaffold ${relPathForMessage}: ${leaf} is a symlink that resolves to ${realLeaf}, which is outside the project root ${realProjectPath}. Writes through this link would escape the project.`,
    );
  }
}

export function scaffoldProject(opts: ScaffoldOptions): ScaffoldResult {
  const projectPath = path.resolve(opts.projectPath);
  const sanitized = sanitizeProjectName(
    opts.projectName ?? path.basename(projectPath),
  );
  const projectName = sanitized.name;
  // Validate before touching the filesystem: a bad version should fail with a
  // clear message, not after half a project tree already exists on disk.
  const shiplightRange = toDependencyRange(opts.shiplightVersion);

  assertTargetIsDirOrAbsent(projectPath);

  let preExistingTopLevelEntries: string[] = [];
  if (classifyPath(projectPath) === "directory") {
    try {
      preExistingTopLevelEntries = fs.readdirSync(projectPath);
    } catch {
      // unreadable; leave empty
    }
  }

  fs.mkdirSync(projectPath, { recursive: true });

  // Fail-closed realpath of projectPath: if we can't resolve the project
  // root's real location, the containment checks below would compare against
  // a lexical path and silently re-open the directory-symlink escape that
  // R3-2 was meant to fix.
  const realProjectPath = safeRealpath(projectPath, "project root");

  const gitignoreLines = gitignoreTpl
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const existingPwConfigs = PLAYWRIGHT_CONFIG_VARIANTS.map((rel) => ({
    rel,
    abs: path.join(projectPath, rel),
  })).filter((c) => pathEntryExists(c.abs));

  const existingType = readExistingPackageJsonType(projectPath);
  const playwrightShouldDeferForCjs =
    existingPwConfigs.length === 0 && existingType === "commonjs";

  const plans: FilePlan[] = [];

  plans.push({
    kind: "agent_merge",
    relPath: "package.json",
    content: packageJsonTpl
      .replace(/\{\{name\}\}/g, () => projectName)
      .replace(/\{\{shiplightVersion\}\}/g, () => shiplightRange),
    merge: {
      strategy: "json_merge_deps_and_scripts",
      humanSummary:
        "Add shiplightai to dependencies, add test scripts, set type:module and engines.node>=22 (with confirmation).",
      instructions:
        "An existing package.json was found. Merge the Shiplight template into it WITHOUT clobbering user fields:\n" +
        "1. Under .dependencies: add any key from the template's dependencies that is not already present. Do NOT change the version of a key the user already pinned.\n" +
        "2. Under .scripts: add \"test\" and \"test:headed\" only if missing. If a script of the same name already exists, do not overwrite — instead surface the conflict to the user and suggest renaming.\n" +
        "3. The template sets \"type\": \"module\". If the existing package.json does not, ASK the user before changing it. (If the user keeps CommonJS, the playwright.config.* merge entry's own instructions handle translating the config — you do not need to chase the config from here.)\n" +
        "4. The template sets \"engines\": { \"node\": \">=22\" }. If the existing package.json has no engines.node, add it. If it pins an older Node, ASK the user — Shiplight requires Node 22 and will fail at runtime on older versions.\n" +
        "5. Leave \"name\", \"version\", \"description\", \"author\", \"license\", and every other field alone.\n" +
        "Use Read + Edit to perform a minimal in-place merge — do not rewrite the whole file.",
    },
  });

  if (existingPwConfigs.length > 0) {
    for (const cfg of existingPwConfigs) {
      plans.push({
        kind: "agent_merge",
        relPath: cfg.rel,
        content: playwrightConfigTpl,
        merge: {
          strategy: "review_and_decide",
          humanSummary: `An existing ${cfg.rel} is already in place. We did not modify it.`,
          instructions:
            `An existing ${cfg.rel} was found. Show the user the Shiplight template and ask whether to (a) replace it entirely, (b) spread \`...shiplightConfig()\` from \`shiplightai\` into their existing defineConfig, or (c) leave their config as-is. Do not modify the file without explicit confirmation. If the user's package.json explicitly declares \`"type": "commonjs"\` (NOT just "no type field" — Shiplight treats missing type as ESM), translate the import-statement portion of the template to \`require()\` before offering option (a) or (b).`,
        },
      });
    }
  } else if (playwrightShouldDeferForCjs) {
    plans.push({
      kind: "agent_merge",
      relPath: "playwright.config.ts",
      content: playwrightConfigTpl,
      forceMerge: true,
      merge: {
        strategy: "review_and_decide",
        humanSummary:
          "Your package.json declares CommonJS. We did not write the ESM playwright.config.ts — decide CJS vs flipping to type:module first.",
        instructions:
          "Note: this entry describes a file that DOES NOT YET EXIST on disk. Do not attempt to Read `abs_path` — instead, ASK the user before writing anything.\n" +
          "The user's package.json explicitly declares CommonJS (\"type\": \"commonjs\"). The Shiplight template uses ESM-only syntax (`import { defineConfig, shiplightConfig } from 'shiplightai'; export default defineConfig({ ...shiplightConfig() })`), which would crash at load time with `Cannot use import statement outside a module`.\n" +
          "ASK the user whether to (a) flip package.json to `\"type\": \"module\"` (then write the template as-is to `abs_path`), or (b) keep CommonJS and write a CJS variant to `abs_path`: `const { defineConfig, shiplightConfig } = require('shiplightai'); module.exports = defineConfig({ ...shiplightConfig() });`. Do not write the file without explicit confirmation.",
      },
    });
  } else {
    plans.push({
      kind: "agent_merge",
      relPath: "playwright.config.ts",
      content: playwrightConfigTpl,
      merge: {
        strategy: "review_and_decide",
        humanSummary: "An existing playwright.config.ts is already in place. We did not modify it.",
        instructions:
          "An existing playwright.config.ts was found. Show the user the Shiplight template and ask whether to (a) replace it entirely, (b) spread `...shiplightConfig()` from `shiplightai` into their existing defineConfig, or (c) leave their config as-is. Do not modify the file without explicit confirmation.",
      },
    });
  }

  plans.push({
    kind: "agent_merge",
    relPath: ".gitignore",
    content: gitignoreTpl,
    merge: {
      strategy: "append_missing_lines",
      linesToEnsure: [...gitignoreLines],
      humanSummary: "Append Shiplight-required ignore patterns (node_modules/, .env, test-results/, ...) to .gitignore.",
      instructions:
        "An existing .gitignore was found. For each line in `linesToEnsure`, append it to the file only if no semantically-equivalent pattern is already present. Treat `node_modules`, `node_modules/`, `/node_modules`, and `**/node_modules` as equivalent (same goes for the other patterns) — if any form is present, skip the append. Group new entries under a `# Shiplight` comment block at the end of the file. Preserve all existing content, ordering, and comments.",
    },
  });

  plans.push({
    kind: "agent_merge",
    relPath: ".env.example",
    content: envExampleTpl,
    merge: {
      strategy: "append_missing_env_keys",
      humanSummary: "Append missing AI-provider keys GOOGLE_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY to .env.example.",
      instructions:
        "An existing .env.example was found. For each variable KEY in the template (lines matching `KEY=` or `# KEY=`), check whether KEY appears anywhere in the existing file. If not, append the corresponding line (preserving commented vs uncommented form). Group additions under a `# --- Shiplight ---` divider at the end. Preserve all existing content.",
    },
  });

  plans.push({
    kind: "agent_merge",
    relPath: ".mcp.json",
    content: mcpJsonTpl,
    merge: {
      strategy: "json_merge_under_key",
      mergeKey: "mcpServers",
      humanSummary: "Add the shiplight MCP server entry under .mcpServers, or nested-merge missing fields if one already exists.",
      instructions:
        "An existing .mcp.json was found. Parse it, then merge the template under .mcpServers:\n" +
        "1. If the existing file has no \"shiplight\" key under .mcpServers, add the entire template entry.\n" +
        "2. If a \"shiplight\" key already exists, perform a NESTED merge — for each field in the template's shiplight entry (`command`, `args`, `env`, ...), add the field if missing, and within `env` add any missing keys (e.g. `PWDEBUG`) without overwriting values the user already set. Do NOT replace the user's existing values.\n" +
        "3. Do not modify or overwrite any other top-level mcpServers entries.\n" +
        "Preserve overall formatting where possible.\n" +
        "Note: .mcp.json is for the user's coding agent's MCP discovery — Shiplight CLI tests run fine without it. Treat this merge as integration setup, not a hard prerequisite.",
    },
  });

  plans.push({ kind: "skip", relPath: "auth/example.login.ts", content: exampleLoginTpl });
  plans.push({ kind: "skip", relPath: "tests/example.test.yaml", content: exampleTestTpl });

  // Pre-flight every plan's parent path AND its leaf. Three checks per
  // intermediate dir + leaf:
  // (a) the dir/leaf, if it exists, must be a directory (parents) or a
  //     real/contained file (leaves) — otherwise the eventual write fails
  //     mid-loop or escapes;
  // (b) the dir, if it exists, must REALPATH-resolve to a location inside
  //     `realProjectPath` — otherwise a directory symlink would let writes
  //     escape the project tree;
  // (c) the leaf, if it exists as a symlink, must also resolve inside
  //     `realProjectPath` — otherwise writeFileSync would follow the link
  //     and clobber an external file (R4-1).
  for (const plan of plans) {
    const absLeaf = path.join(projectPath, plan.relPath);
    let dir = path.dirname(absLeaf);
    while (true) {
      const rel = path.relative(projectPath, dir);
      if (
        rel === "" ||
        rel === ".." ||
        rel.startsWith(".." + path.sep) ||
        path.isAbsolute(rel)
      ) {
        break;
      }
      const state = classifyPath(dir);
      if (state !== "absent" && state !== "directory") {
        // R5-4: include realProjectPath in the diagnostic so the user can
        // identify whether the inaccessible/broken-symlink path is shared
        // across multiple plans (most permission issues are ancestor-level).
        const suffix = ` (project root: ${realProjectPath}). If multiple plans share this ancestor, the same issue blocks them all.`;
        throw new Error(
          state === "broken-symlink"
            ? `Cannot scaffold ${plan.relPath}: parent path ${dir} is a broken symlink.${suffix}`
            : state === "inaccessible"
              ? `Cannot scaffold ${plan.relPath}: cannot stat parent path ${dir} (permission denied or other I/O error).${suffix}`
              : `Cannot scaffold ${plan.relPath}: parent path ${dir} exists and is not a directory.${suffix}`,
        );
      }
      if (state === "directory") {
        const realDir = safeRealpath(dir, `parent of ${plan.relPath}`);
        if (!isPathContained(realProjectPath, realDir)) {
          throw new Error(
            `Cannot scaffold ${plan.relPath}: parent path ${dir} resolves to ${realDir}, which is outside the project root ${realProjectPath}.`,
          );
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    // Leaf check (R4-1): symlinked leaves that resolve outside the project
    // would otherwise be followed by writeFileSync. R5-1 + R5-2: the strict
    // checks (DIRECTORY at leaf, external-symlink) only matter for
    // agent_merge plans (which write or hand abs_path to the agent); skip
    // plans never write when a file exists, so they're treated more leniently.
    assertNoUnsafeLeafEntry(absLeaf, realProjectPath, plan.relPath, plan.kind);
  }

  const filesCreated: string[] = [];
  const filesSkipped: string[] = [];
  const filesNeedingAgentMerge: FileMergeRequest[] = [];

  for (const plan of plans) {
    const absPath = path.join(projectPath, plan.relPath);
    const targetPresent = pathEntryExists(absPath);
    const shouldForceMerge =
      plan.kind === "agent_merge" && plan.forceMerge === true;

    if (!targetPresent && !shouldForceMerge) {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, plan.content);
      filesCreated.push(plan.relPath);
      continue;
    }

    if (plan.kind === "skip") {
      filesSkipped.push(plan.relPath);
      continue;
    }

    const req: FileMergeRequest = {
      path: plan.relPath,
      absPath,
      mergeStrategy: plan.merge.strategy,
      template: plan.content,
      instructions: plan.merge.instructions,
      humanSummary: plan.merge.humanSummary,
    };
    if (plan.merge.mergeKey !== undefined) req.mergeKey = plan.merge.mergeKey;
    if (plan.merge.linesToEnsure !== undefined) req.linesToEnsure = plan.merge.linesToEnsure;
    filesNeedingAgentMerge.push(req);
  }

  return {
    projectPath,
    projectName,
    originalProjectName: sanitized.original,
    filesCreated,
    filesSkipped,
    filesNeedingAgentMerge,
    preExistingTopLevelEntries,
  };
}
