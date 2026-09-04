/**
 * The file path a statement UID is derived from.
 *
 * UIDs used to hash the ABSOLUTE path of the test file, which made them machine-specific:
 * the same statement keyed differently on a developer's laptop and in CI, so a shared
 * action-entity cache could be fully populated and still miss every lookup. The store's
 * own key is already machine-independent — branch plus the path relative to the repo root
 * — so the entry keys inside it were the only part that could not travel.
 *
 * Two properties matter and both are easy to lose:
 *
 * - REPO-RELATIVE, so a different checkout location is not a different statement. Repo and
 *   branch are deliberately NOT included: the store key already carries both, and a
 *   branch-dependent UID would additionally wipe a developer's local cache on every branch
 *   switch, since the local store key has no branch in it.
 * - POSIX SEPARATORS, so a Windows runner and a Linux runner in the same matrix agree.
 *   Without this the relative path alone still forks the cache per operating system.
 *
 * Derived here rather than at the CLI's call site on purpose. `shiplight test`,
 * `shiplight debug` and the MCP server all parse the same files; if only one of them
 * relativised, their UIDs would diverge and heals recorded by one would stop applying in
 * the others — trading a cross-machine bug for a cross-command one.
 */

import { existsSync } from 'fs';
import { dirname, isAbsolute, join, relative } from 'path';

/** Directory → containing repo root (or null when there is none). */
const repoRootCache = new Map<string, string | null>();

/**
 * Nearest ancestor containing a `.git` entry, or null.
 *
 * Tests for `.git` as an ENTRY, not a directory: in a git worktree it is a file pointing
 * back at the main repository, and a worktree root is exactly the anchor we want — it is
 * what `git rev-parse --show-toplevel` reports there too. Walking up also matches git's own
 * resolution for nested repositories and submodules: the nearest root wins.
 *
 * Memoised per directory, since this runs once per statement across every file in a run.
 */
function findRepoRoot(startDir: string): string | null {
  const visited: string[] = [];
  let dir = startDir;

  for (;;) {
    const cached = repoRootCache.get(dir);
    if (cached !== undefined) {
      for (const d of visited) repoRootCache.set(d, cached);
      return cached;
    }
    visited.push(dir);

    if (existsSync(join(dir, '.git'))) {
      for (const d of visited) repoRootCache.set(d, dir);
      return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      // Filesystem root reached without finding a repository.
      for (const d of visited) repoRootCache.set(d, null);
      return null;
    }
    dir = parent;
  }
}

/** Normalise both separator conventions to `/`. */
function toPosix(p: string): string {
  return p.split(/[\\/]/).join('/');
}

/**
 * The identity form of a test file's path, for hashing into statement UIDs.
 *
 * Falls back to the path as given when there is no repository — a single-directory scratch
 * project still needs stable UIDs, and it has no cross-machine cache to share anyway.
 */
export function repoRelativeIdentityPath(filePath: string): string {
  if (!isAbsolute(filePath)) return toPosix(filePath);
  const root = findRepoRoot(dirname(filePath));
  return toPosix(root ? relative(root, filePath) : filePath);
}

/** Test-only: drop the memoised roots, so a fixture can add or remove a `.git`. */
export function __resetRepoRootCache(): void {
  repoRootCache.clear();
}
