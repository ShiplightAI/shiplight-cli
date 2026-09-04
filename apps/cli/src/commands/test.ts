/**
 * Test Command
 *
 * Wrapper around `npx playwright test` that:
 * 1. (Pre) Loads cached action entities from the store
 * 2. Runs Playwright tests (transpilation uses the cache)
 * 3. (Post) Saves new self-healed action entities back to the store
 */

import { spawn, execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { globSync } from "glob";
import { createActionEntityCache, escapeTestPath } from "../cache/actionEntityCacheStore.js";
import { readInlineFingerprintMap } from "../cache/inlineFingerprintMap.js";
import type { ActionEntityCache } from "../cache/actionEntityCacheStore.js";
import type { ActionEntityStore, ActionStoreEntry } from "shiplight-types";
import { PUBLISHED_VERSION } from "../versionCheck.js";
import { takeFlagValues } from "../argv.js";
import { getRequestedYamlFiles } from "../transpile.js";
import { loadShiplightEnv, getShiplightEnv } from "../dotenvSource.js";
import { describeTierSelection, fetchOrgSettings, resolveTierPreflight } from "../orgSettings.js";
import { resolveRunId } from "../runId.js";

export async function runTests(args: string[]) {
  // Check if --help
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: shiplight test [playwright-args...]");
    console.log("");
    console.log("Delegates to `npx playwright test` with all arguments forwarded.");
    console.log("Auto-detects playwright.config.ts in the current directory.");
    console.log("");
    console.log("Shiplight options:");
    console.log("  --vars KEY=VAL[,KEY=VAL...]   Override runtime {{VAR}} values (repeatable).");
    console.log("                                Comma separates pairs, so values cannot");
    console.log("                                contain commas — use --vars-file for those.");
    console.log("                                In the space-separated form, the value cannot");
    console.log("                                start with `--` (it is treated as the next");
    console.log("                                flag); use --vars=KEY=--value instead.");
    console.log("  --vars-file <path>            JSON file of overrides ({ KEY: \"value\", ... }).");
    console.log("                                Values must be strings — quote numbers.");
    console.log("  --offline                     Skip the pre-test call to Shiplight cloud for");
    console.log("                                org settings. Runs on built-in model defaults.");
    console.log("                                Same as SHIPLIGHT_OFFLINE=1.");
    console.log("");
    console.log("Environment:");
    console.log("  PWDEBUG=0                     Opt out of PWDEBUG=console, which shiplight test");
    console.log("                                sets by default so self-healed actions are cached");
    console.log("                                as durable locators instead of positional XPaths.");
    console.log("                                It also defines a window.playwright global on every");
    console.log("                                page — set PWDEBUG=0 if the site under test detects");
    console.log("                                that marker. Cached locator quality degrades.");
    console.log("");
    console.log("Examples:");
    console.log("  shiplight test                              # run all tests");
    console.log("  shiplight test --headed                     # run tests with browser visible");
    console.log("  shiplight test tests/login.test.yaml        # run a specific YAML test");
    console.log("  shiplight test tests/login.test.ts          # run a specific TS test");
    console.log("  shiplight test --grep 'login'               # filter tests by name");
    console.log("  shiplight test --vars SAUCE_USER=standard_user");
    console.log("  shiplight test --vars-file ./local-vars.json");
    process.exit(0);
  }

  // Resolve the project root the same way Playwright does (honoring -c/--config),
  // so our pre/post steps anchor to the config's directory rather than cwd —
  // matching `playwright test`. Without -c/--config this resolves to cwd, so
  // behavior is unchanged when run from the project root.
  const cwd = process.cwd();
  const projectRoot = resolveProjectRootDir(args, cwd);

  // Install the Shiplight .env stash in THIS (parent) process, walking up from
  // the project root exactly as the spawned child does in config.ts. Without
  // this the parent's getShiplightEnv() falls back to raw process.env — shell
  // wins, no walk-up — while the child resolves .env-over-shell. That split
  // silently mis-tokens the action-entity cache (createActionEntityCache /
  // actionEntityCacheClient read SHIPLIGHT_API_TOKEN via getShiplightEnv), so a
  // token declared only in .env, or shadowed by a stale shell value, drops CI to
  // a cold local cache. Installing the stash here makes parent and child agree
  // (issue #2176). It sets a globalThis stash only — it does NOT mutate
  // process.env, so the spawned child's inherited environment is unchanged.
  loadShiplightEnv(projectRoot);

  // Only warn about a missing config when none was specified via -c/--config.
  if (extractConfigArg(args) === undefined) {
    const configFiles = [
      "playwright.config.ts",
      "playwright.config.js",
      "playwright.config.mjs",
    ];
    const hasConfig = configFiles.some((f) => fs.existsSync(path.join(cwd, f)));

    if (!hasConfig) {
      console.warn(
        "Warning: No playwright.config.ts found in current directory."
      );
      console.warn(
        "Make sure you're running from your project root.\n"
      );
    }
  }

  // Shiplight-only flags: consumed here, never forwarded to Playwright.
  const { hasMagic, isOffline, remaining } = extractShiplightFlags(args);
  let filteredArgs = remaining;

  // Extract --vars / --vars-file and pack them into SHIPLIGHT_VARS_OVERRIDE.
  // --vars wins over --vars-file for overlapping keys.
  let varsOverride: Record<string, string> = {};
  try {
    const { extracted, remaining } = extractVarOverrideArgs(filteredArgs, cwd);
    filteredArgs = remaining;
    varsOverride = extracted;
  } catch (err) {
    console.error(`[shiplight] ${(err as Error).message}`);
    process.exit(2);
  }

  // Rewrite .test.yaml args to .yaml.spec.ts so Playwright can find them.
  const rewrittenArgs = filteredArgs.map((arg) => {
    if (arg.endsWith(".test.yaml")) {
      return rewriteTestYamlArg(arg, cwd);
    }
    return arg;
  });

  // Create the cache based on environment
  const cache = createActionEntityCache(projectRoot);

  // Scope the pre-test cache download to the tests this run will actually
  // transpile. The transpiler (transpile.ts) only ever looks up cache for the
  // requested files, so `shiplight test A` must not download every test's cache
  // — the rest is fetched over the network, written to disk, and never read.
  // We pass `rewrittenArgs` (the .yaml.spec.ts forms handed to Playwright) so the
  // download scope matches exactly what the spawned transpiler will request.
  // null → no specific file targeted (bare run, --grep) → whole repo, same as
  // the transpiler's own fallback.
  const requestedYamlFiles = getRequestedYamlFiles(projectRoot, rewrittenArgs);

  // ── Pre-test: load cached action entities ──────────────────────
  await preTestDownload(projectRoot, cache, requestedYamlFiles);

  // ── Pre-test: org settings (model tier mapping) ────────────────
  // The merged .env view (installed as the stash above), so this sees the same
  // SHIPLIGHT_API_TOKEN the spawned process will. Resolved once, pinned per run.
  const shiplightEnv = getShiplightEnv();
  const orgSettings = await fetchOrgSettings(shiplightEnv, { offline: isOffline });
  const preflight = resolveTierPreflight(orgSettings);
  for (const warning of preflight.warnings) {
    console.warn(`[shiplight] ${warning}`);
  }
  if (preflight.abort) {
    // Fail before the browsers start. An authoritative token rejection surfacing
    // as a mid-test proxy 401 costs a full run's CI minutes to learn nothing.
    console.error(`[shiplight] ${preflight.abort.message}`);
    process.exit(preflight.abort.code);
  }
  const tierEnv = preflight.tierEnv;

  // ── Run tests ───────────────────────────────────────────────────
  // Print the shiplightai version banner on every `shiplight test` run so
  // CI logs always record which build executed the tests. Matches the
  // vitest / vite convention of a one-line version header at the top of
  // the run output. Written to stdout so it lands in test-output captures
  // and log files alongside the Playwright output that follows.
  //
  // `PUBLISHED_VERSION` is `undefined` for dev builds (raw `tsx src/cli.ts`),
  // so the banner is automatically suppressed there — `shiplightai vdev`
  // would be noise in a developer's terminal.
  if (PUBLISHED_VERSION) {
    process.stdout.write(`shiplightai v${PUBLISHED_VERSION}\n`);
  }

  // Report the model selection using the env the child will actually resolve
  // from — the .env view plus whatever tier map was just injected — so what is
  // printed is what runs, not a parent-process approximation of it. Silent for
  // any run that tier selection does not govern.
  const tierReport = describeTierSelection({ ...shiplightEnv, ...tierEnv });
  for (const line of tierReport.info) {
    process.stdout.write(`[shiplight] ${line}\n`);
  }
  for (const warning of tierReport.warnings) {
    console.warn(`[shiplight] ${warning}`);
  }

  const env = applyLocatorGenerationDefault({ ...process.env, ...tierEnv });
  if (hasMagic) {
    env.SHIPLIGHT_MAGIC = "1";
  }
  if (Object.keys(varsOverride).length > 0) {
    env.SHIPLIGHT_VARS_OVERRIDE = JSON.stringify(varsOverride);
  }
  // Tell shiplightConfig() (which runs inside the spawned Playwright process at
  // config-eval time, where process.cwd() is the invocation dir, not the config
  // dir) which directory to anchor YAML scanning and the action cache to.
  env.SHIPLIGHT_PROJECT_ROOT = projectRoot;
  // Mint the run ID HERE rather than leaving it to shiplightConfig() in the
  // child: `test-results/<runId>` is the only place this run's healed entities
  // can be, and postTestUpload below has to know that directory by name.
  const runId = resolveRunId(env);
  env.SHIPLIGHT_RUN_ID = runId;

  // Stamped before the spawn: postTestUpload uses it to tell this run's healed
  // entities apart from those left in test-results/ by every previous run.
  const runStartedAt = Date.now();
  const child = spawn(
    "npx",
    ["playwright", "test", ...rewrittenArgs],
    buildPlaywrightSpawnOptions(cwd, env),
  );

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });

  // ── Post-test: save healed entities back to the cache ──────────
  await postTestUpload(projectRoot, cache, { id: runId, startedAt: runStartedAt });

  process.exit(exitCode);
}

