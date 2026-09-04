/**
 * Persistence for the file tree's expanded directories.
 *
 * The debugger always serves on http://localhost:6174, so every project the
 * user opens shares one localStorage bucket. Storing absolute paths under a
 * single key therefore leaked state across projects: launching the debugger in
 * one directory re-fetched directories expanded in a sibling project, making
 * the server scan (or ENOENT on) paths outside the current project root.
 *
 * The fix is two-part and both halves matter:
 *   - the key is scoped by project root, so two projects never share an entry;
 *   - the values are stored RELATIVE to that root, and any entry with a "..", "."
 *     or empty segment is rejected on read, so a stored entry cannot name a path
 *     outside the project even if storage is hand-edited.
 *
 * Separators: the CLI's /api/files route builds its paths with `path.resolve` /
 * `path.join`, so they arrive "/"-separated on macOS and Linux but
 * "\\"-separated on Windows. Every comparison here is therefore done on a
 * "/"-normalised copy, and stored entries are always written with "/" so a
 * profile is portable. Paths handed BACK to the caller are rebuilt with the
 * root's own separator, because the tree matches them against the raw
 * `entry.path` values the route returned.
 */

const KEY_PREFIX = "shp-debugger-expanded-dirs:";

/**
 * The pre-fix key: one shared entry holding absolute paths from every project.
 * Read once for migration, then deleted — see `migrateLegacyExpandedPaths`.
 */
export const LEGACY_EXPANDED_DIRS_KEY = "shp-debugger-expanded-dirs";

/** The subset of the Storage interface this module uses (injectable for tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Access can throw when cookies/storage are blocked.
    return null;
  }
}

/** Rewrite Windows separators so every comparison in this module is done on one shape. */
function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * The separator to rebuild absolute paths with. Taken from the root the caller
 * passed, because that root came from the same `path.join`/`path.resolve` calls
 * as the paths it will be compared against.
 */
function separatorOf(rootDir: string): string {
  return rootDir.includes("\\") ? "\\" : "/";
}

/**
 * Strip trailing separators so "/a/b" and "/a/b/" resolve to the same key.
 * Handles "\\" too: on Windows a root of "C:\\proj\\" must key the same bucket
 * as "C:\\proj", and the drive root "C:\\" must not become an empty string.
 */
function normalizeRoot(rootDir: string): string {
  const trimmed = rootDir.replace(/[/\\]+$/, "");
  return trimmed.length > 0 ? trimmed : "/";
}

/**
 * localStorage key for one project root, normalised to "/" so the same project
 * keys the same bucket no matter which separator shape reached us.
 */
export function expandedDirsKey(rootDir: string): string {
  return KEY_PREFIX + toPosix(normalizeRoot(rootDir));
}

/**
 * A relative entry is only usable if every segment is an ordinary name. A ".."
 * segment would resolve back out of the root, which is exactly what the scoping
 * is there to prevent — round-tripping through `saveExpandedPaths` can never
 * produce one, but hand-edited or injected storage can.
 */
