// Regression coverage for the cross-project file-tree leak.
//
// The debugger always serves on http://localhost:6174, so every project shares
// one localStorage bucket. The original implementation stored ABSOLUTE paths
// under a single unscoped key, so launching `shiplight debug` in project A
// re-fetched directories that had been expanded in project B — the server
// happily scanned them (or logged ENOENT when they no longer existed).
//
// These tests pin the fix: storage is keyed per project root and holds paths
// RELATIVE to that root, so a saved path can never name another project.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_EXPANDED_DIRS_KEY,
  addExpandedPath,
  expandedDirsKey,
  loadExpandedPaths,
  migrateLegacyExpandedPaths,
  rekeyExpandedPaths,
  removeExpandedPath,
  saveExpandedPaths,
  toRelative,
  type StorageLike,
} from "./expandedDirs";

class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();
  throwOnSet = false;

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    if (this.throwOnSet) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const AIRBNB = "/home/dev/projects/airbnb-demo";
const HEYGEN = "/home/dev/projects/heygen-test";

describe("expandedDirs — cross-project isolation", () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
  });

  it("does not return directories expanded in a sibling project", () => {
    saveExpandedPaths(HEYGEN, [`${HEYGEN}/tests`, `${HEYGEN}/tests/auth`], storage);

    const restored = loadExpandedPaths(AIRBNB, storage);

    assert.deepEqual([...restored], []);
  });

  it("keeps each project's expanded set independent", () => {
    saveExpandedPaths(HEYGEN, [`${HEYGEN}/tests`], storage);
    saveExpandedPaths(AIRBNB, [`${AIRBNB}/tests`], storage);

    assert.deepEqual([...loadExpandedPaths(HEYGEN, storage)], [`${HEYGEN}/tests`]);
    assert.deepEqual([...loadExpandedPaths(AIRBNB, storage)], [`${AIRBNB}/tests`]);
  });

  it("stores paths relative to the root, never absolute", () => {
    saveExpandedPaths(AIRBNB, [`${AIRBNB}/tests`, `${AIRBNB}/tests/auth`], storage);

    const raw = storage.getItem(expandedDirsKey(AIRBNB));
    assert.deepEqual(JSON.parse(raw as string), ["tests", "tests/auth"]);
    assert.ok(!(raw as string).includes(AIRBNB), "stored value must not contain the absolute root");
  });

  it("round-trips absolute paths through relative storage", () => {
    const paths = [`${AIRBNB}/tests`, `${AIRBNB}/tests/auth`, `${AIRBNB}/e2e`];
    saveExpandedPaths(AIRBNB, paths, storage);

    assert.deepEqual([...loadExpandedPaths(AIRBNB, storage)].sort(), [...paths].sort());
  });

  it("drops out-of-root paths at save time", () => {
    saveExpandedPaths(AIRBNB, [`${AIRBNB}/tests`, `${HEYGEN}/tests`, "/etc"], storage);

    assert.deepEqual(JSON.parse(storage.getItem(expandedDirsKey(AIRBNB)) as string), ["tests"]);
  });

  it("treats a sibling directory sharing the root's name prefix as out of root", () => {
    // "/home/dev/projects/airbnb-demo-old" starts with the root string but
    // is a different project — a naive startsWith check would let it through.
    saveExpandedPaths(AIRBNB, [`${AIRBNB}-old/tests`], storage);

    assert.deepEqual(JSON.parse(storage.getItem(expandedDirsKey(AIRBNB)) as string), []);
  });

  it("scopes the storage key by root so two projects cannot collide", () => {
    assert.notEqual(expandedDirsKey(AIRBNB), expandedDirsKey(HEYGEN));
    assert.ok(expandedDirsKey(AIRBNB).includes(AIRBNB));
  });

  it("normalizes a trailing slash on the root", () => {
    saveExpandedPaths(`${AIRBNB}/`, [`${AIRBNB}/tests`], storage);

    assert.equal(expandedDirsKey(`${AIRBNB}/`), expandedDirsKey(AIRBNB));
    assert.deepEqual([...loadExpandedPaths(AIRBNB, storage)], [`${AIRBNB}/tests`]);
  });

  it("handles a filesystem root without doubling the separator", () => {
    saveExpandedPaths("/", ["/tests"], storage);

    assert.deepEqual(JSON.parse(storage.getItem(expandedDirsKey("/")) as string), ["tests"]);
    assert.deepEqual([...loadExpandedPaths("/", storage)], ["/tests"]);
  });
});

