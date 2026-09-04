import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

import type { TelemetryClient } from "shiplight-telemetry";

import {
  TRACKED_COMMANDS,
  UNTRACKED_COMMANDS,
  UNKNOWN_COMMAND,
  buildCommandEvent,
  classifyCommand,
  isCiEnvironment,
  flushTelemetry,
  noticeText,
  shouldShowNotice,
  telemetryClientOptions,
  trackCommand,
  __setTelemetryClientForTests,
} from "./telemetry.js";

const CLI_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.ts");

describe("classifyCommand", () => {
  it("reports every shipped subcommand under its own name", () => {
    for (const command of TRACKED_COMMANDS) {
      assert.equal(classifyCommand(command), command);
    }
  });

  it("reports nothing for a bare invocation or a print-and-exit flag", () => {
    assert.equal(classifyCommand(undefined), null);
    assert.equal(classifyCommand(""), null);
    for (const flag of UNTRACKED_COMMANDS) {
      assert.equal(classifyCommand(flag), null);
    }
  });

  it("replaces an unrecognized command word rather than sending it", () => {
    // A typo is often a path, and a path is often private. The raw word must
    // never reach the wire.
    assert.equal(classifyCommand("tets"), UNKNOWN_COMMAND);
    assert.equal(classifyCommand("/Users/someone/secret/tests.yaml"), UNKNOWN_COMMAND);
    assert.equal(classifyCommand("--token=abc123"), UNKNOWN_COMMAND);
  });
});