/**
 * Default `PWDEBUG=console` for the spawned Playwright run.
 *
 * This is what makes the action cache store durable locators. Playwright injects
 * the page-side `playwright.generateLocator()` helper ONLY under
 * `PWDEBUG=console`; without it `pickBestLocator` returns null and every entity
 * a self-heal produces falls back to a positional XPath like
 * `html/body/div[1]/main/section/div/button` (sdk-core `llm_tools/utils.ts`,
 * `dom/utils/locator.ts`). Those XPaths replay fine, so nothing ever heals them
 * again and the entry never upgrades — the cache is stuck on the shape it was
 * first written with. `shiplight debug` and the scaffolded MCP server already
 * set this; `shiplight test`, the one path that WRITES the cache, did not.
 *
 * Unlike `PWDEBUG=1`, the `console` value does not force headed mode,
 * `timeout=0`, or `workers=1`.
 *
 * It is NOT free, though, and the cost lands on every run: `debugMode() ===
 * "console"` makes `BrowserContext.initialize()` call `_exposeConsoleApi()`,
 * which defines a `window.playwright` global in every page and frame. That is an
 * automation marker an application — or the bot detection in front of it — can
 * see. A site that fingerprints for it will behave differently under
 * `shiplight test` than it did before this default, so the opt-out
 * (`PWDEBUG=0`) is documented in `--help`.
 *
 * An explicit value always wins: `PWDEBUG=0` / `PWDEBUG=` (off) and `PWDEBUG=1`
 * (the Inspector) are all left alone. Only an absent variable is defaulted.
 *
 * Exported for testing.
 */
