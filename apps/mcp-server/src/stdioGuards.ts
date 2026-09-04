/**
 * Stdio guards for the MCP stdio transport.
 *
 * The MCP server speaks JSON-RPC over stdout, so ANY stray write to stdout
 * (e.g. a dependency's console.log) corrupts the protocol. These helpers back
 * the guards installed in server.ts: detect broken-pipe errors, format thrown
 * values for stderr, and build a console replacement that routes to stderr.
 *
 * They are extracted here as pure, injectable functions so the behavior can be
 * unit-tested without mutating the real process console or starting the server.
 */

/** True for an EPIPE error object (stdout/stderr peer went away). */
export function isBrokenPipe(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EPIPE"
  );
}

/** Render any thrown value as a single string, never throwing itself. */
export function formatThrown(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}`;
  }
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/**
 * Build a console-compatible logger that routes all args to `write` (stderr in
 * production) instead of stdout. Used to replace console.log/info/debug so they
 * never corrupt the JSON-RPC channel.
 */
export function createStderrConsole(
  write: (message: string) => void
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    write(`${args.map(formatThrown).join(" ")}\n`);
  };
}
