import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";
import {
  isBehind,
  readCache,
  writeCache,
  checkVersionFreshness,
  checkGlobalInstall,
} from "./versionCheck.js";

describe("isBehind", () => {
  it("returns true when a is an earlier patch", () => {
    assert.equal(isBehind("0.1.46", "0.1.47"), true);
  });

  it("returns false when versions are equal", () => {
    assert.equal(isBehind("0.1.47", "0.1.47"), false);
  });

  it("returns false when a is ahead", () => {
    assert.equal(isBehind("0.1.48", "0.1.47"), false);
  });

  it("compares numerically, not lexicographically", () => {
    assert.equal(isBehind("0.1.9", "0.1.10"), true);
    assert.equal(isBehind("0.1.10", "0.1.9"), false);
    assert.equal(isBehind("0.2.0", "0.10.0"), true);
  });

  it("handles minor and major bumps", () => {
    assert.equal(isBehind("0.1.99", "0.2.0"), true);
    assert.equal(isBehind("0.9.0", "1.0.0"), true);
    assert.equal(isBehind("1.0.0", "0.9.99"), false);
  });

  it("treats a pre-release as less than its release", () => {
    // Per semver: 1.0.0-beta.1 < 1.0.0
    assert.equal(isBehind("1.0.0-beta.1", "1.0.0"), true);
    // The stable is not behind the beta
    assert.equal(isBehind("1.0.0", "1.0.0-beta.1"), false);
    // Beta of a newer core is still ahead of an older stable
    assert.equal(isBehind("1.0.0", "1.1.0-beta.1"), true);
  });

  it("handles short version strings", () => {
    assert.equal(isBehind("1", "1.0.1"), true);
    assert.equal(isBehind("1.0.1", "1"), false);
  });
});

describe("cache round-trip", () => {
  const dirsToClean: string[] = [];
  afterEach(() => {
    for (const d of dirsToClean) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {}
    }
    dirsToClean.length = 0;
  });

  function tmpCacheFile(): string {
    const dir = mkdtempSync(join(tmpdir(), "shiplight-cache-"));
    dirsToClean.push(dir);
    return join(dir, "nested", "version-check.json");
  }

  it("writes and reads a fresh entry", () => {
    const file = tmpCacheFile();
    writeCache({ latest: "0.1.47", fetchedAt: Date.now() }, file);
    const got = readCache(file);
    assert.ok(got);
    assert.equal(got!.latest, "0.1.47");
  });

  it("creates parent directories on write", () => {
    const file = tmpCacheFile();
    writeCache({ latest: "1.0.0", fetchedAt: Date.now() }, file);
    assert.ok(existsSync(file));
  });

  it("returns null when entry is older than TTL", () => {
    const file = tmpCacheFile();
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    writeCache({ latest: "0.1.47", fetchedAt: twoHoursAgo }, file);
    assert.equal(readCache(file), null);
  });

  it("returns null for missing file", () => {
    const file = tmpCacheFile();
    assert.equal(readCache(file), null);
  });

  it("returns null for malformed JSON", () => {
    const file = tmpCacheFile();
    writeCache({ latest: "0.1.47", fetchedAt: Date.now() }, file);
    writeFileSync(file, "not json");
    assert.equal(readCache(file), null);
  });

  it("returns null when required fields are missing", () => {
    const file = tmpCacheFile();
    writeCache({ latest: "0.1.47", fetchedAt: Date.now() }, file);
    writeFileSync(file, JSON.stringify({ latest: "0.1.47" }));
    assert.equal(readCache(file), null);
  });
});

