import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  runCreate,
  ENV_STEP_PROSE,
  ENV_STEP_INSTRUCTION,
} from "./create.js";
import { resolveCliVersion } from "../cliVersion.js";

/**
 * End-to-end coverage of `shiplight create` — the seam between the command and
 * the scaffold module.
 *
 * `src/scaffold/index.test.ts` covers scaffolding itself with a fixed test
 * version. What is only provable here is that the command feeds the REAL
 * running version through, which is the whole point of dropping `"latest"`.
 */

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "cli-create-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Run a block with stdout captured, so `--json` output can be parsed.
 * Patches BOTH console.log and process.stdout.write: the JSON contract paths
 * write directly (flush-before-exit), prose paths still use console.log.
 */
async function captureStdout(fn: () => Promise<unknown>): Promise<string> {
  const originalLog = console.log;
  const originalWrite = process.stdout.write;
  let out = "";
  console.log = (...args: unknown[]) => {
    out += args.join(" ") + "\n";
  };
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    out += String(chunk);
    // Honor the flush callback the production code awaits.
    const cb = rest.find((a) => typeof a === "function") as
      | ((err?: Error) => void)
      | undefined;
    cb?.();
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
  }
  return out;
}

describe("shiplight create — dependency pinning", () => {
  it("pins the scaffolded project to the running CLI version, not a dist-tag", async () => {
    const dir = tempDir();
    await captureStdout(() => runCreate([dir]));

    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf-8"));
    assert.equal(pkg.dependencies.shiplightai, `^${resolveCliVersion()}`);
  });

  it("never writes a floating dist-tag", async () => {
    const dir = tempDir();
    await captureStdout(() => runCreate([dir]));

    const raw = readFileSync(path.join(dir, "package.json"), "utf-8");
    // `latest` resolves once at install time but reads as self-updating, so a
    // project can sit on a months-old CLI while everyone assumes otherwise.
    for (const tag of ['"latest"', '"next"', '"*"']) {
      assert.equal(raw.includes(tag), false, `scaffolded package.json contains ${tag}`);
    }
    assert.match(raw, /"shiplightai": "\^\d+\.\d+\.\d+/);
  });

  it("pins the same range in the merge template for an existing repo", async () => {
    // The agent-merge path must not reintroduce a floating tag through the
    // back door when scaffolding into a project that already has a package.json.
    const dir = tempDir();
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "existing", version: "1.0.0" }),
    );

    const out = await captureStdout(() => runCreate([dir, "--json"]));
    const payload = JSON.parse(out);
    const entry = payload.files_needing_agent_merge.find(
      (f: { path: string }) => f.path === "package.json",
    );

    assert.ok(entry, "expected package.json to be reported as needing a merge");
    assert.match(entry.template, new RegExp(`"shiplightai": "\\^${resolveCliVersion()}"`));
    // And the user's own file must be untouched.
    const existing = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf-8"));
    assert.equal(existing.name, "existing");
    assert.equal(existing.dependencies, undefined);
  });
});

describe("shiplight create --json", () => {
  it("emits a single parseable object and writes no prose to stdout", async () => {
    const dir = tempDir();
    const out = await captureStdout(() => runCreate([dir, "--json"]));

    const payload = JSON.parse(out); // throws if prose leaked into stdout
    assert.equal(payload.project_path, path.resolve(dir));
    assert.ok(payload.files_created.includes("package.json"));
    assert.equal(payload.env_setup_state, "copy_example");
  });

  it("reports every conflict the human output reports — the payload is not lossy", async () => {
    // FR-019: an agent must not get less information than a human does.
    const dir = tempDir();
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "existing" }));
    writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");

    const out = await captureStdout(() => runCreate([dir, "--json"]));
    const parsed = JSON.parse(out);
    const paths = parsed.files_needing_agent_merge.map((f: { path: string }) => f.path).sort();
    assert.deepEqual(paths, [".gitignore", "package.json"]);
    for (const entry of parsed.files_needing_agent_merge) {
      assert.ok(entry.abs_path, "merge entry needs abs_path");
      assert.ok(entry.merge_strategy, "merge entry needs merge_strategy");
      assert.ok(entry.template, "merge entry needs the template content");
      assert.ok(entry.instructions, "merge entry needs instructions");
    }
    assert.equal(parsed.into_existing_repo, true);
  });

  it("leaves existing files untouched", async () => {
    const dir = tempDir();
    const original = JSON.stringify({ name: "existing", version: "2.0.0" });
    writeFileSync(path.join(dir, "package.json"), original);

    await captureStdout(() => runCreate([dir, "--json"]));

    assert.equal(readFileSync(path.join(dir, "package.json"), "utf-8"), original);
    // Non-conflicting files are still written.
    assert.equal(existsSync(path.join(dir, "tests", "example.test.yaml")), true);
  });
});

