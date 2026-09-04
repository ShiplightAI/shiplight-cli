import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach } from "node:test";
import { parseTranspileArgs, runTranspile } from "./transpile.js";

describe("parseTranspileArgs", () => {
  it("defaults to every YAML test when no glob is given", () => {
    assert.deepEqual(parseTranspileArgs([]), {
      pattern: "**/*.test.yaml",
      strict: false,
    });
  });

  it("does not mistake a leading --strict for the glob", () => {
    // Regression guard: reading args[0] would make the pattern "--strict",
    // which matches nothing, so the command would exit 0 while appearing to
    // have enforced the gate.
    assert.deepEqual(parseTranspileArgs(["--strict"]), {
      pattern: "**/*.test.yaml",
      strict: true,
    });
  });

  it("accepts the glob before the flag", () => {
    assert.deepEqual(parseTranspileArgs(["tests/login.test.yaml", "--strict"]), {
      pattern: "tests/login.test.yaml",
      strict: true,
    });
  });

  it("accepts the glob after the flag", () => {
    assert.deepEqual(parseTranspileArgs(["--strict", "tests/login.test.yaml"]), {
      pattern: "tests/login.test.yaml",
      strict: true,
    });
  });

  it("leaves strict off unless asked", () => {
    assert.equal(parseTranspileArgs(["tests/**/*.test.yaml"]).strict, false);
  });

  it("ignores unrelated flags when picking the glob", () => {
    assert.equal(
      parseTranspileArgs(["--some-future-flag", "tests/a.test.yaml"]).pattern,
      "tests/a.test.yaml",
    );
  });
});

describe("runTranspile verdict wiring", () => {
  // The measurement (isBelowCoverageThreshold) is unit-tested in
  // shiplight-types; these prove the VERDICT layer on top of it — the part
  // the deleted MCP validate_yaml_test envelope used to prove. Someone
  // reverting the strict check to `warnings.length > 0` (the heuristic the
  // code comment warns against) or dropping the escalation entirely must
  // fail here.
  const DRAFTY = [
    "name: drafty",
    "goal: Log in",
    "statements:",
    "  - intent: Click login",
    "  - intent: Type email",
    "  - intent: Submit",
    "    action: click",
    "    locator: \"getByRole('button')\"",
    "",
  ].join("\n");

  const ENRICHED = [
    "name: enriched",
    "goal: Log in",
    "statements:",
    "  - intent: Click login",
    "    action: click",
    "    locator: \"getByRole('button')\"",
    "",
  ].join("\n");

  function project(files: Record<string, string>): string {
    const dir = mkdtempSync(path.join(tmpdir(), "transpile-run-"));
    dirs.push(dir);
    mkdirSync(path.join(dir, "tests"), { recursive: true });
    for (const [rel, body] of Object.entries(files)) {
      writeFileSync(path.join(dir, rel), body);
    }
    return dir;
  }

  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function runIn(
    dir: string,
    args: string[],
  ): Promise<{ code: number; out: string }> {
    const prevCwd = process.cwd();
    const origLog = console.log;
    const origErr = console.error;
    let out = "";
    console.log = (...a: unknown[]) => { out += a.join(" ") + "\n"; };
    console.error = (...a: unknown[]) => { out += a.join(" ") + "\n"; };
    try {
      process.chdir(dir);
      const code = await runTranspile(args);
      return { code, out };
    } finally {
      process.chdir(prevCwd);
      console.log = origLog;
      console.error = origErr;
    }
  }

  it("default mode: low coverage warns, still exits 0", async () => {
    const dir = project({ "tests/a.test.yaml": DRAFTY });
    const { code, out } = await runIn(dir, []);
    assert.equal(code, 0);
    assert.match(out, /WARNING: Low action coverage/);
    // SC-006: the two modes must agree on the MEASUREMENT and differ only in
    // the verdict. The --strict case below asserts the identical figure, so a
    // drift in the coverage computation fails one of the pair rather than
    // silently passing here on the prefix alone.
    assert.match(out, /1\/3 statements \(33%\)/);
    assert.match(out, /1 transpiled, 0 error\(s\), 1 warning\(s\)/);
  });

  it("--strict: the same file is an error with guidance, exit 1, and NO spec file remains", async () => {
    const dir = project({ "tests/a.test.yaml": DRAFTY });
    const { code, out } = await runIn(dir, ["--strict"]);
    assert.equal(code, 1);
    assert.match(out, /insufficient action coverage — 1\/3 statements \(33%\)/);
    assert.match(out, /Walk the flow in a browser/);
    // Counter contract: one file, one bucket (review LOW-1 regression guard).
    assert.match(out, /0 transpiled, 1 error\(s\), 0 warning\(s\)/);
    // The gate must leave no runnable artifact behind: the shared pipeline
    // writes the spec before the verdict, so strict failure deletes it —
    // otherwise `shiplight test` right after a failed gate silently runs the
    // under-enriched spec (bot review, MEDIUM).
    assert.equal(
      existsSync(path.join(dir, "tests", "a.yaml.spec.ts")),
      false,
      "strict failure left the .yaml.spec.ts on disk",
    );
  });

  it("--strict failure also removes a STALE spec from an earlier successful run", async () => {
    const dir = project({ "tests/a.test.yaml": ENRICHED });
    await runIn(dir, []); // writes tests/a.yaml.spec.ts
    assert.equal(existsSync(path.join(dir, "tests", "a.yaml.spec.ts")), true);
    // YAML degrades to drafts; the old spec no longer reflects a passing gate.
    writeFileSync(path.join(dir, "tests", "a.test.yaml"), DRAFTY);
    const { code } = await runIn(dir, ["--strict"]);
    assert.equal(code, 1);
    assert.equal(existsSync(path.join(dir, "tests", "a.yaml.spec.ts")), false);
  });

  it("default mode keeps the spec file on low coverage (warns only)", async () => {
    const dir = project({ "tests/a.test.yaml": DRAFTY });
    const { code } = await runIn(dir, []);
    assert.equal(code, 0);
    assert.equal(existsSync(path.join(dir, "tests", "a.yaml.spec.ts")), true);
  });

  it("--strict: an enriched file passes with exit 0", async () => {
    const dir = project({ "tests/a.test.yaml": ENRICHED });
    const { code, out } = await runIn(dir, ["--strict"]);
    assert.equal(code, 0);
    assert.match(out, /1 transpiled, 0 error\(s\)/);
  });

  it("malformed YAML exits 1 in any mode", async () => {
    const dir = project({ "tests/a.test.yaml": "goal: [unclosed\n" });
    const { code, out } = await runIn(dir, []);
    assert.equal(code, 1);
    assert.match(out, /ERROR/);
  });

  it("--strict with a glob matching nothing exits 1 — a gate cannot pass by matching zero files", async () => {
    const dir = project({});
    const { code, out } = await runIn(dir, ["--strict", "nope/**/*.test.yaml"]);
    assert.equal(code, 1);
    assert.match(out, /--strict requires at least one matching file/);
  });

  it("default mode with a glob matching nothing stays exit 0", async () => {
    const dir = project({});
    const { code } = await runIn(dir, ["nope/**/*.test.yaml"]);
    assert.equal(code, 0);
  });
});
