import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hostname, userInfo } from "node:os";

import {
  createTelemetryClient,
  computeInstallId,
  isTelemetryDisabled,
  type FetchLike,
} from "./client.js";

interface Call {
  url: string;
  init: Parameters<FetchLike>[1];
}

function recordingFetch(
  behaviour: (call: Call) => Promise<{ ok: boolean; status: number }> = async () => ({ ok: true, status: 200 })
): { calls: Call[]; fetchImpl: FetchLike } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const call = { url, init };
    calls.push(call);
    return behaviour(call);
  };
  return { calls, fetchImpl };
}

interface CapturedEvent {
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

function parseBatch(call: Call): { api_key: string; batch: CapturedEvent[] } {
  return JSON.parse(String(call.init?.body)) as { api_key: string; batch: CapturedEvent[] };
}

function client(overrides: Partial<Parameters<typeof createTelemetryClient>[0]> = {}) {
  return createTelemetryClient({
    product: "cli",
    version: "1.2.3",
    env: {},
    distinctId: "fixed-id",
    ...overrides,
  });
}

describe("isTelemetryDisabled", () => {
  it("is enabled by default", () => {
    assert.equal(isTelemetryDisabled({}), false);
  });

  it("honours the documented opt-out values", () => {
    assert.equal(isTelemetryDisabled({ SHIPLIGHT_TELEMETRY: "0" }), true);
    assert.equal(isTelemetryDisabled({ DO_NOT_TRACK: "1" }), true);
  });

  it("accepts the common spellings of each switch", () => {
    for (const value of ["0", "false", "off", "no", "FALSE", " off "]) {
      assert.equal(isTelemetryDisabled({ SHIPLIGHT_TELEMETRY: value }), true, `SHIPLIGHT_TELEMETRY=${value}`);
    }
    for (const value of ["1", "true", "on", "yes", "TRUE"]) {
      assert.equal(isTelemetryDisabled({ DO_NOT_TRACK: value }), true, `DO_NOT_TRACK=${value}`);
    }
  });

  it("treats any non-negative DO_NOT_TRACK value as a refusal", () => {
    // The convention is that setting the variable *is* the refusal. Reading
    // only `1`/`true` would keep tracking a user who wrote something else.
    for (const value of ["2", "enabled", "yes please"]) {
      assert.equal(isTelemetryDisabled({ DO_NOT_TRACK: value }), true, `DO_NOT_TRACK=${value}`);
    }
  });

  it("keeps telemetry on for the affirmative form of either switch", () => {
    // `SHIPLIGHT_TELEMETRY=1` is the opposite of an opt-out; `DO_NOT_TRACK=0`
    // and an empty `DO_NOT_TRACK=` likewise mean "tracking is fine".
    assert.equal(isTelemetryDisabled({ SHIPLIGHT_TELEMETRY: "1" }), false);
    assert.equal(isTelemetryDisabled({ DO_NOT_TRACK: "0" }), false);
    assert.equal(isTelemetryDisabled({ DO_NOT_TRACK: "false" }), false);
    assert.equal(isTelemetryDisabled({ DO_NOT_TRACK: "" }), false);
  });
});

describe("computeInstallId", () => {
  it("is a stable SHA-256 hex digest", () => {
    const id = computeInstallId();
    assert.match(id, /^[0-9a-f]{64}$/);
    assert.equal(id, computeInstallId());
  });

  it("does not leak the raw hostname or username", () => {
    const id = computeInstallId();
    assert.equal(id.includes(hostname()), false);
    assert.equal(id.includes(userInfo().username), false);
  });
});

describe("shared identity", () => {
  it("gives the CLI and the MCP server the same distinct id on one machine", async () => {
    // The two binaries are one user. Reporting them under different ids would
    // double-count every machine that runs both, and would break the existing
    // MCP series, which has always used this hash.
    const cli = recordingFetch();
    const mcp = recordingFetch();

    createTelemetryClient({ product: "cli", version: "1.2.3", env: {}, fetchImpl: cli.fetchImpl })
      .capture("cli_command");
    createTelemetryClient({ product: "mcp-server", version: "0.1.63", env: {}, fetchImpl: mcp.fetchImpl })
      .capture("mcp_new_session");

    const cliEvent = parseBatch(cli.calls[0]).batch[0];
    const mcpEvent = parseBatch(mcp.calls[0]).batch[0];

    assert.equal(cliEvent.distinct_id, computeInstallId());
    assert.equal(cliEvent.distinct_id, mcpEvent.distinct_id);
    // Same machine, still distinguishable products.
    assert.equal(cliEvent.properties.product, "cli");
    assert.equal(mcpEvent.properties.product, "mcp-server");
  });
});

describe("createTelemetryClient.capture", () => {
  it("posts one PostHog batch per event", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const telemetry = client({ fetchImpl, host: "https://posthog.test", apiKey: "phc_test" });

    telemetry.capture("cli_command", { command: "test" });
    await telemetry.flush();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://posthog.test/batch/");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(calls[0].init?.headers?.["content-type"], "application/json");

    const payload = parseBatch(calls[0]);
    assert.equal(payload.api_key, "phc_test");
    assert.equal(payload.batch.length, 1);
    assert.equal(payload.batch[0].event, "cli_command");
    assert.equal(payload.batch[0].distinct_id, "fixed-id");
    assert.match(payload.batch[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("honours SHIPLIGHT_TELEMETRY_HOST", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const telemetry = client({ fetchImpl, host: undefined, env: { SHIPLIGHT_TELEMETRY_HOST: "http://127.0.0.1:9999/" } });

    telemetry.capture("cli_command");
    await telemetry.flush();

    assert.equal(calls[0].url, "http://127.0.0.1:9999/batch/");
  });

  it("stamps product metadata and suppresses IP geolocation", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const telemetry = client({ fetchImpl, product: "mcp-server", version: "0.1.63" });

    telemetry.capture("mcp_new_session");
    await telemetry.flush();

    const properties = parseBatch(calls[0]).batch[0].properties;
    assert.equal(properties.product, "mcp-server");
    assert.equal(properties.version, "0.1.63");
    assert.equal(properties.nodeVersion, process.version);
    assert.equal(typeof properties.platform, "string");
    assert.equal(typeof properties.arch, "string");
    assert.equal(properties.$geoip_disable, true);
    assert.equal(properties.$ip, null);
  });

  it("lets the caller override a base property", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const telemetry = client({ fetchImpl });

    telemetry.capture("cli_command", { version: "override" });
    await telemetry.flush();

    assert.equal(parseBatch(calls[0]).batch[0].properties.version, "override");
  });

  it("sends nothing once the user has opted out", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const telemetry = client({ fetchImpl, env: { SHIPLIGHT_TELEMETRY: "0" } });

    assert.equal(telemetry.enabled, false);
    telemetry.capture("cli_command", { command: "test" });
    await telemetry.flush();

    assert.equal(calls.length, 0);
  });

  it("applies an abort timeout so a hung request cannot stall the process", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const telemetry = client({ fetchImpl, timeoutMs: 25 });

    telemetry.capture("cli_command");
    const signal = calls[0].init?.signal;
    assert.ok(signal instanceof AbortSignal);
    assert.equal(signal.aborted, false);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(signal.aborted, true);
    await telemetry.flush();
  });