describe("env-setup credential guidance", () => {
  // The scaffolded .env.example (src/scaffold/templates/env.example.tpl) leads
  // with SHIPLIGHT_API_TOKEN and marks provider keys "(optional with
  // SHIPLIGHT_API_TOKEN)". These maps are the next-step guidance every new
  // project starts from — if they name only provider keys, they contradict the
  // template `create` just wrote and steer every project onto the
  // proxy-bypassing BYOK path by default. Regression guard for exactly that.
  const STATES = Object.keys(ENV_STEP_INSTRUCTION) as Array<
    keyof typeof ENV_STEP_INSTRUCTION
  >;

  it("covers all five states in both maps", () => {
    assert.equal(STATES.length, 5);
    assert.deepEqual(Object.keys(ENV_STEP_PROSE).sort(), [...STATES].sort());
  });

  for (const state of STATES) {
    it(`${state}: both renderings offer the token path and the provider-key path`, () => {
      for (const [audience, text] of [
        ["instruction", ENV_STEP_INSTRUCTION[state]],
        ["prose", ENV_STEP_PROSE[state]],
      ] as const) {
        assert.match(
          text,
          /shiplight setup-api-token/,
          `${audience} must offer 'npx shiplight setup-api-token' (SHIPLIGHT_API_TOKEN path)`,
        );
        assert.match(
          text,
          /GOOGLE_API_KEY/,
          `${audience} must offer a provider key as the alternative`,
        );
        // Token path first, mirroring env.example.tpl's ordering.
        assert.ok(
          text.indexOf("shiplight setup-api-token") < text.indexOf("GOOGLE_API_KEY") ||
            text.indexOf("SHIPLIGHT_API_TOKEN") < text.indexOf("GOOGLE_API_KEY"),
          `${audience} must present the token path before the provider-key path`,
        );
      }
    });
  }
});

describe("env_setup_state selection from real directory shapes", () => {
  // Integration port of the deleted MCP-wrapper B-* scenarios: the state in
  // the emitted payload must match the actual on-disk situation, not just the
  // map contents. Each shape below caused a distinct instruction pre-move.
  async function stateFor(prepare: (dir: string) => void): Promise<string> {
    const dir = tempDir();
    prepare(dir);
    const out = await captureStdout(() => runCreate([dir, "--json"]));
    return JSON.parse(out).env_setup_state;
  }

  it("fresh dir → copy_example", async () => {
    assert.equal(await stateFor(() => {}), "copy_example");
  });


  it("existing .env + pre-existing .env.example → merge_example_then_diff", async () => {
    assert.equal(
      await stateFor((d) => {
        writeFileSync(path.join(d, ".env"), "K=1\n");
        writeFileSync(path.join(d, ".env.example"), "# K=\n");
      }),
      "merge_example_then_diff",
    );
  });

  it("existing .env, no .env.example → diff_fresh_example (scaffold writes a fresh one)", async () => {
    // NOTE: review_existing_env is unreachable through the real flow —
    // scaffold always either writes .env.example (fresh) or reports it as a
    // merge (pre-existing). The defensive branch is covered by the
    // synthesized-result unit tests in scaffold/index.test.ts.
    assert.equal(
      await stateFor((d) => writeFileSync(path.join(d, ".env"), "K=1\n")),
      "diff_fresh_example",
    );
  });

  it("pre-existing .env.example without .env → copy_example_after_merge", async () => {
    assert.equal(
      await stateFor((d) => writeFileSync(path.join(d, ".env.example"), "# K=\n")),
      "copy_example_after_merge",
    );
  });
});

describe("create --json failure contract", () => {
  it("emits a parseable {error} on scaffold failure, exit 1", async () => {
    // Target path is a regular file — scaffoldProject throws its clean error.
    const dir = tempDir();
    const file = path.join(dir, "README.md");
    writeFileSync(file, "x");

    let code: number | undefined;
    const out = await captureStdout(async () => {
      code = await runCreate([file, "--json"]);
    });

    assert.equal(code, 1);
    const parsed = JSON.parse(out); // empty stdout would throw here
    assert.match(parsed.error, /not a directory/);
  });

  it("emits a parseable {error} for an invalid --name, exit 1 (was: empty stdout)", async () => {
    // Regression guard for the review-found hole: --name validation used to
    // bypass the JSON contract entirely, leaving an agent to JSON.parse("").
    const dir = tempDir();
    let code: number | undefined;
    const out = await captureStdout(async () => {
      code = await runCreate([dir, "--json", "--name", "Bad Name"]);
    });

    assert.equal(code, 1);
    const parsed = JSON.parse(out);
    assert.match(parsed.error, /not a valid package name/);
  });

  it("flag order does not change the failure mode (--name before --json)", async () => {
    const dir = tempDir();
    let code: number | undefined;
    const out = await captureStdout(async () => {
      code = await runCreate([dir, "--name", "Bad Name", "--json"]);
    });
    assert.equal(code, 1);
    assert.match(JSON.parse(out).error, /not a valid package name/);
  });

  it("plain mode keeps errors off stdout and returns 1", async () => {
    const dir = tempDir();
    const file = path.join(dir, "f.txt");
    writeFileSync(file, "x");
    let code: number | undefined;
    const out = await captureStdout(async () => {
      code = await runCreate([file]);
    });
    assert.equal(code, 1);
    assert.equal(out, ""); // stderr-only in human mode
  });
});

