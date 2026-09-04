import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { DebuggerManager, type ManagerOptions, type Spawner } from "./manager.js";

// --------------------------------------------------------------------------
// Test helpers
// --------------------------------------------------------------------------

function makeTempYaml(dir: string, name: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(
    p,
    [
      "goal: Test",
      "statements:",
      '  - URL: https://example.com',
      '  - "click login"',
      "",
    ].join("\n"),
    "utf-8",
  );
  return p;
}

function makePlaywrightConfig(dir: string): string {
  const p = path.join(dir, "playwright.config.ts");
  fs.writeFileSync(p, "export default { testDir: '.' };\n", "utf-8");
  return p;
}

interface FakeSpawnState {
  calls: Array<{ yamlFilePath: string; tempSuffix?: string; configPath: string; headed: boolean }>;
  cleanupCalls: string[];
  /** Port allocator for consecutive spawn calls. */
  portSequence: number[];
  pidSequence: number[];
  /** When set, the next spawn throws this error (then resets). */
  nextError: Error | null;
}

function fakeSpawner(initial: Partial<FakeSpawnState> = {}): { spawner: Spawner; state: FakeSpawnState } {
  const state: FakeSpawnState = {
    calls: [],
    cleanupCalls: [],
    portSequence: [20000, 20001, 20002, 20003, 20004],
    pidSequence: [90001, 90002, 90003, 90004, 90005],
    nextError: null,
    ...initial,
  };

  const spawner: Spawner = async (opts) => {
    state.calls.push({
      yamlFilePath: opts.yamlFilePath,
      tempSuffix: opts.tempSuffix,
      configPath: opts.configPath,
      headed: opts.headed,
    });
    if (state.nextError) {
      const err = state.nextError;
      state.nextError = null;
      throw err;
    }
    const idx = state.calls.length - 1;
    const port = state.portSequence[idx] ?? 30000 + idx;
    const pid = state.pidSequence[idx] ?? 80000 + idx;
    return {
      port,
      host: "127.0.0.1",
      pid,
      cleanup: async () => {
        state.cleanupCalls.push(opts.yamlFilePath);
      },
    };
  };

  return { spawner, state };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("DebuggerManager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "debugger-manager-test-"));
    makePlaywrightConfig(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("openSession creates an idle session without spawning", async () => {
    const { spawner, state } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });
    const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

    const session = manager.openSession(yaml);

    assert.equal(session.status, "idle");
    assert.equal(session.yamlPath, path.resolve(yaml));
    assert.equal(session.innerPort, 0);
    assert.equal(session.pid, 0);
    assert.match(session.sessionId, /^dbg-[a-f0-9]{8}$/);
    assert.equal(state.calls.length, 0); // no spawn

    await manager.shutdown();
  });

  it("startSandbox spawns the inner and transitions to running", async () => {
    const { spawner, state } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });
    const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

    const session = manager.openSession(yaml);
    assert.equal(session.status, "idle");

    await manager.startSandbox(session.sessionId);

    const updated = manager.getSession(session.sessionId);
    assert.ok(updated);
    assert.equal(updated.status, "running");
    assert.equal(updated.innerPort, 20000);
    assert.equal(updated.pid, 90001);
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].tempSuffix, session.sessionId);

    await manager.shutdown();
  });

  it("startSandbox passes the manager's headed option through to the spawner", async () => {
    const { spawner: spawnerDefault, state: stateDefault } = fakeSpawner();
    const managerDefault = new DebuggerManager({ spawner: spawnerDefault });
    const s1 = managerDefault.openSession(makeTempYaml(tmpDir, "default.test.yaml"));
    await managerDefault.startSandbox(s1.sessionId);
    assert.equal(stateDefault.calls[0].headed, false);
    await managerDefault.shutdown();

    const { spawner: spawnerHeaded, state: stateHeaded } = fakeSpawner();
    const managerHeaded = new DebuggerManager({ spawner: spawnerHeaded, headed: true });
    const s2 = managerHeaded.openSession(makeTempYaml(tmpDir, "headed.test.yaml"));
    await managerHeaded.startSandbox(s2.sessionId);
    assert.equal(stateHeaded.calls[0].headed, true);
    await managerHeaded.shutdown();
  });

  it("openSession dedups by yaml path (FR-003)", async () => {
    const { spawner } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });
    const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

    const s1 = manager.openSession(yaml);
    const s2 = manager.openSession(yaml);

    assert.equal(s2.sessionId, s1.sessionId);

    await manager.shutdown();
  });

  it("openSession spawns independent sessions for different yaml paths (FR-004)", async () => {
    const { spawner } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });
    const y1 = makeTempYaml(tmpDir, "foo.test.yaml");
    const y2 = makeTempYaml(tmpDir, "bar.test.yaml");

    const s1 = manager.openSession(y1);
    const s2 = manager.openSession(y2);

    assert.notEqual(s1.sessionId, s2.sessionId);

    await manager.shutdown();
  });

  it("openSession throws when yaml file is missing", async () => {
    const { spawner } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });
    const missing = path.join(tmpDir, "nope.test.yaml");

    assert.throws(
      () => manager.openSession(missing),
      /YAML file not found/,
    );
  });

  it("openSession throws when no playwright config is found", async () => {
    const { spawner } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });
    const noCfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "no-pw-cfg-"));
    try {
      const yaml = makeTempYaml(noCfgDir, "foo.test.yaml");
      assert.throws(
        () => manager.openSession(yaml),
        /No Playwright config found/,
      );
    } finally {
      fs.rmSync(noCfgDir, { recursive: true, force: true });
    }
  });

  it("startSandbox propagates spawn errors and resets to idle (FR-019)", async () => {
    const { spawner, state } = fakeSpawner();
    state.nextError = new Error("simulated spawn failure");
    const manager = new DebuggerManager({ spawner });
    const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

    const session = manager.openSession(yaml);
    await assert.rejects(
      () => manager.startSandbox(session.sessionId),
      /simulated spawn failure/,
    );

    // Session should still exist and back to idle so the user can retry.
    const after = manager.getSession(session.sessionId);
    assert.ok(after);
    assert.equal(after.status, "idle");
    assert.match(String(after.exitInfo), /simulated spawn failure/);

    await manager.shutdown();
  });

  it("startSandbox is idempotent — second call on running session is a no-op", async () => {
    const { spawner, state } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });
    const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

    const session = manager.openSession(yaml);
    await manager.startSandbox(session.sessionId);
    await manager.startSandbox(session.sessionId); // should not spawn again

    assert.equal(state.calls.length, 1);

    await manager.shutdown();
  });

  it("stopSandbox kills the inner and resets to idle", async () => {
    const { spawner, state } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });
    const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

    const session = manager.openSession(yaml);
    await manager.startSandbox(session.sessionId);

    const running = manager.getSession(session.sessionId);
    assert.ok(running);
    assert.equal(running.status, "running");

    await manager.stopSandbox(session.sessionId);

    const stopped = manager.getSession(session.sessionId);
    assert.ok(stopped);
    assert.equal(stopped.status, "idle");
    assert.equal(stopped.innerPort, 0);
    assert.equal(stopped.pid, 0);
    assert.equal(state.cleanupCalls.length, 1);

    await manager.shutdown();
  });

  it("stopSandbox allows re-starting the sandbox", async () => {
    const { spawner, state } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });
    const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

    const session = manager.openSession(yaml);
    await manager.startSandbox(session.sessionId);
    await manager.stopSandbox(session.sessionId);

    // Re-start should work
    await manager.startSandbox(session.sessionId);

    const restarted = manager.getSession(session.sessionId);
    assert.ok(restarted);
    assert.equal(restarted.status, "running");
    assert.equal(state.calls.length, 2);

    await manager.shutdown();
  });

  it("closeSession terminates the inner and removes the map entry", async () => {
    const { spawner, state } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });
    const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

    const session = manager.openSession(yaml);
    await manager.startSandbox(session.sessionId);
    await manager.closeSession(session.sessionId);

    assert.equal(manager.getSession(session.sessionId), undefined);
    assert.deepEqual(state.cleanupCalls, [path.resolve(yaml)]);

    // A fresh openSession for the same path should create a new session.
    const next = manager.openSession(yaml);
    assert.notEqual(next.sessionId, session.sessionId);

    await manager.shutdown();
  });

  it("closeSession on idle session removes without cleanup", async () => {
    const { spawner, state } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });
    const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

    const session = manager.openSession(yaml);
    await manager.closeSession(session.sessionId);

    assert.equal(manager.getSession(session.sessionId), undefined);
    assert.equal(state.cleanupCalls.length, 0); // no process to cleanup

    await manager.shutdown();
  });

  it("closeSession is idempotent — second close is a no-op", async () => {
    const { spawner } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });
    const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

    const session = manager.openSession(yaml);
    await manager.closeSession(session.sessionId);
    await manager.closeSession(session.sessionId); // should not throw
  });

  it("closeSession on an unknown id is a no-op", async () => {
    const { spawner } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });

    await manager.closeSession("dbg-unknown"); // should not throw
  });

  it("listSessions returns snapshots, not live references", async () => {
    const { spawner } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });
    const yaml = makeTempYaml(tmpDir, "foo.test.yaml");
    const session = manager.openSession(yaml);

    const list = manager.listSessions();
    assert.equal(list.length, 1);
    // Mutating the snapshot must not affect internal state.
    list[0].status = "ended";
    const fresh = manager.getSession(session.sessionId);
    assert.equal(fresh?.status, "idle");

    await manager.shutdown();
  });

  it("shutdown closes all sessions concurrently", async () => {
    const { spawner, state } = fakeSpawner();
    const manager = new DebuggerManager({ spawner });

    const s1 = manager.openSession(makeTempYaml(tmpDir, "a.test.yaml"));
    const s2 = manager.openSession(makeTempYaml(tmpDir, "b.test.yaml"));
    const s3 = manager.openSession(makeTempYaml(tmpDir, "c.test.yaml"));

    // Start sandbox on two of them to verify cleanup runs
    await manager.startSandbox(s1.sessionId);
    await manager.startSandbox(s2.sessionId);
    assert.equal(manager.listSessions().length, 3);

    await manager.shutdown();

    assert.equal(manager.listSessions().length, 0);
    assert.equal(state.cleanupCalls.length, 2); // only the two that had processes
  });

  it("onSessionStateChange fires on idle → starting → running → ended transitions", async () => {
    const { spawner } = fakeSpawner();
    const events: Array<{ sessionId: string; status: string }> = [];
    const options: ManagerOptions = {
      spawner,
      onSessionStateChange: (s) => events.push({ sessionId: s.sessionId, status: s.status }),
    };
    const manager = new DebuggerManager(options);
    const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

    const session = manager.openSession(yaml);
    await manager.startSandbox(session.sessionId);
    await manager.closeSession(session.sessionId);

    const statuses = events.filter((e) => e.sessionId === session.sessionId).map((e) => e.status);
    assert.ok(statuses.includes("idle"), `expected "idle" in events, got: ${JSON.stringify(statuses)}`);
    assert.ok(statuses.includes("starting"), `expected "starting" in events, got: ${JSON.stringify(statuses)}`);
    assert.ok(statuses.includes("running"), `expected "running" in events, got: ${JSON.stringify(statuses)}`);
    assert.ok(statuses.includes("ended"), `expected "ended" in events, got: ${JSON.stringify(statuses)}`);
  });

  it("onLog receives manager log lines when set", async () => {
    const { spawner } = fakeSpawner();
    const logs: string[] = [];
    const manager = new DebuggerManager({ spawner, onLog: (line) => logs.push(line) });
    const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

    manager.openSession(yaml);

    assert.ok(
      logs.some((l) => l.includes("session dbg-")),
      `expected "session dbg-" in logs, got: ${JSON.stringify(logs)}`,
    );

    await manager.shutdown();
  });

  describe("restartInner", () => {
    it("kills the old inner, spawns a fresh one, and keeps the sessionId", async () => {
      const { spawner, state } = fakeSpawner();
      const manager = new DebuggerManager({ spawner });
      const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

      const session = manager.openSession(yaml);
      await manager.startSandbox(session.sessionId);
      assert.equal(state.calls.length, 1);

      await manager.restartInner(session.sessionId);

      // OLD cleanup ran exactly once before the new spawn.
      assert.equal(state.cleanupCalls.length, 1);
      assert.equal(state.cleanupCalls[0], path.resolve(yaml));

      // Spawner was called a second time with the SAME yaml + sessionId.
      assert.equal(state.calls.length, 2);
      assert.equal(state.calls[1].yamlFilePath, path.resolve(yaml));
      assert.equal(state.calls[1].tempSuffix, session.sessionId);

      // Session is back to "running" with the new port/pid; sessionId unchanged.
      const after = manager.getSession(session.sessionId);
      assert.ok(after, "session must still exist in the map");
      assert.equal(after.sessionId, session.sessionId);
      assert.equal(after.status, "running");
      assert.equal(after.innerPort, 20001);
      assert.equal(after.pid, 90002);

      await manager.shutdown();
    });

    it("resets the session to idle if the respawn spawner throws", async () => {
      const { spawner, state } = fakeSpawner();
      const manager = new DebuggerManager({ spawner });
      const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

      const session = manager.openSession(yaml);
      await manager.startSandbox(session.sessionId);
      state.nextError = new Error("spawn boom");

      await assert.rejects(() => manager.restartInner(session.sessionId), /spawn boom/);

      const after = manager.getSession(session.sessionId);
      assert.ok(after, "session entry must remain so the consumer can retry");
      assert.equal(after.status, "idle");
      assert.match(String(after.exitInfo), /spawn boom/);

      await manager.shutdown();
    });

    it("throws if the sessionId is unknown (no silent no-op)", async () => {
      const { spawner } = fakeSpawner();
      const manager = new DebuggerManager({ spawner });

      await assert.rejects(
        () => manager.restartInner("dbg-doesntexist"),
        /No session .* to restart/,
      );

      await manager.shutdown();
    });

    it("rejects a concurrent restartInner on the same session (no orphan inner)", async () => {
      let resolveSpawn: ((r: { port: number; host: string; pid: number; cleanup: () => Promise<void> }) => void) | null = null;
      let spawnCallCount = 0;
      const cleanupCalls: string[] = [];
      const spawner: Spawner = async (opts) => {
        spawnCallCount++;
        if (spawnCallCount === 1) {
          // First spawn (startSandbox)
          return {
            port: 21000,
            host: "127.0.0.1",
            pid: 91001,
            cleanup: async () => { cleanupCalls.push("first"); },
          };
        }
        // Second spawn (the restart) — pend until we resolve it.
        return new Promise((resolve) => {
          resolveSpawn = resolve;
        });
      };
      const manager = new DebuggerManager({ spawner });
      const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

      const session = manager.openSession(yaml);
      await manager.startSandbox(session.sessionId);

      // Fire the first restart; it'll pause at the second spawner call.
      const firstRestart = manager.restartInner(session.sessionId);
      // Yield once so the sync prelude of firstRestart runs and the flag is set.
      await Promise.resolve();

      // Concurrent second call must reject with the "in progress" message.
      await assert.rejects(
        () => manager.restartInner(session.sessionId),
        /Restart already in progress/,
      );

      // Now let the first restart finish so the test cleans up.
      resolveSpawn!({
        port: 21001,
        host: "127.0.0.1",
        pid: 91002,
        cleanup: async () => { cleanupCalls.push("restart"); },
      });
      await firstRestart;

      assert.equal(cleanupCalls.length, 1);
      assert.equal(cleanupCalls[0], "first");

      await manager.shutdown();
    });

    it("clears the in-progress flag even if the spawn fails (no permanent lock)", async () => {
      const { spawner, state } = fakeSpawner();
      const manager = new DebuggerManager({ spawner });
      const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

      const session = manager.openSession(yaml);
      await manager.startSandbox(session.sessionId);
      state.nextError = new Error("spawn boom");
      await assert.rejects(() => manager.restartInner(session.sessionId), /spawn boom/);

      // The flag is cleared in the finally — a fresh restart should NOT throw
      // "Restart already in progress".
      state.nextError = null;
      // Session is back to idle after the failed restart — start a new sandbox
      // and restart it to verify the lock was released.
      await manager.startSandbox(session.sessionId);
      await manager.restartInner(session.sessionId);

      await manager.shutdown();
    });

    it("emits state transitions via onSessionStateChange (running → starting → running)", async () => {
      const { spawner } = fakeSpawner();
      const events: Array<{ sessionId: string; status: string }> = [];
      const manager = new DebuggerManager({
        spawner,
        onSessionStateChange: (s) => events.push({ sessionId: s.sessionId, status: s.status }),
      });
      const yaml = makeTempYaml(tmpDir, "foo.test.yaml");

      const session = manager.openSession(yaml);
      await manager.startSandbox(session.sessionId);
      events.length = 0; // clear the open/start events; only care about the restart side

      await manager.restartInner(session.sessionId);

      const statuses = events.filter((e) => e.sessionId === session.sessionId).map((e) => e.status);
      assert.ok(statuses[0] === "starting", `expected first event "starting", got: ${JSON.stringify(statuses)}`);
      assert.ok(statuses.includes("running"), `expected "running" in events, got: ${JSON.stringify(statuses)}`);
      assert.equal(statuses.includes("ended"), false);

      await manager.shutdown();
    });
  });
});