describe("command list", () => {
  it("covers every case in the cli.ts dispatch switch", () => {
    const source = fs.readFileSync(CLI_SOURCE, "utf-8");
    const dispatched = [...source.matchAll(/^\s*case "([^"]+)":/gm)].map((m) => m[1]);

    assert.ok(dispatched.length > 0, "failed to parse cli.ts dispatch cases");

    const known = new Set<string>([...TRACKED_COMMANDS, ...UNTRACKED_COMMANDS]);
    const untracked = dispatched.filter((command) => !known.has(command));
    assert.deepEqual(
      untracked,
      [],
      "cli.ts dispatches a command telemetry does not classify — add it to " +
        "TRACKED_COMMANDS or, for a print-and-exit flag, UNTRACKED_COMMANDS"
    );
  });

  it("does not claim commands cli.ts no longer dispatches", () => {
    const source = fs.readFileSync(CLI_SOURCE, "utf-8");
    const dispatched = new Set([...source.matchAll(/^\s*case "([^"]+)":/gm)].map((m) => m[1]));

    const stale = TRACKED_COMMANDS.filter((command) => !dispatched.has(command));
    assert.deepEqual(stale, [], "TRACKED_COMMANDS lists a command cli.ts does not dispatch");
  });
});

describe("isCiEnvironment", () => {
  it("is false on a developer machine", () => {
    assert.equal(isCiEnvironment({}), false);
  });

  it("recognises the common CI providers", () => {
    assert.equal(isCiEnvironment({ CI: "true" }), true);
    assert.equal(isCiEnvironment({ GITHUB_ACTIONS: "true" }), true);
    assert.equal(isCiEnvironment({ GITLAB_CI: "true" }), true);
    assert.equal(isCiEnvironment({ CIRCLECI: "true" }), true);
    assert.equal(isCiEnvironment({ BUILDKITE: "true" }), true);
    assert.equal(isCiEnvironment({ JENKINS_URL: "https://jenkins.internal" }), true);
    assert.equal(isCiEnvironment({ TEAMCITY_VERSION: "2025.1" }), true);
  });

  it("treats an explicitly negative CI value as not CI", () => {
    // Some tooling exports CI=false rather than leaving it unset.
    assert.equal(isCiEnvironment({ CI: "false" }), false);
    assert.equal(isCiEnvironment({ CI: "0" }), false);
    assert.equal(isCiEnvironment({ CI: "" }), false);
  });
});

describe("buildCommandEvent", () => {
  it("names the event and carries only the command and CI flag", () => {
    const payload = buildCommandEvent("test", { CI: "true" });
    assert.deepEqual(payload, { event: "cli_command", properties: { command: "test", ci: true } });
  });

  it("builds nothing when the user opted out", () => {
    assert.equal(buildCommandEvent("test", { SHIPLIGHT_TELEMETRY: "0" }), null);
    assert.equal(buildCommandEvent("test", { DO_NOT_TRACK: "1" }), null);
  });

  it("builds nothing for an invocation that reports nothing", () => {
    assert.equal(buildCommandEvent("--version", {}), null);
    assert.equal(buildCommandEvent(undefined, {}), null);
  });
});

describe("shouldShowNotice", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shiplight-telemetry-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("shows the notice once and records that it did", () => {
    const file = path.join(dir, "nested", "telemetry.json");

    assert.equal(shouldShowNotice(file), true);
    assert.equal(shouldShowNotice(file), false);

    const state = JSON.parse(fs.readFileSync(file, "utf-8")) as { noticeShownAt: string };
    assert.match(state.noticeShownAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("re-shows the notice when the marker is corrupt", () => {
    const file = path.join(dir, "telemetry.json");
    fs.writeFileSync(file, "{not json");

    assert.equal(shouldShowNotice(file), true);
    assert.equal(shouldShowNotice(file), false);
  });

  it("re-shows the notice rather than suppressing it when the marker cannot be written", () => {
    // An unwritable home must not silently turn the disclosure off. The
    // blocker is a *file* where the marker's parent directory should be, so
    // both the read and the mkdir fail with ENOTDIR — deterministically, and
    // for root too. (A read-only directory would not do it: overwriting an
    // existing file needs no write permission on its directory.)
    const blocker = path.join(dir, "not-a-directory");
    fs.writeFileSync(blocker, "");
    const file = path.join(blocker, "telemetry.json");

    assert.equal(shouldShowNotice(file), true);
    assert.equal(fs.existsSync(file), false, "the marker must not have been written");
    assert.equal(shouldShowNotice(file), true, "an unwritable marker re-shows every run");
  });

  it("states what is collected and how to opt out", () => {
    const text = noticeText();
    assert.match(text, /anonymous/i);
    // Both switches, not just ours — the notice is the disclosure of record.
    assert.match(text, /SHIPLIGHT_TELEMETRY=0/);
    assert.match(text, /DO_NOT_TRACK=1/);
  });

  it("names every property the event actually carries", () => {
    // The disclosure is the only description most users read. It must not be
    // shorter than the payload — `arch` and the CI flag ship too.
    const text = noticeText().toLowerCase();
    for (const field of ["command", "version", "os", "architecture", "node", "ci"]) {
      assert.ok(text.includes(field), `notice omits ${field}`);
    }
  });
});

describe("telemetryClientOptions", () => {
  it("identifies the CLI and bounds how long a command can wait on it", () => {
    const options = telemetryClientOptions();
    assert.equal(options.product, "cli");
    assert.equal(typeof options.version, "string");
    assert.ok(
      options.timeoutMs !== undefined && options.timeoutMs > 0 && options.timeoutMs <= 2000,
      "a CLI invocation must not stall for seconds on a black-holed network"
    );
  });
});

describe("trackCommand", () => {
  let dir: string;
  let captured: Array<{ event: string; properties?: Record<string, unknown> }>;
  let notices: string[];
  let stub: TelemetryClient;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shiplight-telemetry-track-"));
    captured = [];
    notices = [];
    stub = {
      enabled: true,
      capture: (event, properties) => {
        captured.push({ event, properties });
      },
      flush: async () => {},
    };
    __setTelemetryClientForTests(stub);
  });

  afterEach(() => {
    __setTelemetryClientForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function track(command: string | undefined, env: NodeJS.ProcessEnv = {}) {
    trackCommand(command, {
      env,
      noticeFile: path.join(dir, "telemetry.json"),
      writeNotice: (message) => notices.push(message),
    });
  }

  it("captures one event for a tracked command and discloses on the first run", () => {
    track("test", { CI: "true" });

    assert.deepEqual(captured, [
      { event: "cli_command", properties: { command: "test", ci: true } },
    ]);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /SHIPLIGHT_TELEMETRY=0/);
  });

  it("discloses only once across runs", () => {
    track("test");
    track("debug");

    assert.equal(notices.length, 1);
    assert.equal(captured.length, 2);
  });

  it("neither captures nor discloses once the user opted out", () => {
    track("test", { SHIPLIGHT_TELEMETRY: "0" });
    track("test", { DO_NOT_TRACK: "1" });

    assert.deepEqual(captured, []);
    assert.deepEqual(notices, []);
  });

  it("stays silent for print-and-exit flags", () => {
    track("--version");
    track("--help");

    assert.deepEqual(captured, []);
    assert.deepEqual(notices, []);
  });

  it("swallows a client that throws", () => {
    __setTelemetryClientForTests({
      enabled: true,
      capture: () => {
        throw new Error("boom");
      },
      flush: async () => {},
    });

    track("test");
    assert.equal(captured.length, 0);
  });
});

describe("flushTelemetry", () => {
  afterEach(() => __setTelemetryClientForTests(null));

  it("resolves when no client was ever created", async () => {
    __setTelemetryClientForTests(null);
    await flushTelemetry();
  });

  it("waits on the active client", async () => {
    let flushed = false;
    __setTelemetryClientForTests({
      enabled: true,
      capture: () => {},
      flush: async () => {
        flushed = true;
      },
    });

    await flushTelemetry();
    assert.equal(flushed, true);
  });

  it("resolves even when the client's flush rejects", async () => {
    __setTelemetryClientForTests({
      enabled: true,
      capture: () => {},
      flush: async () => {
        throw new Error("boom");
      },
    });

    await flushTelemetry();
  });
});
