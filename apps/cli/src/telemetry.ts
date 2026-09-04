/**
 * Anonymous usage telemetry for the `shiplight` CLI.
 *
 * One event per invocation, `cli_command`, carrying which subcommand ran and
 * the shape of the machine that ran it. Deliberately *not* carried: arguments,
 * file paths, URLs, YAML content, org or account identifiers — the raw command
 * word is replaced by `unknown` when it is not one we ship, so a typo that
 * happens to be a path never leaves the machine.
 *
 * - Opt out with `SHIPLIGHT_TELEMETRY=0` or `DO_NOT_TRACK=1`.
 * - Anonymous: the distinct id is a SHA-256 of host/user/platform/arch.
 * - Fire-and-forget: `trackCommand` never blocks and never throws. `cli.ts`
 *   awaits `flushTelemetry()` before the exits it owns, which resolves
 *   instantly for anything longer-running than the request itself.
 *
 * Test execution is intentionally out of scope: the Playwright fixture runs
 * per test, in worker processes, and instrumenting it would report volume
 * rather than usage. Only the CLI entry point reports.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  createTelemetryClient,
  isTelemetryDisabled,
  TELEMETRY_OPT_OUT_HINT,
  type TelemetryClient,
  type TelemetryClientOptions,
} from "shiplight-telemetry";

import { RUNNING_VERSION } from "./versionCheck.js";

/**
 * Subcommands that report. MUST stay in sync with the dispatch switch in
 * `cli.ts` — `telemetry.test.ts` reads that file and fails when the two drift,
 * so a new command is either tracked or explicitly listed as untracked.
 */
export const TRACKED_COMMANDS = [
  "setup-api-token",
  "create",
  "debug",
  "test",
  "report",
  "transpile",
  "inspect",
  "spec",
] as const;

/**
 * Print-and-exit flags. They report nothing so that `shiplight --version`
 * stays instant: tracking them would make the process wait on a network round
 * trip in exactly the case where it has no work to do, and scripts call
 * `--version` in tight loops.
 */
export const UNTRACKED_COMMANDS = ["--version", "-v", "--help", "-h"] as const;

/** Stand-in for any command word we do not ship. Never the raw input. */
export const UNKNOWN_COMMAND = "unknown";

const NEGATIVE_ENV_VALUES = new Set(["", "0", "false", "off", "no"]);

const CI_ENV_VARS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "BUILDKITE",
  "JENKINS_URL",
  "TEAMCITY_VERSION",
] as const;

/**
 * Whether this run looks like CI. Kept as a property rather than a reason to
 * suppress the event: CI usage is real usage, and separating the two is the
 * point of the flag.
 */
export function isCiEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return CI_ENV_VARS.some((name) => {
    const value = env[name];
    return value !== undefined && !NEGATIVE_ENV_VALUES.has(value.trim().toLowerCase());
  });
}

/**
 * Map `process.argv[2]` onto the value reported for it, or `null` when the
 * invocation reports nothing (a bare `shiplight`, or a print-and-exit flag).
 */
export function classifyCommand(raw: string | undefined): string | null {
  if (!raw) return null;
  if ((UNTRACKED_COMMANDS as readonly string[]).includes(raw)) return null;
  if ((TRACKED_COMMANDS as readonly string[]).includes(raw)) return raw;
  return UNKNOWN_COMMAND;
}

function defaultNoticeFile(): string {
  return path.join(os.homedir(), ".shiplight", "telemetry.json");
}

interface NoticeState {
  noticeShownAt: string;
}

/**
 * True the first time this machine runs a tracked command, false afterwards.
 * Records the notice as shown as a side effect, so the disclosure appears
 * exactly once rather than on every invocation.
 *
 * Fails *open* on an unwritable home directory: a user who cannot persist the
 * marker sees the notice again rather than never seeing it.
 */
export function shouldShowNotice(noticeFile: string = defaultNoticeFile()): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(noticeFile, "utf-8")) as NoticeState;
    if (typeof parsed.noticeShownAt === "string") return false;
  } catch {
    // Missing or corrupt marker — treat as never shown.
  }

  try {
    fs.mkdirSync(path.dirname(noticeFile), { recursive: true });
    fs.writeFileSync(
      noticeFile,
      JSON.stringify({ noticeShownAt: new Date().toISOString() } satisfies NoticeState)
    );
  } catch {
    // Marker write failure is non-fatal; the notice repeats next run.
  }

  return true;
}

/** The one-time disclosure, on stderr so it never pollutes piped stdout. */
export function noticeText(): string {
  return (
    `shiplight sends anonymous usage data (command name, CLI version, OS, CPU ` +
    `architecture, Node version, and whether the run is CI). ` +
    `No arguments, file contents or account data are collected. ${TELEMETRY_OPT_OUT_HINT}`
  );
}

export interface CommandEvent {
  event: string;
  properties: { command: string; ci: boolean };
}

/**
 * The event a given invocation reports, or `null` when it reports nothing.
 * Pure, so the exact payload can be asserted without a network seam.
 */
export function buildCommandEvent(
  rawCommand: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): CommandEvent | null {
  const command = classifyCommand(rawCommand);
  if (command === null) return null;
  if (isTelemetryDisabled(env)) return null;
  return { event: "cli_command", properties: { command, ci: isCiEnvironment(env) } };
}

/**
 * How long a command may wait on its own telemetry request before giving up.
 *
 * Only the short commands ever feel this: `test`, `debug`, `report` and friends
 * outlive the request many times over, so their flush resolves instantly. The
 * cost lands on `spec`/`create`/`transpile`/`inspect` against a network that
 * silently drops packets rather than refusing the connection — a corporate
 * firewall, typically. 1.5s bounds that; a refused connection costs nothing.
 */
export const CLI_TELEMETRY_TIMEOUT_MS = 1500;

/** The options the CLI builds its client from. Exported so tests can assert them. */
export function telemetryClientOptions(): TelemetryClientOptions {
  return { product: "cli", version: RUNNING_VERSION, timeoutMs: CLI_TELEMETRY_TIMEOUT_MS };
}

let client: TelemetryClient | null = null;

function getClient(): TelemetryClient {
  client ??= createTelemetryClient(telemetryClientOptions());
  return client;
}

export interface TrackCommandOptions {
  env?: NodeJS.ProcessEnv;
  noticeFile?: string;
  writeNotice?: (message: string) => void;
}

/**
 * Record one CLI invocation. Safe to call unconditionally — it returns without
 * side effects when the command is untracked or the user has opted out.
 */
export function trackCommand(
  rawCommand: string | undefined,
  options: TrackCommandOptions = {}
): void {
  try {
    const payload = buildCommandEvent(rawCommand, options.env ?? process.env);
    if (!payload) return;

    if (shouldShowNotice(options.noticeFile)) {
      const write = options.writeNotice ?? ((message: string) => process.stderr.write(message));
      write(`${noticeText()}\n`);
    }

    getClient().capture(payload.event, payload.properties);
  } catch {
    // Telemetry must never affect the command the user asked for.
  }
}

/**
 * Wait for the in-flight event, bounded by the client's own request timeout.
 * Resolves immediately when nothing is pending, which is the common case for
 * every command that outlives its own telemetry request.
 */
export async function flushTelemetry(): Promise<void> {
  try {
    if (client) await client.flush();
  } catch {
    // Unreachable in practice — the client absorbs its own failures.
  }
}

/**
 * Test seam: swap the memoized client (or pass `null` to drop it, so the next
 * call rebuilds one from the real environment).
 */
export function __setTelemetryClientForTests(replacement: TelemetryClient | null): void {
  client = replacement;
}
