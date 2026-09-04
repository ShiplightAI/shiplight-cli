/**
 * Build the current package's workspace dependencies before a local task runs.
 *
 * A package-level `pnpm test:unit` or `pnpm typecheck` resolves `sdk-core`,
 * `shiplight-types` and friends to their built `dist/`, never to their source.
 * A `dist/` left over from an older commit answers with the *old* behaviour, so
 * a test that asserts current behaviour fails — or, worse, passes — for reasons
 * unrelated to the change under test. That is a false result, not a finding.
 *
 * Seen in the wild: `apps/cli`'s "does not self-heal go_to_url" test failed
 * against a three-week-old `sdk-core/dist` whose inlined
 * `NON_SELF_HEALABLE_ACTIONS` predated `go_to_url` joining the list. The same
 * stale build made `tsc` claim `shiplight-types` had no `canActionSelfHeal`.
 *
 * `turbo run` already guarantees this — every test/typecheck task declares
 * `dependsOn: ["^build"]` — so the hook stands down when turbo is the caller
 * and only pays for itself on a direct `pnpm <task>` inside a package.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Turbo stamps this into every task it runs; its own `^build` already ran. */
const TURBO_TASK_ENV_VAR = "TURBO_HASH";

/** Escape hatch for a tight edit/run loop where you know the deps are current. */
const SKIP_ENV_VAR = "SHIPLIGHT_SKIP_DEP_BUILD";

/**
 * Values that mean "no". Without these, `SHIPLIGHT_SKIP_DEP_BUILD=0` would
 * *skip* the build — the opposite of what it says, silently reinstating the
 * stale-dist failure this script exists to prevent.
 */
const NEGATIVE_VALUES = new Set(["", "0", "false", "off", "no"]);

/**
 * Why this run should not build anything, or `null` to go ahead. Returning the
 * reason rather than a boolean keeps it printable and testable.
 */
export function skipReason(env: NodeJS.ProcessEnv): string | null {
  if (env[TURBO_TASK_ENV_VAR]) return "running under turbo, which already built ^deps";
  const skip = env[SKIP_ENV_VAR]?.trim().toLowerCase();
  if (skip !== undefined && !NEGATIVE_VALUES.has(skip)) return `${SKIP_ENV_VAR}=${skip}`;
  return null;
}

/**
 * Turbo filter for "this package's dependencies, but not the package itself".
 * The `^...` suffix is what excludes the package — plain `pkg...` would rebuild
 * it and, for anything whose build runs its own typecheck, loop back here.
 */
export function dependencyFilter(packageName: string): string {
  return `${packageName}^...`;
}

export function readPackageName(packageJsonPath = "package.json"): string {
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name?: string };
  if (!parsed.name) throw new Error(`${packageJsonPath} has no "name"`);
  return parsed.name;
}

export function main(env: NodeJS.ProcessEnv = process.env): void {
  const skip = skipReason(env);
  if (skip) return;

  // Cache hits are the normal case and cost about a second; keep them quiet so
  // the task's own output stays readable.
  execFileSync(
    "pnpm",
    ["turbo", "run", "build", "--filter", dependencyFilter(readPackageName()), "--output-logs=errors-only"],
    { stdio: "inherit" }
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