describe("checkVersionFreshness", () => {
  const dirsToClean: string[] = [];
  afterEach(() => {
    for (const d of dirsToClean) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {}
    }
    dirsToClean.length = 0;
  });

  function makeProject(withLockfile: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), "shiplight-proj-"));
    dirsToClean.push(dir);
    if (withLockfile) {
      writeFileSync(join(dir, "package-lock.json"), "{}");
    }
    return dir;
  }

  function tmpCacheFile(): string {
    const dir = mkdtempSync(join(tmpdir(), "shiplight-cache-"));
    dirsToClean.push(dir);
    return join(dir, "version-check.json");
  }

  function captureWarn() {
    const calls: string[] = [];
    return { warn: (m: string) => calls.push(m), calls };
  }

  it("prints a warning when running version is behind latest", async () => {
    const cwd = makeProject(true);
    const cacheFile = tmpCacheFile();
    const { warn, calls } = captureWarn();
    let fetchCount = 0;

    await checkVersionFreshness({
      runningVersion: "0.1.40",
      cwd,
      cacheFile,
      fetchLatest: async () => {
        fetchCount++;
        return "0.1.47";
      },
      env: {},
      warn,
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /0\.1\.47/);
    assert.match(calls[0]!, /0\.1\.40/);
    assert.match(calls[0]!, /npm update shiplightai/);
    assert.equal(fetchCount, 1);
    // Fetched result should be cached
    assert.ok(existsSync(cacheFile));
  });

  it("does not warn when running version equals latest", async () => {
    const cwd = makeProject(true);
    const { warn, calls } = captureWarn();

    await checkVersionFreshness({
      runningVersion: "0.1.47",
      cwd,
      cacheFile: tmpCacheFile(),
      fetchLatest: async () => "0.1.47",
      env: {},
      warn,
    });

    assert.equal(calls.length, 0);
  });

  it("does not warn when running version is ahead of latest", async () => {
    const cwd = makeProject(true);
    const { warn, calls } = captureWarn();

    await checkVersionFreshness({
      runningVersion: "0.1.48",
      cwd,
      cacheFile: tmpCacheFile(),
      fetchLatest: async () => "0.1.47",
      env: {},
      warn,
    });

    assert.equal(calls.length, 0);
  });

  it("is suppressed when CI=true", async () => {
    const cwd = makeProject(true);
    const { warn, calls } = captureWarn();
    let fetched = false;

    await checkVersionFreshness({
      runningVersion: "0.1.40",
      cwd,
      cacheFile: tmpCacheFile(),
      fetchLatest: async () => {
        fetched = true;
        return "0.1.47";
      },
      env: { CI: "true" },
      warn,
    });

    assert.equal(calls.length, 0);
    assert.equal(fetched, false, "should not fetch in CI");
  });

  it("is suppressed for dev builds", async () => {
    const cwd = makeProject(true);
    const { warn, calls } = captureWarn();
    let fetched = false;

    await checkVersionFreshness({
      runningVersion: "dev",
      cwd,
      cacheFile: tmpCacheFile(),
      fetchLatest: async () => {
        fetched = true;
        return "0.1.47";
      },
      env: {},
      warn,
    });

    assert.equal(calls.length, 0);
    assert.equal(fetched, false);
  });

  it("skips the check when no package-lock.json is present", async () => {
    const cwd = makeProject(false);
    const { warn, calls } = captureWarn();
    let fetched = false;

    await checkVersionFreshness({
      runningVersion: "0.1.40",
      cwd,
      cacheFile: tmpCacheFile(),
      fetchLatest: async () => {
        fetched = true;
        return "0.1.47";
      },
      env: {},
      warn,
    });

    assert.equal(calls.length, 0);
    assert.equal(fetched, false, "should not fetch without lockfile");
  });

  it("silently skips when fetch returns null", async () => {
    const cwd = makeProject(true);
    const { warn, calls } = captureWarn();

    await checkVersionFreshness({
      runningVersion: "0.1.40",
      cwd,
      cacheFile: tmpCacheFile(),
      fetchLatest: async () => null,
      env: {},
      warn,
    });

    assert.equal(calls.length, 0);
  });

  it("silently skips when fetch throws", async () => {
    const cwd = makeProject(true);
    const { warn, calls } = captureWarn();

    await checkVersionFreshness({
      runningVersion: "0.1.40",
      cwd,
      cacheFile: tmpCacheFile(),
      fetchLatest: async () => {
        throw new Error("network down");
      },
      env: {},
      warn,
    });

    assert.equal(calls.length, 0);
  });

  it("uses cache when fresh, skipping fetch entirely", async () => {
    const cwd = makeProject(true);
    const cacheFile = tmpCacheFile();
    writeCache({ latest: "0.1.47", fetchedAt: Date.now() }, cacheFile);

    const { warn, calls } = captureWarn();
    let fetched = false;

    await checkVersionFreshness({
      runningVersion: "0.1.40",
      cwd,
      cacheFile,
      fetchLatest: async () => {
        fetched = true;
        return "0.1.99";
      },
      env: {},
      warn,
    });

    assert.equal(fetched, false, "fresh cache should skip fetch");
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /0\.1\.47/, "should warn using cached latest");
  });

  it("re-fetches when cache is stale", async () => {
    const cwd = makeProject(true);
    const cacheFile = tmpCacheFile();
    writeCache(
      { latest: "0.1.47", fetchedAt: Date.now() - 2 * 60 * 60 * 1000 },
      cacheFile
    );

    let fetched = false;
    const { warn, calls } = captureWarn();

    await checkVersionFreshness({
      runningVersion: "0.1.40",
      cwd,
      cacheFile,
      fetchLatest: async () => {
        fetched = true;
        return "0.1.99";
      },
      env: {},
      warn,
    });

    assert.equal(fetched, true, "stale cache should trigger refetch");
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /0\.1\.99/);
    // Cache should have been refreshed
    const refreshed = JSON.parse(readFileSync(cacheFile, "utf-8"));
    assert.equal(refreshed.latest, "0.1.99");
  });
});

