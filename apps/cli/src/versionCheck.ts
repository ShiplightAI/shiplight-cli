/**
 * Version freshness check and global-install guard for the shiplightai CLI.
 *
 * - Hard-blocks execution when run from a global npm install (stale by design).
 * - On startup, fetches the latest published version from the npm registry and
 *   caches the result in ~/.shiplight/version-check.json (~1h TTL).
 * - If the running version is behind latest and the cwd has a package-lock.json,
 *   prints a single warning with the `npm update shiplightai` command.
 * - Silent on network failure. Auto-suppressed when CI=true.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

declare const __SHIPLIGHTAI_VERSION__: string | undefined;

/**
 * Version string injected at build time by tsup's esbuild `define`,
 * sourced from `apps/cli/package.json`. When running outside a bundled
 * build (e.g. `tsx src/cli.ts` during dev), the macro is undefined and
 * we fall back to the literal `"dev"`.
 *
 * Prefer `PUBLISHED_VERSION` below when you want the version for user-
 * visible artifacts (reports, banners, log prefixes) — that exposes
 * `undefined` for dev builds rather than the literal `"dev"` string,
 * so the sentinel never bleeds into CI logs or uploaded report JSON.
 */
export const RUNNING_VERSION: string =
  typeof __SHIPLIGHTAI_VERSION__ !== "undefined" ? __SHIPLIGHTAI_VERSION__ : "dev";

/**
 * The version string for user-visible surfaces — `undefined` when
 * running in dev mode (raw tsx without the bundled version macro),
 * the real semver string otherwise. Use this for anything that would
 * otherwise stamp `"dev"` into a report, log, or banner.
 *
 * The `"dev"` sentinel check is owned here so the rest of the CLI
 * doesn't sprinkle `RUNNING_VERSION !== "dev" ? ... : undefined`
 * across its consumers. Single source of truth for "is this a real
 * published build that should be attributed in artifacts."
 */
export const PUBLISHED_VERSION: string | undefined =
  RUNNING_VERSION !== "dev" ? RUNNING_VERSION : undefined;

const REGISTRY_URL = "https://registry.npmjs.org/shiplightai/latest";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const PREFIX_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — npm prefix rarely changes

export interface CacheEntry {
  latest: string;
  fetchedAt: number;
}

interface PrefixCacheEntry {
  prefix: string;
  fetchedAt: number;
}

function defaultCacheFile(): string {
  return path.join(os.homedir(), ".shiplight", "version-check.json");
}

function defaultPrefixCacheFile(): string {
  return path.join(os.homedir(), ".shiplight", "npm-prefix.json");
}

/**
 * Look up the npm global prefix, with long-lived caching. Spawns `npm config
 * get prefix` only on first call or after the cache expires (~7 days), since
 * the prefix almost never changes on a given machine.
 *
 * Cold-start cost: the synchronous `execFileSync` spawn typically runs in
 * 200–500ms. Bounded to once per week via the cache; warm runs are a single
 * JSON parse. If an nvm switch changes the prefix, the cache may be stale
 * for up to 7 days — the only consequence is missing a coexistence warning.
 */
export function getNpmPrefix(
  cacheFile: string = defaultPrefixCacheFile()
): string | null {
  try {
    const raw = fs.readFileSync(cacheFile, "utf-8");
    const parsed = JSON.parse(raw) as PrefixCacheEntry;
    if (
      typeof parsed.prefix === "string" &&
      typeof parsed.fetchedAt === "number" &&
      Date.now() - parsed.fetchedAt < PREFIX_TTL_MS
    ) {
      return parsed.prefix;
    }
  } catch {
    // Missing or malformed — fall through to fetch.
  }

  let prefix: string;
  try {
    prefix = execFileSync("npm", ["config", "get", "prefix"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }

  if (!prefix) return null;

  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({ prefix, fetchedAt: Date.now() } satisfies PrefixCacheEntry)
    );
  } catch {
    // Cache write failure is non-fatal.
  }

  return prefix;
}

export interface CheckGlobalInstallOptions {
  scriptPath?: string;
  getPrefix?: () => string | null;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
  exit?: (code: number) => never;
}

/**
 * Check how this CLI was installed and intervene based on what we find:
 *
 * 1. If the running binary lives under the npm global prefix → **hard block**.
 *    Global installs don't auto-update and cause silent version skew.
 * 2. If we're running from a project-local install BUT a global shiplightai
 *    also exists under the npm prefix → **warn** (non-blocking). The global
 *    install will shadow the local one on PATH and confuse users.
 * 3. Otherwise → no-op.
 */