export function applyLocatorGenerationDefault(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.PWDEBUG === undefined) {
    env.PWDEBUG = "console";
  }
  return env;
}

/**
 * Split Shiplight's own boolean flags out of the argv before the rest is handed
 * to Playwright. Playwright rejects unknown options, so anything we add here
 * MUST be removed — a forwarded `--offline` aborts the run with a parse error.
 *
 *   --magic    → SHIPLIGHT_MAGIC=1 for the fixture
 *   --offline  → skip the pre-test org-settings fetch
 *
 * Exported for testing.
 */
export function extractShiplightFlags(args: string[]): {
  hasMagic: boolean;
  isOffline: boolean;
  remaining: string[];
} {
  return {
    hasMagic: args.includes("--magic"),
    isOffline: args.includes("--offline"),
    remaining: args.filter((a) => a !== "--magic" && a !== "--offline"),
  };
}

/**
 * Spawn options for invoking `npx playwright test`. Exported for testing —
 * `--grep` regexes containing escaped metacharacters (e.g. `\[deluxe\]`) must
 * survive verbatim from the user's argv all the way to Playwright. The `shell`
 * field is the load-bearing knob: when true, Node re-parses the joined command
 * string through /bin/sh on Unix, which strips backslashes outside quotes and
 * corrupts regex escapes. Windows is forced to use a shell because `npx` is
 * `npx.cmd` and CVE-2024-27980 blocks direct .cmd spawning without one.
 */
