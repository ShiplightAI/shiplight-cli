/**
 * Anonymous usage telemetry for the MCP server.
 *
 * Transport, opt-out and the anonymous machine id live in
 * `shiplight-telemetry`, shared with the `shiplight` CLI so both binaries
 * report the same distinct id and honour the same switches. This module holds
 * only what is specific to the MCP server: which event it sends, and when.
 *
 * - Fire-and-forget: never blocks a tool call, never throws
 * - Opt-out: set SHIPLIGHT_TELEMETRY=0 or DO_NOT_TRACK=1
 * - Anonymous: machine ID is a SHA-256 hash, no PII transmitted
 */

import {
  createTelemetryClient,
  TELEMETRY_OPT_OUT_HINT,
  type TelemetryClient,
} from "shiplight-telemetry";
import logger from "./logger.js";

let client: TelemetryClient | null = null;
let noticeShown = false;

function getClient(version: string): TelemetryClient {
  client ??= createTelemetryClient({ product: "mcp-server", version });
  return client;
}

/**
 * Record that an MCP client opened a browser session — the server's unit of
 * real use, as opposed to a tool listing during client startup.
 *
 * Fire-and-forget with no matching flush, deliberately. The request settles in
 * the background while a long-lived server keeps handling calls, so losing the
 * event needs the host to kill the process within a couple of hundred
 * milliseconds of the call. The alternative — a SIGTERM/SIGINT handler — would
 * change teardown semantics for every host that terminates this binary
 * routinely, which is the worse trade. (The deleted `shutdownTelemetry` was
 * not that: it existed to clear `posthog-node`'s batch timer, and this client
 * has no timers.)
 */
export function trackNewSession(version: string): void {
  try {
    const telemetry = getClient(version);
    if (!telemetry.enabled) return;

    if (!noticeShown) {
      logger.info(`Anonymous usage telemetry enabled. ${TELEMETRY_OPT_OUT_HINT}`);
      noticeShown = true;
    }

    telemetry.capture("mcp_new_session");
  } catch {
    // Silently ignore — telemetry must never affect UX
  }
}

/**
 * Test seam: swap the memoized client (or pass `null` to drop it, so the next
 * call rebuilds one from the real environment) and re-arm the notice.
 */
export function __setTelemetryClientForTests(replacement: TelemetryClient | null): void {
  client = replacement;
  noticeShown = false;
}
