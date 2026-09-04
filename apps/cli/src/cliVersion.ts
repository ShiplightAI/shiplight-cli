/**
 * The running `shiplightai` version.
 *
 * `TRANSPILER_VERSION` is not usable for this: it resolves to the literal
 * string `'dev'` outside a tsup build, and a scaffolded project pinning
 * `"shiplightai": "^dev"` is uninstallable. This module resolves a real
 * version in all three contexts a command can run in:
 *
 *   - published install (dist/cli.js inside node_modules/shiplightai)
 *   - local build       (apps/cli/dist/cli.js)
 *   - source checkout   (apps/cli/src/**, via tsx)
 *
 * It walks up from the calling module looking for this package's own
 * package.json rather than assuming a fixed depth, because that depth differs
 * between the bundle (dist/cli.js -> ../package.json) and source
 * (src/commands/create.ts -> ../../package.json).
 */

import { existsSync, readFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

/** This package's npm name — the marker that identifies the right package.json. */
export const CLI_PACKAGE_NAME = "shiplightai";

/**
 * Walk up from `startDir` looking for this package's package.json.
 *
 * Exported for testing. Matches on `name` so that a scaffolded project's own
 * package.json — or any unrelated one in an ancestor directory — can never be
 * mistaken for ours and hand back somebody else's version number. Returns the
 * already-parsed version alongside the path so callers never re-read the file
 * (a second read would reopen a tiny TOCTOU window for no benefit).
 */
export function findOwnPackageJson(
  startDir: string,
): { path: string; version: string } | null {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf-8"));
        if (parsed?.name === CLI_PACKAGE_NAME && typeof parsed.version === "string") {
          return { path: candidate, version: parsed.version };
        }
      } catch {
        // Unreadable or malformed — keep walking rather than giving up. A
        // broken package.json in an ancestor must not mask ours further up.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the running version, or throw with an actionable message.
 *
 * Throws rather than returning a placeholder: every caller writes this value
 * somewhere durable (a scaffolded package.json, a generated spec header), and
 * a placeholder there is a defect that surfaces long after the fact — which is
 * exactly how `"latest"` survived unnoticed for so many releases.
 */
export function resolveCliVersion(fromDir?: string): string {
  const startDir = fromDir ?? path.dirname(fileURLToPath(import.meta.url));
  const found = findOwnPackageJson(startDir);
  if (!found) {
    throw new Error(
      `Could not determine the running ${CLI_PACKAGE_NAME} version: no ${CLI_PACKAGE_NAME} package.json found above ${startDir}.`,
    );
  }
  return found.version;
}