describe("merge payload field mapping (snake_case contract)", () => {
  it("carries merge_key and lines_to_ensure, never their camelCase forms", async () => {
    // Ported from the deleted scaffold-mcp-wrapper assertions: .mcp.json is
    // the only merge with merge_key; .gitignore the only one with
    // lines_to_ensure. Agents key on these exact names (skills init.md table).
    const dir = tempDir();
    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
    writeFileSync(path.join(dir, ".gitignore"), "dist/\n");

    const out = await captureStdout(() => runCreate([dir, "--json"]));
    const merges = JSON.parse(out).files_needing_agent_merge as Array<
      Record<string, unknown>
    >;

    const mcp = merges.find((f) => f.path === ".mcp.json");
    assert.ok(mcp, ".mcp.json should need a merge");
    assert.equal(mcp!.merge_key, "mcpServers");

    const gitignore = merges.find((f) => f.path === ".gitignore");
    assert.ok(gitignore, ".gitignore should need a merge");
    assert.ok(Array.isArray(gitignore!.lines_to_ensure));
    assert.ok((gitignore!.lines_to_ensure as string[]).length > 0);

    for (const entry of merges) {
      assert.equal("mergeKey" in entry, false, "camelCase mergeKey leaked");
      assert.equal("linesToEnsure" in entry, false, "camelCase linesToEnsure leaked");
      assert.equal("absPath" in entry, false, "camelCase absPath leaked");
    }
  });
});

describe("human output ordering and pointers", () => {
  it("merge hint precedes npm install, and points at --json — not the removed MCP tool", async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "e" }));

    const out = await captureStdout(() => runCreate([dir]));

    // The replacement for the stale scaffold_project pointer (review H1).
    assert.equal(out.includes("scaffold_project"), false, "stale MCP pointer resurfaced");
    assert.match(out, /--json/);
    // npm install must come after the resolve-merges hint, or the user
    // installs against the unmerged package.json missing shiplightai.
    const hint = out.indexOf("resolve the merge-required files");
    const install = out.indexOf("npm install");
    assert.ok(hint !== -1 && install !== -1 && hint < install);
  });
});

describe("--json contract on the remaining argv-error branches", () => {
  it("unknown option under --json: lone parseable {error}, no usage prose on stdout, exit 1", async () => {
    // emitCreateError's usage branch is gated `usage && !json`. If that guard
    // loosens to bare `usage`, the multi-line usage text lands on stdout next
    // to the JSON object and the agent's JSON.parse throws — this pins the
    // one contract path the earlier failure tests didn't reach.
    const dir = tempDir();
    let code: number | undefined;
    const out = await captureStdout(async () => {
      code = await runCreate([dir, "--badflag", "--json"]);
    });
    assert.equal(code, 1);
    const parsed = JSON.parse(out); // any usage prose would make this throw
    assert.match(parsed.error, /Unknown option: --badflag/);
  });

  it("`--name --json` adjacency: --json is consumed as the name value, fails validation, still answers in JSON", async () => {
    // Pins the getopt-style precedence: `--name` takes the next token
    // verbatim (argv[++i]); the pre-scan still sees --json anywhere in argv,
    // so the error arrives in the format the caller asked for. A future
    // "flag-aware" --name parser must change this test consciously.
    const dir = tempDir();
    let code: number | undefined;
    const out = await captureStdout(async () => {
      code = await runCreate([dir, "--name", "--json"]);
    });
    assert.equal(code, 1);
    assert.match(JSON.parse(out).error, /"--json" is not a valid package name/);
  });

  it("rejects consecutive dots in --name (npm refuses them), in JSON form", async () => {
    // 'foo..bar' passes the base charset regex but npm's validator rejects it
    // for its path-traversal semantics — scaffolding it would produce a
    // project npm publish later refuses (bot review, MEDIUM).
    const dir = tempDir();
    let code: number | undefined;
    const out = await captureStdout(async () => {
      code = await runCreate([dir, "--json", "--name", "foo..bar"]);
    });
    assert.equal(code, 1);
    assert.match(JSON.parse(out).error, /not a valid package name/);
  });

  it("success returns exit code 0", async () => {
    // cli.ts does process.exit(await runCreate(...)); a truthy non-zero
    // return on success would silently fail every CI invocation.
    const dir = tempDir();
    let code: number | undefined;
    await captureStdout(async () => {
      code = await runCreate([dir, "--json"]);
    });
    assert.equal(code, 0);
  });
});
