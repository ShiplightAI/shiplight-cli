/**
 * Chromium CDP URL Discovery
 *
 * Finds the CDP (Chrome DevTools Protocol) WebSocket URL of a Chromium
 * process that Playwright launched with `--remote-debugging-port=0`.
 *
 * The approach avoids pre-allocating a port on the caller side (which is
 * racy — any Chrome already listening on the picked port silently shadows
 * ours and we'd register the wrong CDP URL). Instead:
 *
 *   1. Chromium launches with `--remote-debugging-port=0` and picks a free
 *      port itself.
 *   2. Chromium writes `<user-data-dir>/DevToolsActivePort` — two lines:
 *      the chosen port, then the WS path (e.g. `/devtools/browser/<uuid>`).
 *   3. We walk the process tree from the Playwright worker's pid to find
 *      Chromium as a descendant, extract `--user-data-dir=<path>` from
 *      its command line, then read the file.
 *
 * On macOS/Linux: `ps -axo pid=,ppid=,args=` provides the process list.
 * On Windows: PowerShell's Get-CimInstance Win32_Process is used instead
 * because Windows ships no `ps` and Git Bash's ps doesn't support `-x`.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface ProcEntry {
  pid: number;
  ppid: number;
  args: string;
}

function getProcessList(): ProcEntry[] {
  if (process.platform === "win32") {
    // PowerShell CIM gives us PID, parent PID, and full command line on Windows.
    const raw = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf-8", timeout: 10_000 },
    );
    const data: unknown = JSON.parse(raw.trim());
    const items = Array.isArray(data) ? data : [data];
    return items
      .filter((p): p is Record<string, unknown> => p !== null && typeof p === "object")
      .filter((p) => typeof p["ProcessId"] === "number")
      .map((p) => ({
        pid: p["ProcessId"] as number,
        ppid: typeof p["ParentProcessId"] === "number" ? (p["ParentProcessId"] as number) : 0,
        args: typeof p["CommandLine"] === "string" ? (p["CommandLine"] as string) : "",
      }));
  }

  const psOutput = execFileSync("ps", ["-axo", "pid=,ppid=,args="], { encoding: "utf-8" });
  const procs: ProcEntry[] = [];
  for (const line of psOutput.split("\n")) {
    const trimmed = line.trimStart();
    const m = trimmed.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) procs.push({ pid: parseInt(m[1], 10), ppid: parseInt(m[2], 10), args: m[3] });
  }
  return procs;
}

/**
 * Find a Chromium descendant of `rootPid` and return its `--user-data-dir`.
 * Returns null if no such descendant exists (e.g., Chromium hasn't
 * spawned yet or has already exited).
 */
function findChromiumUserDataDir(rootPid: number): string | null {
  const procs = getProcessList();
  // BFS for descendants of rootPid.
  const descendants = new Set<number>([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of procs) {
      if (!descendants.has(p.pid) && descendants.has(p.ppid)) {
        descendants.add(p.pid);
        grew = true;
      }
    }
  }
  for (const p of procs) {
    if (p.pid === rootPid || !descendants.has(p.pid)) continue;
    if (!/chrome|chromium/i.test(p.args)) continue;
    // Windows command lines may quote the value: --user-data-dir="C:\path\..."
    const m = p.args.match(/--user-data-dir=(?:"([^"]+)"|(\S+))/);
    if (m) return m[1] ?? m[2];
  }
  return null;
}

/**
 * Poll `<userDataDir>/DevToolsActivePort` until Chromium writes it. Chromium
 * creates this file once it finishes starting the DevTools HTTP listener.
 * Format is two lines: `<port>\n<ws-path>` (ws-path starts with `/`).
 */
async function readDevToolsActivePort(
  userDataDir: string,
  timeoutMs: number,
): Promise<{ port: number; wsPath: string }> {
  const filePath = path.join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8").trim();
      const [portLine, wsPath] = raw.split("\n");
      const port = parseInt(portLine, 10);
      if (Number.isFinite(port) && port > 0 && typeof wsPath === "string" && wsPath.startsWith("/")) {
        return { port, wsPath };
      }
    } catch {
      // File not written yet — Chromium is still starting.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${filePath} — Chromium never exposed DevTools`);
}

/**
 * Discover the CDP WebSocket URL of a Chromium descendant of `workerPid`.
 *
 * Usage pattern: caller launches Chromium with `--remote-debugging-port=0`
 * (via Playwright's `launchOptions.args`), then calls this helper once the
 * browser instance is available. Returns `ws://127.0.0.1:<port><ws-path>`
 * — the full URL suitable for the shared registry and for piping raw CDP.
 *
 * Also polls the Chromium process tree — the worker-to-chromium parent
 * relationship is established by Playwright before it hands back a page,
 * so by the time this is called the descendant exists. If somehow it
 * doesn't (crashed, not-yet-spawned), this throws rather than guessing.
 *
 * `timeoutMs` applies only to the DevToolsActivePort file readiness —
 * the process lookup is synchronous.
 */
export async function discoverChromiumCdpUrl(
  workerPid: number,
  timeoutMs = 30_000,
): Promise<string> {
  const userDataDir = findChromiumUserDataDir(workerPid);
  if (!userDataDir) {
    throw new Error(
      `No Chromium descendant of pid ${workerPid} with --user-data-dir found. ` +
      `Did you launch with --remote-debugging-port=0 and is the browser still running?`,
    );
  }
  const { port, wsPath } = await readDevToolsActivePort(userDataDir, timeoutMs);
  return `ws://127.0.0.1:${port}${wsPath}`;
}