function isSafeRelativePath(rel: string): boolean {
  if (rel.length === 0 || rel.startsWith("/")) return false;
  return !rel.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

/**
 * Path of `absPath` relative to `rootDir`, or null when it is not strictly
 * inside the root. Comparing against `root + "/"` is what keeps a sibling
 * directory whose name merely starts with the root string (e.g. root
 * "/w/demo" vs "/w/demo-old/tests") from being treated as inside it; the
 * segment check then rejects anything that would climb back out via "..".
 */
export function toRelative(rootDir: string, absPath: string): string | null {
  const root = toPosix(normalizeRoot(rootDir));
  const prefix = root === "/" ? "/" : root + "/";
  const abs = toPosix(absPath);
  if (!abs.startsWith(prefix)) return null;
  const rel = abs.slice(prefix.length);
  return isSafeRelativePath(rel) ? rel : null;
}

/**
 * Absolute path for a stored relative entry, rebuilt with the ROOT's separator.
 *
 * Stored entries are always "/"-separated, but the tree compares what it gets
 * back here against the raw paths /api/files returned — "\\"-separated on
 * Windows. Handing back a "/" form there would make every lookup miss.
 */
export function toAbsolute(rootDir: string, relPath: string): string {
  const sep = separatorOf(rootDir);
  const root = normalizeRoot(rootDir);
  const rel = sep === "/" ? relPath : relPath.split("/").join(sep);
  return toPosix(root) === "/" ? sep + rel : root + sep + rel;
}

function readStringArray(storage: StorageLike, key: string): string[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

/** Stored entries for a scoped key, dropping anything that is not a safe relative path. */
function readRelativeEntries(storage: StorageLike, key: string): string[] {
  return readStringArray(storage, key).filter(isSafeRelativePath);
}

/**
 * Restore the expanded directories for one project root, as absolute paths.
 *
 * READ-ONLY: it touches no storage key, which is what makes it safe to call
 * during render. Every returned path is guaranteed to be inside `rootDir`.
 *
 * The legacy shared key is NOT consulted here — see
 * `migrateLegacyExpandedPaths`, which must run from an effect.
 */
export function loadExpandedPaths(
  rootDir: string,
  storage: StorageLike | null = defaultStorage(),
): Set<string> {
  const paths = new Set<string>();
  if (!storage) return paths;

  // `rootDir`, not a normalised copy: normalisation strips the trailing
  // separator, which for a drive root ("C:\\") is the only separator there is —
  // and that is what `toAbsolute` reads to decide the shape to rebuild.
  for (const rel of readRelativeEntries(storage, expandedDirsKey(rootDir))) {
    paths.add(toAbsolute(rootDir, rel));
  }
  return paths;
}

/**
 * Fold the pre-fix shared key into this root's scoped entry, then delete it.
 *
 * Only the entries belonging to `rootDir` are kept; the key is deleted either
 * way, so the cross-project leak cannot come back. Other projects lose their
 * pre-fix expansion state once — they rebuild it under their own scoped key on
 * the next expand.
 *
 * Split out of `loadExpandedPaths` because it MUTATES storage, and the caller
 * seeds its set during render. React may discard a render before commit
 * (concurrent rendering, an unmount mid-render); if the one-shot migration ran
 * there, the shared key would already be read and deleted, and the upgrading
 * user's expansion state would be gone with nothing committed to show for it.
 * Call it from an effect and merge the result back in.
 */
export function migrateLegacyExpandedPaths(
  rootDir: string,
  current: Iterable<string> = [],
  storage: StorageLike | null = defaultStorage(),
): Set<string> {
  const paths = new Set<string>(current);
  if (!storage) return paths;

  const legacy = readStringArray(storage, LEGACY_EXPANDED_DIRS_KEY);
  for (const abs of legacy) {
    const rel = toRelative(rootDir, abs);
    if (rel !== null) paths.add(toAbsolute(rootDir, rel));
  }
  try {
    storage.removeItem(LEGACY_EXPANDED_DIRS_KEY);
  } catch {
    // ignore — migration is best-effort
  }
  if (legacy.length > 0) saveExpandedPaths(rootDir, paths, storage);

  return paths;
}

/** Persist the expanded directories for one project root. Out-of-root paths are dropped. */
export function saveExpandedPaths(
  rootDir: string,
  paths: Iterable<string>,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  const relative: string[] = [];
  for (const abs of paths) {
    const rel = toRelative(rootDir, abs);
    if (rel !== null) relative.push(rel);
  }
  try {
    storage.setItem(expandedDirsKey(rootDir), JSON.stringify(relative));
  } catch {
    // ignore quota errors
  }
}

/** Mark a directory expanded. */
export function addExpandedPath(paths: Set<string>, dirPath: string): void {
  paths.add(dirPath);
}

/**
 * Mark a directory collapsed, dropping its descendants along with it.
 *
 * Descendant matching is done on "/"-normalised copies: on Windows the stored
 * paths are "\\"-separated, so a "/" prefix matched nothing and collapsing a
 * directory left every child of it behind in the set.
 */
export function removeExpandedPath(paths: Set<string>, dirPath: string): void {
  paths.delete(dirPath);
  const prefix = toPosix(dirPath) + "/";
  for (const p of paths) {
    if (toPosix(p).startsWith(prefix)) paths.delete(p);
  }
}

/**
 * Re-key an in-memory set when the server resolves the tree root to a different
 * path than the one the component mounted with (symlink, trailing slash).
 *
 * Entries already toggled by the user during the initial load are kept — dropping
 * them would let a click made while the tree was rendering overwrite the whole
 * stored list — but only those that are inside the new root.
 */
export function rekeyExpandedPaths(
  nextRoot: string,
  current: Iterable<string>,
  storage: StorageLike | null = defaultStorage(),
): Set<string> {
  const paths = loadExpandedPaths(nextRoot, storage);
  for (const abs of current) {
    if (toRelative(nextRoot, abs) !== null) paths.add(abs);
  }
  return paths;
}