describe("expandedDirs — legacy key migration", () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
  });

  it("migrates only the entries belonging to the current root", () => {
    storage.setItem(
      LEGACY_EXPANDED_DIRS_KEY,
      JSON.stringify([`${AIRBNB}/tests`, `${HEYGEN}/tests`, `${HEYGEN}/tests/auth`]),
    );

    const restored = migrateLegacyExpandedPaths(AIRBNB, [], storage);

    assert.deepEqual([...restored], [`${AIRBNB}/tests`]);
    assert.deepEqual(JSON.parse(storage.getItem(expandedDirsKey(AIRBNB)) as string), ["tests"]);
  });

  it("removes the shared legacy key so the leak cannot recur", () => {
    storage.setItem(LEGACY_EXPANDED_DIRS_KEY, JSON.stringify([`${HEYGEN}/tests`]));

    migrateLegacyExpandedPaths(AIRBNB, [], storage);

    assert.equal(storage.getItem(LEGACY_EXPANDED_DIRS_KEY), null);
  });

  it("merges legacy in-root entries with the set it is handed", () => {
    saveExpandedPaths(AIRBNB, [`${AIRBNB}/e2e`], storage);
    storage.setItem(LEGACY_EXPANDED_DIRS_KEY, JSON.stringify([`${AIRBNB}/tests`]));

    const seeded = loadExpandedPaths(AIRBNB, storage);
    const restored = migrateLegacyExpandedPaths(AIRBNB, seeded, storage);

    assert.deepEqual([...restored].sort(), [`${AIRBNB}/e2e`, `${AIRBNB}/tests`]);
  });

  it("loadExpandedPaths never mutates storage, so it is safe during render", () => {
    // Regression: the migration used to run inside loadExpandedPaths, which
    // FileTreePanel calls in its render body to seed the set. A render React
    // discarded before commit (concurrent rendering, unmount mid-render) would
    // consume and DELETE the shared legacy key with nothing committed, losing
    // the upgrading user's expanded directories for good.
    storage.setItem(LEGACY_EXPANDED_DIRS_KEY, JSON.stringify([`${AIRBNB}/tests`]));
    const before = new Map(storage.map);

    loadExpandedPaths(AIRBNB, storage);

    assert.deepEqual([...storage.map.entries()], [...before.entries()]);
    assert.equal(storage.getItem(LEGACY_EXPANDED_DIRS_KEY), JSON.stringify([`${AIRBNB}/tests`]));
  });
});

describe("expandedDirs — Windows separators", () => {
  // The CLI's /api/files route builds paths with path.resolve/path.join, so on
  // win32 everything this module sees is "\\"-separated. The first version
  // compared against `root + "/"`, so startsWith was always false: nothing was
  // ever stored and nothing was ever restored.
  const WIN_ROOT = "C:\\Users\\feng\\airbnb-demo";
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
  });

  it("round-trips a backslash path through relative storage", () => {
    saveExpandedPaths(WIN_ROOT, [`${WIN_ROOT}\\tests`], storage);

    assert.deepEqual([...loadExpandedPaths(WIN_ROOT, storage)], [`${WIN_ROOT}\\tests`]);
  });

  it("stores entries with forward slashes so a profile stays portable", () => {
    saveExpandedPaths(WIN_ROOT, [`${WIN_ROOT}\\tests\\auth`], storage);

    assert.deepEqual(JSON.parse(storage.getItem(expandedDirsKey(WIN_ROOT)) as string), ["tests/auth"]);
  });

  it("still rejects a sibling project that shares the root's name prefix", () => {
    assert.equal(toRelative(WIN_ROOT, "C:\\Users\\feng\\airbnb-demo-old\\tests"), null);
  });

  it("keys the same bucket for a trailing backslash", () => {
    assert.equal(expandedDirsKey(`${WIN_ROOT}\\`), expandedDirsKey(WIN_ROOT));
  });

  it("handles a drive root without doubling the separator", () => {
    saveExpandedPaths("C:\\", ["C:\\proj"], storage);

    assert.deepEqual([...loadExpandedPaths("C:\\", storage)], ["C:\\proj"]);
  });

  it("removeExpandedPath drops backslash-separated descendants", () => {
    // Same root cause as the storage bug: the descendant sweep built a "/" prefix,
    // so collapsing a directory on Windows left every child behind in the set.
    const paths = new Set([
      `${WIN_ROOT}\\tests`,
      `${WIN_ROOT}\\tests\\auth`,
      `${WIN_ROOT}\\e2e`,
    ]);

    removeExpandedPath(paths, `${WIN_ROOT}\\tests`);

    assert.deepEqual([...paths], [`${WIN_ROOT}\\e2e`]);
  });

  it("migrates legacy backslash entries belonging to this root", () => {
    storage.setItem(
      LEGACY_EXPANDED_DIRS_KEY,
      JSON.stringify([`${WIN_ROOT}\\tests`, "C:\\Users\\feng\\other\\tests"]),
    );

    const restored = migrateLegacyExpandedPaths(WIN_ROOT, [], storage);

    assert.deepEqual([...restored], [`${WIN_ROOT}\\tests`]);
  });
});