  it("swallows a network failure", async () => {
    const { fetchImpl } = recordingFetch(async () => {
      throw new Error("ENOTFOUND posthog.test");
    });
    const telemetry = client({ fetchImpl });

    telemetry.capture("cli_command");
    await telemetry.flush();
  });

  it("swallows a rejected response", async () => {
    const { fetchImpl } = recordingFetch(async () => ({ ok: false, status: 500 }));
    const telemetry = client({ fetchImpl });

    telemetry.capture("cli_command");
    await telemetry.flush();
  });

  it("does not throw when the runtime has no fetch", async () => {
    // `globalThis.fetch` must be removed, not just left out of the options:
    // the client falls back to it, so a bare `fetchImpl: undefined` would send
    // a live event to production PostHog instead of exercising this branch.
    const realFetch = globalThis.fetch;
    Reflect.deleteProperty(globalThis, "fetch");
    try {
      const telemetry = client({ fetchImpl: undefined as unknown as FetchLike });
      telemetry.capture("cli_command");
      await telemetry.flush();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("never falls back to the real network in this suite", () => {
    // Guards the trap above: every client built by `client()` must carry an
    // explicit fetch seam, or a test silently posts to production PostHog.
    const realFetch = globalThis.fetch;
    Reflect.deleteProperty(globalThis, "fetch");
    try {
      const { fetchImpl } = recordingFetch();
      assert.equal(client({ fetchImpl }).enabled, true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("drops an event whose properties cannot be serialized", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const telemetry = client({ fetchImpl });

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    telemetry.capture("cli_command", cyclic);
    await telemetry.flush();

    assert.equal(calls.length, 0);
  });
});

describe("createTelemetryClient.flush", () => {
  it("waits for every in-flight request", async () => {
    let settled = 0;
    const { fetchImpl } = recordingFetch(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            settled += 1;
            resolve({ ok: true, status: 200 });
          }, 10)
        )
    );
    const telemetry = client({ fetchImpl });

    telemetry.capture("a");
    telemetry.capture("b");
    assert.equal(settled, 0, "capture must not block on the request");

    await telemetry.flush();
    assert.equal(settled, 2);
  });

  it("resolves immediately when nothing is pending", async () => {
    const { fetchImpl } = recordingFetch();
    await client({ fetchImpl }).flush();
  });
});