export function buildPlaywrightSpawnOptions(cwd: string, env: NodeJS.ProcessEnv) {
  return {
    stdio: "inherit" as const,
    shell: process.platform === "win32",
    cwd,
    env,
  };
}

// ============================================================================
// Project Root Resolution (mirrors Playwright's config discovery)
// ============================================================================

/**
 * Extract the value of a -c/--config argument. Handles `-c x`, `--config x`,
 * `--config=x`, `-cx`, and `-c=x`. The first four mirror what Playwright's CLI
 * (commander) accepts; `-c=x` is tolerated as a superset (commander would parse
 * the value as `=x`), which is harmless since Playwright rejects that form
 * anyway. Returns undefined when no config argument is present.
 *
 * Exported for testing.
 */
export function extractConfigArg(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-c" || a === "--config") return args[i + 1];
    if (a.startsWith("--config=")) return a.slice("--config=".length);
    if (a.startsWith("-c=")) return a.slice("-c=".length);
    if (a.startsWith("-c") && a.length > 2) return a.slice(2); // -cVALUE
  }
  return undefined;
}

/**
 * Resolve the Playwright project root (rootDir) the same way Playwright does in
 * `resolveConfigLocation`: a -c/--config value is resolved relative to cwd, then
 * rootDir is the config file's directory (or the directory itself when the value
 * points at a directory). Without -c/--config the target is cwd, so this returns
 * cwd unchanged — preserving existing behavior. Falls back to cwd if the target
 * does not exist (Playwright will surface that error when it runs).
 *
 * Exported for testing.
 */
export function resolveProjectRootDir(args: string[], cwd: string): string {
  const configArg = extractConfigArg(args);
  const target = configArg ? path.resolve(cwd, configArg) : cwd;
  try {
    return fs.statSync(target).isDirectory() ? target : path.dirname(target);
  } catch {
    return cwd;
  }
}

// ============================================================================
// Pre/Post Test Orchestration
// ============================================================================

/**
 * Get the git repository root directory.
 * Returns null if not in a git repo.
 */
function getGitRoot(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Detect git branch for test_path prefix (cloud cache only).
 * Returns "branch:" prefix or empty string if not in a git repo.
 */
function getGitBranchPrefix(): string {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (branch && branch !== "HEAD") {
      return `${branch}:`;
    }
  } catch {
    // Not a git repo or git not available
  }
  return "";
}

/**
 * Convert YAML file paths (relative to cwd) to test_path keys for the cache.
 *
 * Cloud: git-root-relative paths with branch prefix (unique across machines).
 *   e.g. "main:examples/yaml-examples/showcase/01-self-healing.test.yaml"
 * Local: cwd-relative paths (matches transpiler's relPath lookup).
 *   e.g. "showcase/01-self-healing.test.yaml"
 */
function buildTestPaths(yamlFiles: string[], cwd: string, isCloud: boolean): { testPaths: string[]; branchPrefix: string } {
  if (!isCloud) {
    return { testPaths: [...yamlFiles], branchPrefix: "" };
  }

  const branchPrefix = getGitBranchPrefix();
  const gitRoot = getGitRoot();
  return buildTestPathsFromGitInfo(yamlFiles, cwd, branchPrefix, gitRoot);
}

/**
 * Pure function: build test paths given git info. Exported for testing.
 */
export function buildTestPathsFromGitInfo(
  yamlFiles: string[],
  cwd: string,
  branchPrefix: string,
  gitRoot: string | null,
): { testPaths: string[]; branchPrefix: string } {
  const testPaths = yamlFiles.map((f) => {
    const relPath = gitRoot
      ? path.relative(gitRoot, path.resolve(cwd, f))
      : f;
    return `${branchPrefix}${relPath}`;
  });

  return { testPaths, branchPrefix };
}

/**
 * Convert a cloud test_path key back to a cwd-relative path for local file storage.
 * Exported for testing.
 */