describe("expandedDirs — set helpers", () => {
  it("removeExpandedPath drops the directory and its descendants", () => {
    const set = new Set([
      `${AIRBNB}/tests`,
      `${AIRBNB}/tests/auth`,
      `${AIRBNB}/tests/auth/deep`,
      `${AIRBNB}/e2e`,
    ]);

    removeExpandedPath(set, `${AIRBNB}/tests`);

    assert.deepEqual([...set], [`${AIRBNB}/e2e`]);
  });

  it("removeExpandedPath keeps siblings whose name shares a prefix", () => {
    const set = new Set([`${AIRBNB}/tests`, `${AIRBNB}/tests2`]);

    removeExpandedPath(set, `${AIRBNB}/tests`);

    assert.deepEqual([...set], [`${AIRBNB}/tests2`]);
  });

  it("addExpandedPath adds the directory", () => {
    const set = new Set<string>();

    addExpandedPath(set, `${AIRBNB}/tests`);

    assert.deepEqual([...set], [`${AIRBNB}/tests`]);
  });
});

describe("expandedDirs — hostile storage", () => {
  it("returns an empty set when the stored JSON is corrupt", () => {
    const storage = new FakeStorage();
    storage.setItem(expandedDirsKey(AIRBNB), "{not json");

    assert.deepEqual([...loadExpandedPaths(AIRBNB, storage)], []);
  });

  it("returns an empty set when the stored JSON is not an array of strings", () => {
    const storage = new FakeStorage();
    storage.setItem(expandedDirsKey(AIRBNB), JSON.stringify({ tests: true }));

    assert.deepEqual([...loadExpandedPaths(AIRBNB, storage)], []);
  });

  it("swallows quota errors on save", () => {
    const storage = new FakeStorage();
    storage.throwOnSet = true;

    assert.doesNotThrow(() => saveExpandedPaths(AIRBNB, [`${AIRBNB}/tests`], storage));
  });

  it("is a no-op when no storage is available", () => {
    assert.deepEqual([...loadExpandedPaths(AIRBNB, null)], []);
    assert.doesNotThrow(() => saveExpandedPaths(AIRBNB, [`${AIRBNB}/tests`], null));
  });
});

describe("expandedDirs — path traversal", () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
  });

  it("ignores a stored entry that climbs out of the root with ..", () => {
    storage.setItem(expandedDirsKey(AIRBNB), JSON.stringify(["../heygen-test/tests", "tests"]));

    assert.deepEqual([...loadExpandedPaths(AIRBNB, storage)], [`${AIRBNB}/tests`]);
  });

  it("ignores stored entries with '.' or empty segments", () => {
    storage.setItem(expandedDirsKey(AIRBNB), JSON.stringify(["./tests", "tests//auth", "/tests"]));

    assert.deepEqual([...loadExpandedPaths(AIRBNB, storage)], []);
  });

  it("drops an absolute path that only reaches out of the root via ..", () => {
    saveExpandedPaths(AIRBNB, [`${AIRBNB}/../heygen-test/tests`], storage);

    assert.deepEqual(JSON.parse(storage.getItem(expandedDirsKey(AIRBNB)) as string), []);
  });

  it("does not migrate a legacy entry that traverses out of the root", () => {
    storage.setItem(
      LEGACY_EXPANDED_DIRS_KEY,
      JSON.stringify([`${AIRBNB}/../heygen-test/tests`, `${AIRBNB}/tests`]),
    );

    assert.deepEqual([...migrateLegacyExpandedPaths(AIRBNB, [], storage)], [`${AIRBNB}/tests`]);
  });
});

describe("expandedDirs — rekeyExpandedPaths", () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
  });

  it("keeps in-flight toggles instead of discarding them", () => {
    // Regression: the load effect used to REPLACE the ref with the stored set,
    // so a directory toggled while the tree was still loading was overwritten.
    saveExpandedPaths(AIRBNB, [`${AIRBNB}/tests`], storage);

    const merged = rekeyExpandedPaths(AIRBNB, [`${AIRBNB}/e2e`], storage);

    assert.deepEqual([...merged].sort(), [`${AIRBNB}/e2e`, `${AIRBNB}/tests`]);
  });

  it("drops in-flight entries that fall outside the resolved root", () => {
    const merged = rekeyExpandedPaths(AIRBNB, [`${HEYGEN}/tests`], storage);

    assert.deepEqual([...merged], []);
  });

  it("reads the stored set of the new root, not the old one", () => {
    saveExpandedPaths(HEYGEN, [`${HEYGEN}/tests`], storage);
    saveExpandedPaths(AIRBNB, [`${AIRBNB}/tests`], storage);

    assert.deepEqual([...rekeyExpandedPaths(AIRBNB, [], storage)], [`${AIRBNB}/tests`]);
  });
});