describe("checkGlobalInstall", () => {
  const dirsToClean: string[] = [];
  afterEach(() => {
    for (const d of dirsToClean) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {}
    }
    dirsToClean.length = 0;
  });

  function makeFakePrefix(withGlobalPkg: boolean): string {
    const prefix = mkdtempSync(join(tmpdir(), "shiplight-prefix-"));
    dirsToClean.push(prefix);
    // Create a fake "bin" dir so realpathSync succeeds
    mkdirSync(join(prefix, "bin"), { recursive: true });
    if (withGlobalPkg) {
      mkdirSync(join(prefix, "lib", "node_modules", "shiplightai"), {
        recursive: true,
      });
    }
    return prefix;
  }

  function makeLocalScript(): string {
    const dir = mkdtempSync(join(tmpdir(), "shiplight-local-"));
    dirsToClean.push(dir);
    const binDir = join(dir, "project", "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    const script = join(binDir, "shiplight");
    writeFileSync(script, "#!/usr/bin/env node\n");
    return script;
  }

  function capture() {
    const warnings: string[] = [];
    const errors: string[] = [];
    let exitCode: number | null = null;
    return {
      warnings,
      errors,
      get exitCode() {
        return exitCode;
      },
      opts: {
        warn: (m: string) => warnings.push(m),
        error: (m: string) => errors.push(m),
        exit: ((code: number) => {
          exitCode = code;
          // Don't actually exit in tests; return a never-typed value via throw-less cast.
          return undefined as never;
        }) as (code: number) => never,
      },
    };
  }

  it("hard-blocks when running from a global install", () => {
    const prefix = makeFakePrefix(false);
    // Create a "bin/shiplight" script under the prefix to simulate a global install path.
    const globalBin = join(prefix, "bin", "shiplight");
    writeFileSync(globalBin, "#!/usr/bin/env node\n");

    const cap = capture();
    checkGlobalInstall({
      scriptPath: globalBin,
      getPrefix: () => prefix,
      ...cap.opts,
    });

    assert.equal(cap.exitCode, 1, "should exit 1 when running from global");
    assert.equal(cap.errors.length, 1);
    assert.match(cap.errors[0]!, /global install/i);
    assert.match(cap.errors[0]!, /npm i -D shiplightai/);
    assert.equal(cap.warnings.length, 0);
  });

  it("warns when running locally but a global install also exists", () => {
    const prefix = makeFakePrefix(true); // with global shiplightai present
    const localScript = makeLocalScript();

    const cap = capture();
    checkGlobalInstall({
      scriptPath: localScript,
      getPrefix: () => prefix,
      ...cap.opts,
    });

    assert.equal(cap.exitCode, null, "should not exit");
    assert.equal(cap.errors.length, 0);
    assert.equal(cap.warnings.length, 1);
    assert.match(cap.warnings[0]!, /global shiplightai install was detected/);
    assert.match(cap.warnings[0]!, /npm uninstall -g shiplightai/);
  });

  it("is silent when running locally with no coexisting global install", () => {
    const prefix = makeFakePrefix(false); // no global package
    const localScript = makeLocalScript();

    const cap = capture();
    checkGlobalInstall({
      scriptPath: localScript,
      getPrefix: () => prefix,
      ...cap.opts,
    });

    assert.equal(cap.exitCode, null);
    assert.equal(cap.errors.length, 0);
    assert.equal(cap.warnings.length, 0);
  });

  it("is silent when npm prefix lookup fails", () => {
    const localScript = makeLocalScript();
    const cap = capture();

    checkGlobalInstall({
      scriptPath: localScript,
      getPrefix: () => null,
      ...cap.opts,
    });

    assert.equal(cap.exitCode, null);
    assert.equal(cap.errors.length, 0);
    assert.equal(cap.warnings.length, 0);
  });

  it("is silent when script path is missing", () => {
    const prefix = makeFakePrefix(true);
    const cap = capture();

    checkGlobalInstall({
      scriptPath: "",
      getPrefix: () => prefix,
      ...cap.opts,
    });

    assert.equal(cap.exitCode, null);
    assert.equal(cap.warnings.length, 0);
    assert.equal(cap.errors.length, 0);
  });
});