export function cloudKeyToCwdRelPath(testPath: string, branchPrefix: string, gitRoot: string | null, cwd: string): string {
  // Strip branch prefix → git-root-relative path
  const gitRelPath = branchPrefix && testPath.startsWith(branchPrefix)
    ? testPath.slice(branchPrefix.length)
    : testPath;
  // Convert git-root-relative → cwd-relative
  return gitRoot
    ? path.relative(cwd, path.resolve(gitRoot, gitRelPath))
    : gitRelPath;
}

/**
 * Pre-test: look up cached stores and write to .shiplight/action-cache/ for the transpiler.
 *
 * `requestedYamlFiles` scopes the download to the tests this run targets (from
 * getRequestedYamlFiles). When null, no specific file was requested (bare `shiplight
 * test`, `--grep`), so the whole repo is fetched — matching the transpiler's fallback.
 *
 * Exported for testing.
 */
export async function preTestDownload(
  cwd: string,
  cache: ActionEntityCache,
  requestedYamlFiles: string[] | null,
): Promise<void> {
  try {
    const yamlFiles = requestedYamlFiles
      ?? globSync("**/*.test.yaml", { cwd, ignore: ["**/node_modules/**"] });
    if (yamlFiles.length === 0) return;

    const { testPaths, branchPrefix } = buildTestPaths(yamlFiles, cwd, cache.isCloud);

    const stores = await cache.lookup(testPaths);
    if (stores.size === 0) return;

    // Write to .shiplight/action-cache/ so the transpiler can read them at config time.
    // File keys must be cwd-relative (matching transpiler's relPath lookup).
    const cacheDir = path.join(cwd, ".shiplight", "action-cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    const gitRoot = getGitRoot();

    let count = 0;
    for (const [testPath, actionStore] of stores) {
      const cwdRelPath = cache.isCloud
        ? cloudKeyToCwdRelPath(testPath, branchPrefix, gitRoot, cwd)
        : testPath;
      const cachePath = path.join(cacheDir, escapeTestPath(cwdRelPath));
      fs.writeFileSync(cachePath, JSON.stringify(actionStore, null, 2));
      count++;
    }

    console.log(`[shiplight] Cache: downloaded ${count} action store${count !== 1 ? "s" : ""}`);
  } catch (err) {
    console.warn("[shiplight] Cache download failed:", (err as Error).message);
  }
}

/**
 * Pick the healed entries belonging to one test file and stamp each with the inline
 * entity it superseded.
 *
 * A statement belongs to the file whose generated spec mentions its UID — the UID is
 * position-derived and content-independent, which is what makes that test stable while a
 * run is in flight.
 *
 * The stamp is what stops the entry from shadowing a later YAML edit. It cannot be applied
 * where the entry is created: the Playwright fixture sees a healed entity and a UID, never
 * the YAML's own entity. A UID missing from the map is left unstamped rather than stamped
 * with a guess — an unstamped entry is grandfathered, which loses invalidation for that
 * statement but never serves a wrong entity's fingerprint.
 */
export function selectStampedFileEntries(
  mergedEntries: Record<string, ActionStoreEntry>,
  specContent: string,
  inlineFingerprints: Record<string, string>,
): Record<string, ActionStoreEntry> {
  const fileEntries: Record<string, ActionStoreEntry> = {};
  for (const [uid, entry] of Object.entries(mergedEntries)) {
    if (!specContent.includes(uid)) continue;
    const sourceFingerprint = inlineFingerprints[uid];
    fileEntries[uid] =
      sourceFingerprint === undefined ? entry : { ...entry, source_fingerprint: sourceFingerprint };
  }
  return fileEntries;
}

/**
 * Was this file written by the run that started at `startedAt`?
 *
 * The parent stamps the time just before spawning Playwright, and the fixture
 * writes the entity file mid-run, so anything from this run is at or after it
 * and anything from a previous run is before it. Unreadable → false: an entity
 * file we cannot stat is not one we should upload.
 */
function isWrittenAfter(filePath: string, startedAt: number): boolean {
  try {
    return fs.statSync(filePath).mtimeMs >= startedAt;
  } catch {
    return false;
  }
}

/**
 * Post-test: scan THIS run's output dir for new-action-entities.json, group by
 * test file, and save back to the cache.
 *
 * Scoped to `test-results/<runId>` — not all of `test-results/` — because that
 * directory is per-run (`shiplightConfig()` sets `outputDir` to it) and is never
 * cleaned up. The unscoped glob picked up every entity file any past run had
 * left behind, so a run that healed nothing still re-saved months-old entities
 * and reported them as "saved N action entities", and in CI re-upserted them to
 * the cloud cache on every run. `run.id` is pinned by the caller before the
 * spawn, so this is the same directory the child just wrote to.
 *
 * The directory is an OPTIMISATION, not the correctness guarantee — `run.startedAt`
 * is. Two ways the scoped path can be the wrong place to look: a config that
 * spreads `shiplightConfig()` and then sets its own `outputDir`, or
 * `shiplight test --output=…`, which Playwright honours and we forward verbatim.
 * Returning empty there would silently stop writing the cache back for those
 * projects, so a missing scoped directory falls back to the whole tree. The
 * mtime filter is what keeps previous runs out in BOTH paths — including the
 * scoped one, which accumulates across runs whenever a caller pins
 * SHIPLIGHT_RUN_ID itself.
 *
 * Exported for testing.
 */
export async function postTestUpload(
  cwd: string,
  cache: ActionEntityCache,
  run: { id: string; startedAt: number },
): Promise<void> {
  try {
    const scopedDir = path.join(cwd, "test-results", run.id);
    const resultsDir = fs.existsSync(scopedDir) ? scopedDir : path.join(cwd, "test-results");
    if (!fs.existsSync(resultsDir)) return;

    const cacheFiles = globSync("**/new-action-entities.json", { cwd: resultsDir })
      .filter((f) => isWrittenAfter(path.join(resultsDir, f), run.startedAt));
    if (cacheFiles.length === 0) return;

    // Merge all new action entities into a single pool
    const mergedEntries: Record<string, ActionStoreEntry> = {};
    for (const file of cacheFiles) {
      try {
        const content = fs.readFileSync(path.join(resultsDir, file), "utf-8");
        const parsed = JSON.parse(content) as ActionEntityStore;
        if (parsed?.entries) {
          Object.assign(mergedEntries, parsed.entries);
        }
      } catch {
        // Skip invalid files
      }
    }

    if (Object.keys(mergedEntries).length === 0) return;

    // What each healed statement's inline entity looked like at transpile time, recorded
    // by the spawned Playwright process (the only one that sees the YAML's own entities).
    const inlineFingerprints = readInlineFingerprintMap(cwd);

    // Group entries by test file (match UIDs against generated spec files)
    const yamlFiles = globSync("**/*.test.yaml", { cwd, ignore: ["**/node_modules/**"] });
    const { testPaths: mappedPaths, branchPrefix } = buildTestPaths(yamlFiles, cwd, cache.isCloud);

    const stores = new Map<string, ActionEntityStore>();
    for (let i = 0; i < yamlFiles.length; i++) {
      const yamlFile = yamlFiles[i];
      const testPath = mappedPaths[i];
      const specPath = path.join(cwd, yamlFile.replace(/\.test\.yaml$/, ".yaml.spec.ts"));
      if (!fs.existsSync(specPath)) continue;

      const specContent = fs.readFileSync(specPath, "utf-8");
      const fileEntries = selectStampedFileEntries(mergedEntries, specContent, inlineFingerprints);

      if (Object.keys(fileEntries).length > 0) {
        // Merge with previously-downloaded cache to avoid overwriting existing entries.
        // Without this, cloud upsert (last-write-wins) would lose entries from prior runs
        // that weren't re-healed in this run.
        const cwdRelPath = cache.isCloud
          ? cloudKeyToCwdRelPath(testPath, branchPrefix, getGitRoot(), cwd)
          : testPath;
        const existingPath = path.join(cwd, ".shiplight", "action-cache", escapeTestPath(cwdRelPath));
        let existingEntries: Record<string, ActionStoreEntry> = {};
        if (fs.existsSync(existingPath)) {
          try {
            const existing = JSON.parse(fs.readFileSync(existingPath, "utf-8")) as ActionEntityStore;
            existingEntries = existing.entries;
          } catch { /* ignore */ }
        }

        stores.set(testPath, { version: "1.0", entries: { ...existingEntries, ...fileEntries } });
      }
    }

    if (stores.size === 0) return;

    const updated = await cache.update(stores);
    const entryCount = Array.from(stores.values())
      .reduce((sum, s) => sum + Object.keys(s.entries).length, 0);
    console.log(`[shiplight] Cache: saved ${entryCount} action entit${entryCount !== 1 ? "ies" : "y"} for ${updated} test${updated !== 1 ? "s" : ""}`);
  } catch (err) {
    console.warn("[shiplight] Cache upload failed:", (err as Error).message);
  }
}

// ============================================================================
// .test.yaml → .yaml.spec.ts rewriting
// ============================================================================

/* eslint-disable no-control-regex */
const HAS_NON_ASCII = /[^\x00-\x7F]/;
/* eslint-enable no-control-regex */

/**
 * Rewrite a `.test.yaml` CLI argument to the transpiled `.yaml.spec.ts` path
 * that Playwright can locate.
 *
 * On Windows, Playwright's file-argument matcher (`createFileMatcher`) converts
 * the CLI string to a RegExp via `forceRegExp`, then tests it against both the
 * native file path and `pathToFileURL(filePath).href`. The URL form
 * percent-encodes non-ASCII characters, so a regex containing literal Chinese
 * (or other non-ASCII) characters will never match. We sidestep this by passing
 * the file:// URL directly — `forceRegExp` produces a regex whose percent-encoded
 * literal bytes match the percent-encoded URL that Playwright generates
 * internally.
 *
 * Exported for testing.
 */
export function rewriteTestYamlArg(arg: string, cwd: string): string {
  const specPath = arg.replace(/\.test\.yaml$/, ".yaml.spec.ts");
  if (process.platform === "win32" && HAS_NON_ASCII.test(arg)) {
    return pathToFileURL(path.resolve(cwd, specPath)).href;
  }
  return specPath;
}

// ============================================================================
// --vars / --vars-file parsing
// ============================================================================

/**
 * Parse a single --vars argument value. Supports `KEY=VAL` and
 * `KEY1=VAL1,KEY2=VAL2`. Values may contain `=`; only the first `=` splits
 * the key.
 *
 * Quirks worth knowing:
 * - Comma is the separator between pairs, so values cannot themselves
 *   contain commas (e.g. a URL like `https://a.com/x,y` would be split).
 *   Use --vars-file for values that contain commas.
 * - Each pair is trimmed before the split, and the key is trimmed again
 *   after the split; the value keeps any whitespace immediately after `=`
 *   (e.g. ` FOO = bar ` → `{ FOO: ' bar' }`).
 */
export function parseVarsArg(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const trimmed = pair.trim();
    if (trimmed === "") continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Invalid --vars entry "${trimmed}": expected KEY=VALUE`);
    }
    const key = trimmed.slice(0, eq).trim();
    out[key] = trimmed.slice(eq + 1);
  }
  return out;
}

/**
 * Load a --vars-file. File must be JSON object with string values.
 */
export function loadVarsFile(filePath: string, cwd: string): Record<string, string> {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`--vars-file not found: ${resolved}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  } catch (err) {
    throw new Error(`--vars-file ${resolved} is not valid JSON: ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`--vars-file ${resolved} must be a JSON object`);
  }
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof val !== "string") {
      throw new Error(`--vars-file ${resolved}: key "${key}" must be a string (got ${typeof val})`);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Walk argv, strip --vars / --vars-file (and their values), and merge into
 * a single override map. --vars beats --vars-file for overlapping keys.
 * Within the same flag type, later occurrences override earlier ones.
 *
 * Supported argv forms:
 *   --vars KEY=VAL
 *   --vars KEY1=VAL1,KEY2=VAL2
 *   --vars=KEY=VAL
 *   --vars-file path.json
 *   --vars-file=path.json
 */
export function extractVarOverrideArgs(
  argv: string[],
  cwd: string,
): { extracted: Record<string, string>; remaining: string[] } {
  const fromFlag: Record<string, string> = {};
  const fromFile: Record<string, string> = {};

  // Two passes over the same shared walk. `--vars` first, then `--vars-file`
  // over what it left behind; neither prefix matches the other's tokens, so the
  // order only affects which flag is stripped first, not the result.
  const varsPass = takeFlagValues(argv, "--vars");
  const filePass = takeFlagValues(varsPass.remaining, "--vars-file");

  for (const { value } of varsPass.occurrences) {
    if (value === undefined) throw new Error("--vars requires a value");
    Object.assign(fromFlag, parseVarsArg(value));
  }
  for (const { value } of filePass.occurrences) {
    if (value === undefined) throw new Error("--vars-file requires a value");
    Object.assign(fromFile, loadVarsFile(value, cwd));
  }

  return { extracted: { ...fromFile, ...fromFlag }, remaining: filePass.remaining };
}
