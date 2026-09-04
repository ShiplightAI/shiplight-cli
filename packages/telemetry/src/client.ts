/**
 * Zero-dependency PostHog capture client.
 *
 * Both published binaries (`shiplightai` and `@shiplightai/mcp`) bundle this
 * module, so it deliberately has no runtime dependencies: it posts to
 * PostHog's public `/batch/` HTTP endpoint with the global `fetch` rather
 * than pulling `posthog-node` (and its transitive tree) into the install.
 *
 * Three properties hold everywhere:
 * - **Never throws.** Every entry point swallows its own errors; a telemetry
 *   fault must never change what a command does or what it prints.
 * - **Never blocks.** `capture()` starts the request and returns; only an
 *   explicit `flush()` waits, and that wait is bounded by `timeoutMs`.
 * - **No timers.** There is no batch interval to tear down, so a process can
 *   exit as soon as its in-flight requests settle — no `shutdown()` needed.
 */

import { createHash } from "node:crypto";
import { hostname, userInfo, platform, arch } from "node:os";

/**
 * The PostHog project that receives Shiplight product telemetry. Internal: a
 * caller configures the collector through `apiKey`/`host` or
 * `SHIPLIGHT_TELEMETRY_HOST`, never by importing these.
 */
const POSTHOG_API_KEY = "phc_5Va2dHamGwJWX9qZqyRka5Lann5ATsg3LL4uyU63qin";
const POSTHOG_HOST = "https://us.i.posthog.com";

/** Wait at most this long for a capture request before abandoning it. */
export const DEFAULT_TIMEOUT_MS = 2000;

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number }>;

export interface TelemetryClientOptions {
  /** Which binary is reporting: `cli` or `mcp-server`. */
  product: string;
  /** Published package version, or a dev sentinel. */
  version: string;
  /** Overrides for tests; defaults to the real environment. */
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  apiKey?: string;
  /** Collector base URL. Defaults to `SHIPLIGHT_TELEMETRY_HOST`, then PostHog. */
  host?: string;
  distinctId?: string;
  timeoutMs?: number;
}

export interface TelemetryClient {
  /** False when the user opted out — callers can skip building properties. */
  readonly enabled: boolean;
  /** Fire an event. Returns immediately; the request runs in the background. */
  capture(event: string, properties?: Record<string, unknown>): void;
  /** Resolve once every in-flight request has settled (or timed out). */
  flush(): Promise<void>;
}

/**
 * Anonymous, stable per-machine identifier: a SHA-256 of host, user, OS and
 * CPU architecture. The hash is one-way and never leaves this machine in raw
 * form, so events correlate across runs (and across the CLI and MCP server)
 * without carrying a username or hostname.
 *
 * This recipe is load-bearing for continuity — the MCP server has reported
 * under it since the first telemetry release. Changing the inputs or their
 * order re-identifies every existing machine as a new one.
 */
export function computeInstallId(): string {
  const raw = `${hostname()}:${userInfo().username}:${platform()}:${arch()}`;
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * `SHIPLIGHT_TELEMETRY` names the feature, so only these turn it off — and an
 * empty value is absent, not a "no".
 */
const OPT_OUT_VALUES = new Set(["0", "false", "off", "no"]);

/**
 * `DO_NOT_TRACK` names the refusal, so it is read the other way round: these
 * are the values that are *not* a refusal, and everything else is. Kept as its
 * own set rather than reusing the one above — they differ by `""`, and sharing
 * one set would make an edit for one switch silently change the other.
 */
const NON_REFUSAL_VALUES = new Set(["", ...OPT_OUT_VALUES]);

/**
 * Telemetry is on by default and off when the user says so, via either the
 * Shiplight-specific switch or the cross-vendor `DO_NOT_TRACK` convention
 * (consoledonottrack.com).
 *
 * The two switches are read in opposite directions on purpose.
 * `SHIPLIGHT_TELEMETRY` is ours and names the feature, so only an explicit
 * negative turns it off — `SHIPLIGHT_TELEMETRY=1` must keep it on.
 * `DO_NOT_TRACK` names the *refusal*, and the convention is that setting it at
 * all is the refusal, so anything that is not an explicit negative disables.
 * Reading it as `1`/`true` only would leave `DO_NOT_TRACK=2` tracking a user
 * who plainly asked us not to.
 */
export function isTelemetryDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const shiplight = env.SHIPLIGHT_TELEMETRY?.trim().toLowerCase();
  if (shiplight !== undefined && OPT_OUT_VALUES.has(shiplight)) return true;

  const doNotTrack = env.DO_NOT_TRACK?.trim().toLowerCase();
  if (doNotTrack !== undefined && !NON_REFUSAL_VALUES.has(doNotTrack)) return true;

  return false;
}

/**
 * Human-readable opt-out instruction, shown in the first-run notice. Names
 * both switches: the notice is the only place many users will read, and
 * documenting one path there while the READMEs document two makes the
 * disclosure narrower than the actual choice.
 */
export const TELEMETRY_OPT_OUT_HINT =
  "Set SHIPLIGHT_TELEMETRY=0 or DO_NOT_TRACK=1 to disable.";

export function createTelemetryClient(options: TelemetryClientOptions): TelemetryClient {
  const env = options.env ?? process.env;
  const enabled = !isTelemetryDisabled(env);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const apiKey = options.apiKey ?? POSTHOG_API_KEY;
  // `SHIPLIGHT_TELEMETRY_HOST` points the client at a different collector —
  // used by the local verification harness, and by anyone who has to route
  // egress through their own proxy.
  const host = (options.host ?? env.SHIPLIGHT_TELEMETRY_HOST ?? POSTHOG_HOST).replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);

  const pending = new Set<Promise<void>>();
  let distinctId: string | undefined = options.distinctId;

  function baseProperties(): Record<string, unknown> {
    return {
      product: options.product,
      version: options.version,
      platform: platform(),
      arch: arch(),
      nodeVersion: process.version,
      // PostHog would otherwise derive a coarse location from the request IP.
      // Both are needed: `$ip: null` drops the address, `$geoip_disable` stops
      // the enrichment plugin from running at all.
      $geoip_disable: true,
      $ip: null,
    };
  }

  function capture(event: string, properties: Record<string, unknown> = {}): void {
    if (!enabled || !doFetch) return;

    try {
      distinctId ??= computeInstallId();
      const body = JSON.stringify({
        api_key: apiKey,
        batch: [
          {
            event,
            distinct_id: distinctId,
            timestamp: new Date().toISOString(),
            properties: { ...baseProperties(), ...properties },
          },
        ],
      });

      const request = doFetch(`${host}/batch/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
        .then(() => undefined)
        // A dropped event is not a problem worth surfacing: offline machines,
        // corporate proxies and PostHog outages all land here.
        .catch(() => undefined);

      pending.add(request);
      void request.finally(() => pending.delete(request));
    } catch {
      // Serialization or AbortSignal construction failed — drop the event.
    }
  }

  async function flush(): Promise<void> {
    if (pending.size === 0) return;
    // Every pending promise already absorbed its own rejection, so this
    // settles rather than rejects; `allSettled` is belt-and-braces.
    await Promise.allSettled([...pending]);
  }

  return { enabled, capture, flush };
}