export function checkGlobalInstall(opts: CheckGlobalInstallOptions = {}): void {
  const scriptPath = opts.scriptPath ?? process.argv[1];
  const getPrefix = opts.getPrefix ?? (() => getNpmPrefix());
  const warn = opts.warn ?? ((msg: string) => console.warn(msg));
  const errorFn = opts.error ?? ((msg: string) => console.error(msg));
  const exitFn = opts.exit ?? ((code: number) => process.exit(code));

  try {
    if (!scriptPath) return;

    const globalPrefix = getPrefix();
    if (!globalPrefix) return;

    let realScript: string;
    let realPrefix: string;
    try {
      realScript = fs.realpathSync(scriptPath);
      realPrefix = fs.realpathSync(globalPrefix);
    } catch {
      return;
    }

    // Case 1: running from a global install → hard block.
    if (realScript.startsWith(realPrefix + path.sep)) {
      errorFn(
        "\nshiplightai cannot be run from a global install.\n" +
          "Global installs don't auto-update and cause version skew.\n\n" +
          "Install it as a project dependency instead:\n\n" +
          "  cd <your-project>\n" +
          "  npm i -D shiplightai\n" +
          "  npx shiplight <command>\n"
      );
      exitFn(1);
      return;
    }

    // Case 2: running locally but a global install coexists → warn.
    // npm installs global packages under <prefix>/lib/node_modules on Unix
    // and <prefix>/node_modules on Windows. Check both.
    const globalPkgUnix = path.join(realPrefix, "lib", "node_modules", "shiplightai");
    const globalPkgWin = path.join(realPrefix, "node_modules", "shiplightai");
    const globalPkgPath = fs.existsSync(globalPkgUnix)
      ? globalPkgUnix
      : fs.existsSync(globalPkgWin)
        ? globalPkgWin
        : null;

    if (globalPkgPath) {
      warn(
        `\n\x1b[33m⚠ A global shiplightai install was detected at ${globalPkgPath}.\n` +
          `  Global installs don't auto-update and can shadow the project-local CLI on PATH.\n` +
          `  Please remove it: npm uninstall -g shiplightai\x1b[0m\n`
      );
    }
  } catch {
    // Any unexpected error in detection — fail open, don't block.
  }
}

export function readCache(cacheFile: string = defaultCacheFile()): CacheEntry | null {
  try {
    const raw = fs.readFileSync(cacheFile, "utf-8");
    const parsed = JSON.parse(raw) as CacheEntry;
    if (
      typeof parsed.latest === "string" &&
      typeof parsed.fetchedAt === "number" &&
      Date.now() - parsed.fetchedAt < CACHE_TTL_MS
    ) {
      return parsed;
    }
  } catch {
    // Missing or malformed cache — ignore.
  }
  return null;
}

export function writeCache(
  entry: CacheEntry,
  cacheFile: string = defaultCacheFile()
): void {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(entry));
  } catch {
    // Cache write failure is non-fatal.
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

/**
 * Compare semver-ish strings. Returns true if `a` is strictly less than `b`.
 *
 * Parses dotted numeric components from the version core (before any `-`).
 * Per semver, a pre-release version is always less than its release version:
 * `1.0.0-beta.1 < 1.0.0`. We don't order between pre-releases of the same
 * core (`1.0.0-beta.1` vs `1.0.0-beta.2`) — returns false — which is fine
 * because the npm `latest` dist-tag never points at a pre-release, so the
 * only meaningful comparison we make is "running is on a pre-release, latest
 * is on a stable of the same or newer core."
 */
export function isBehind(a: string, b: string): boolean {
  const splitPre = (v: string): [string, boolean] => {
    const dash = v.indexOf("-");
    return dash === -1 ? [v, false] : [v.slice(0, dash), true];
  };
  const parse = (core: string) => core.split(".").map((p) => parseInt(p, 10) || 0);
  const [coreA, preA] = splitPre(a);
  const [coreB, preB] = splitPre(b);
  const pa = parse(coreA);
  const pb = parse(coreB);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai < bi) return true;
    if (ai > bi) return false;
  }
  // Cores are equal. A pre-release is less than its release.
  if (preA && !preB) return true;
  return false;
}

export interface CheckVersionOptions {
  runningVersion?: string;
  cwd?: string;
  cacheFile?: string;
  fetchLatest?: () => Promise<string | null>;
  env?: NodeJS.ProcessEnv;
  warn?: (msg: string) => void;
}

/**
 * Check for a newer published version and print a warning if one exists.
 * Non-blocking, best-effort, silent on failure.
 */
export async function checkVersionFreshness(
  opts: CheckVersionOptions = {}
): Promise<void> {
  const runningVersion = opts.runningVersion ?? RUNNING_VERSION;
  const cwd = opts.cwd ?? process.cwd();
  const cacheFile = opts.cacheFile ?? defaultCacheFile();
  const fetchLatest = opts.fetchLatest ?? fetchLatestVersion;
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? ((msg: string) => console.warn(msg));

  // Suppress in CI — reproducible builds don't benefit from the nag.
  if (env.CI) return;

  // Skip if running a dev build (no version injected).
  if (runningVersion === "dev") return;

  // Only warn for projects using npm (detect via lockfile). Scaffold is npm-only.
  if (!fs.existsSync(path.join(cwd, "package-lock.json"))) return;

  let latest: string | null = null;
  const cached = readCache(cacheFile);
  if (cached) {
    latest = cached.latest;
  } else {
    try {
      latest = await fetchLatest();
    } catch {
      latest = null;
    }
    if (latest) {
      writeCache({ latest, fetchedAt: Date.now() }, cacheFile);
    }
  }

  if (!latest) return;
  if (!isBehind(runningVersion, latest)) return;

  warn(
    `\n\x1b[33m⚠ shiplightai ${latest} is available (you have ${runningVersion}).\n` +
      `  Run: npm update shiplightai\x1b[0m\n`
  );
}
