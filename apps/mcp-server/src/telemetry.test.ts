import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { TelemetryClient } from "shiplight-telemetry";

import { trackNewSession, __setTelemetryClientForTests } from "./telemetry.js";
import logger from "./logger.js";

describe("trackNewSession", () => {
  let captured: Array<{ event: string; properties?: Record<string, unknown> }>;
  let infoLines: string[];
  let originalInfo: typeof logger.info;

  function client(overrides: Partial<TelemetryClient> = {}): TelemetryClient {
    return {
      enabled: true,
      capture: (event, properties) => {
        captured.push({ event, properties });
      },
      flush: async () => {},
      ...overrides,
    };
  }

  beforeEach(() => {
    captured = [];
    infoLines = [];
    originalInfo = logger.info.bind(logger);
    logger.info = (...args: unknown[]) => {
      infoLines.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    logger.info = originalInfo;
    __setTelemetryClientForTests(null);
  });

  it("captures the session event", () => {
    __setTelemetryClientForTests(client());

    trackNewSession("0.1.63");

    assert.deepEqual(captured, [{ event: "mcp_new_session", properties: undefined }]);
  });

  it("logs the opt-out notice once per process", () => {
    __setTelemetryClientForTests(client());

    trackNewSession("0.1.63");
    trackNewSession("0.1.63");

    assert.equal(infoLines.length, 1);
    assert.match(infoLines[0], /SHIPLIGHT_TELEMETRY=0/);
    assert.match(infoLines[0], /DO_NOT_TRACK=1/);
    assert.equal(captured.length, 2);
  });

  it("stays silent — no event, no notice — when the user opted out", () => {
    __setTelemetryClientForTests(client({ enabled: false }));

    trackNewSession("0.1.63");

    assert.deepEqual(captured, []);
    assert.deepEqual(infoLines, []);
  });

  it("swallows a client that throws", () => {
    __setTelemetryClientForTests(
      client({
        capture: () => {
          throw new Error("boom");
        },
      })
    );

    trackNewSession("0.1.63");
    assert.deepEqual(captured, []);
  });
});
