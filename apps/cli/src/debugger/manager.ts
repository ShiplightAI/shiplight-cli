/**
 * DebuggerManager — multi-session debugger manager.
 *
 * Owns a session map keyed by `sessionId`, deduplicated on `yamlPath`. Each
 * session maps to one inner `playwright test` process spawned by the existing
 * `playwrightDebug.ts` helper. The manager exposes raw HTTP + WebSocket
 * proxies to those inner processes; consumers (CLI, testbox, future VSCode
 * extension) wire those proxies into their own server.
 *
 * Used by:
 *   - `shiplight debug foo.yaml` CLI — one session per invocation (N=1).
 *   - apps/testbox OmniTerm server — N sessions per container.
 *   - (future) VSCode extension — N sessions per editor instance.
 *
 * Design notes: see specs/_archive/004-testbox-debugger/research.md §1.
 */

import * as http from "http";
import * as net from "net";
import * as path from "path";
import * as fs from "fs";
import { randomUUID } from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { findPlaywrightConfig, spawnPlaywrightProcess } from "./playwrightDebug.js";

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export type SessionStatus = "idle" | "starting" | "running" | "ended";

export interface DebuggerSession {
  /** URL-safe stable id for the lifetime of this session. */
  sessionId: string;
  /** Absolute path of the YAML test this session is pinned to. */
  yamlPath: string;
  /** Localhost port the inner playwright process is listening on. */
  innerPort: number;
  /**
   * Loopback host the inner Express actually bound to. Discovered by the
   * spawner during its readiness probe. Needed because older shiplightai
   * packages bind "localhost" (IPv6 on macOS) while current source binds
   * 127.0.0.1 — the outer must dial whichever family is live.
   */
  innerHost: string;
  /** Inner process pid — used for kill + ps-based liveness. */
  pid: number;
  /** ISO-8601 timestamp for when openSession started. */
  startedAt: string;
  /** Current lifecycle status — see state-machine in data-model.md. */
  status: SessionStatus;
  /**
   * Non-zero exit code or signal if the inner exited abnormally.
   * `null` while running; number on clean exit; string (e.g. "SIGTERM") on signal.
   * Populated when `status === "ended"`.
   */
  exitInfo: number | string | null;
}

/**
 * Shape the manager's spawner must return. Matches
 * `spawnPlaywrightProcess` in `./playwrightDebug.js`; extracted as a
 * dependency-injection seam so unit tests can supply a fake without
 * actually starting Playwright.
 */
export interface SpawnerResult {
  port: number;
  /** Loopback host the inner Express is reachable on (e.g. "127.0.0.1" or "[::1]"). */
  host: string;
  pid: number;
  cleanup: () => Promise<void>;
}

export interface SpawnerArgs {
  yamlFilePath: string;
  configPath: string;
  tempSuffix?: string;
  /**
   * Whether to launch Chromium with `--headed`. False = headless; the SPA's
   * CDP live-view is the only browser surface. True = a separate visible
   * window (use when the embedding host can't comfortably show the live-view).
   * Required field; callers default it via `ManagerOptions.headed`, which
   * itself defaults to false.
   */
  headed: boolean;
}

export type Spawner = (args: SpawnerArgs) => Promise<SpawnerResult>;

export interface ManagerOptions {
  /**
   * Invoked whenever a session transitions between statuses. Useful for
   * consumers that want to react to lifecycle events without polling.
   */
  onSessionStateChange?: (session: DebuggerSession) => void;
  /**
   * Log-line hook. CLI mode pipes to stdout/stderr; testbox mode typically
   * routes to its own telemetry/console logger. When unset, the manager is
   * silent.
   */
  onLog?: (line: string) => void;
  /**
   * Inner-process spawner. Defaults to `spawnPlaywrightProcess` from
   * `./playwrightDebug.js`; tests and future consumers may substitute a
   * fake (e.g. one that doesn't actually shell out to `npx playwright test`).
   */
  spawner?: Spawner;
  /**
   * Default headed mode for sessions opened by this manager. See `SpawnerArgs.headed`.
   * Unset → defaults to false: the debugger SPA's CDP live-view already shows
   * the running browser in the right pane, so injecting `--headed` would
   * surface a second redundant window AND override the user's
   * `use.headless` config in playwright.config.ts. Consumers that genuinely
   * want a separate headed window can opt in.
   */
  headed?: boolean;
}

export interface ProxyOptions {
  /**
   * Optional builder for the `/api/int-runner/liveview-url` response. The
   * liveview URL is the WS endpoint the UI should connect to for the live
   * DevTools view. The manager can't know the outer URL scheme (CLI vs.
   * testbox prefix it differently), so consumers supply the URL here.
   *
   * When unset, liveview-url returns an empty string (disables the live view).
   */
  liveviewUrlBuilder?: (req: Request) => string;
}

// -------------------------------------------------------------------------
// Internal state per session
// -------------------------------------------------------------------------

interface SessionInternal {
  session: DebuggerSession;
  cleanup: () => Promise<void>;
  readyPromise: Promise<void>;
  /** Liveness-probe timer — cleared on session teardown so the event loop can settle. */
  livenessTimer?: NodeJS.Timeout;
  /**
   * Set while `restartInner` is mid-flight (between cleanup() and the new
   * spawner resolving). Guards against two concurrent restart-inner calls
   * on the same session, which would otherwise leak the old inner process:
   * the second call's spawn would overwrite `internal.cleanup`, losing
   * the first call's cleanup reference.
   */
  restartInProgress?: boolean;
}

const REGISTRATION_TIMEOUT_MS = 10_000;

// -------------------------------------------------------------------------
// Class
// -------------------------------------------------------------------------

export class DebuggerManager {
  private readonly sessions = new Map<string, SessionInternal>();
  private readonly byYamlPath = new Map<string, string>(); // yamlPath → sessionId
  private readonly options: ManagerOptions;
  private readonly spawner: Spawner;
  private readonly headed: boolean;

  constructor(options: ManagerOptions = {}) {
    this.options = options;
    this.spawner = options.spawner ?? spawnPlaywrightProcess;
    this.headed = options.headed ?? false;
  }

  private log(line: string): void {
    if (this.options.onLog) {
      this.options.onLog(line);
    } else {
      // Match existing debugger output channel conventions.
      // eslint-disable-next-line no-console
      console.error(line);
    }
  }

  /**
   * Reset a session's runtime state back to idle. Shared by stopSandbox,
   * spawn-failure catch blocks, and the liveness probe.
   */
  private resetToIdle(internal: SessionInternal, exitInfo: number | string | null): void {
    internal.session.innerPort = 0;
    internal.session.innerHost = "127.0.0.1";
    internal.session.pid = 0;
    internal.session.status = "idle";
    internal.session.exitInfo = exitInfo;
    internal.cleanup = async () => {};
    internal.readyPromise = Promise.resolve();
    this.notifyStateChange(internal.session);
  }

  private notifyStateChange(session: DebuggerSession): void {
    try {
      this.options.onSessionStateChange?.({ ...session });
    } catch (err) {
      this.log(`[manager] onSessionStateChange listener threw: ${(err as Error).message}`);
    }
  }

  /**
   * Open a new debugger session for the given yaml path. If a session for
   * the same absolute path already exists in a live status, returns the
   * existing session (idempotent — satisfies FR-003).
   *
   * The session starts in `"idle"` status — no Playwright process is
   * spawned. Call `startSandbox(sessionId)` to launch the inner process
   * on demand (e.g. when the user clicks "Start" in the debugger bar).
   */
  openSession(yamlPath: string): DebuggerSession {
    const absolutePath = path.resolve(yamlPath);

    const existingId = this.byYamlPath.get(absolutePath);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing && existing.session.status !== "ended") {
        return { ...existing.session };
      }
      this.byYamlPath.delete(absolutePath);
    }

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`YAML file not found: ${absolutePath}`);
    }
    const configPath = findPlaywrightConfig(path.dirname(absolutePath));
    if (!configPath) {
      throw new Error(
        `No Playwright config found for ${absolutePath} (searched parents for playwright.config.{ts,js,mjs}).`,
      );
    }

    const sessionId = `dbg-${randomUUID().slice(0, 8)}`;
    const startedAt = new Date().toISOString();

    const session: DebuggerSession = {
      sessionId,
      yamlPath: absolutePath,
      innerPort: 0,
      innerHost: "127.0.0.1",
      pid: 0,
      startedAt,
      status: "idle",
      exitInfo: null,
    };

    const internal: SessionInternal = {
      session,
      cleanup: async () => {},
      readyPromise: Promise.resolve(),
    };
    this.sessions.set(sessionId, internal);
    this.byYamlPath.set(absolutePath, sessionId);
    this.notifyStateChange(session);

    this.log(`[manager] session ${sessionId} created (idle) for ${path.basename(absolutePath)}`);
    return { ...session };
  }

  /**
   * Spawn the inner Playwright process for an existing idle session.
   * Idempotent — returns immediately if the sandbox is already running or
   * starting. Throws on spawn failure; the session is left marked "ended".
   */
  async startSandbox(sessionId: string): Promise<void> {
    const internal = this.sessions.get(sessionId);
    if (!internal) {
      throw new Error(`No session ${sessionId} to start sandbox for`);
    }
    if (internal.session.status === "running" || internal.session.status === "starting") {
      if (internal.readyPromise) await internal.readyPromise;
      return;
    }
    if (internal.session.status === "ended") {
      throw new Error(`Session ${sessionId} has ended`);
    }

    const yamlPath = internal.session.yamlPath;
    const configPath = findPlaywrightConfig(path.dirname(yamlPath));
    if (!configPath) {
      throw new Error(
        `No Playwright config found for ${yamlPath} (searched parents for playwright.config.{ts,js,mjs}).`,
      );
    }

    internal.session.status = "starting";
    this.notifyStateChange(internal.session);

    const readyPromise = (async () => {
      const SPAWN_BUDGET_MS = REGISTRATION_TIMEOUT_MS + 180_000;
      let spawnBudgetTimer: NodeJS.Timeout | undefined;
      const spawnBudget = new Promise<never>((_, reject) => {
        spawnBudgetTimer = setTimeout(
          () =>
            reject(
              new Error(
                `Timed out after ${SPAWN_BUDGET_MS / 1000}s waiting for inner playwright to register on a port.`,
              ),
            ),
          SPAWN_BUDGET_MS,
        );
      });
      let spawnResult;
      try {
        spawnResult = await Promise.race([
          this.spawner({
            yamlFilePath: yamlPath,
            configPath,
            tempSuffix: sessionId,
            headed: this.headed,
          }),
          spawnBudget,
        ]);
      } finally {
        if (spawnBudgetTimer) clearTimeout(spawnBudgetTimer);
      }

      internal.session.innerPort = spawnResult.port;
      internal.session.innerHost = spawnResult.host;
      internal.session.pid = spawnResult.pid;
      internal.session.status = "running";
      internal.cleanup = spawnResult.cleanup;

      internal.livenessTimer = this.startLivenessProbe(sessionId, (exitInfo) => {
        if (internal.session.status === "running" || internal.session.status === "starting") {
          this.resetToIdle(internal, exitInfo);
        }
      });

      this.notifyStateChange(internal.session);
      this.log(
        `[manager] session ${sessionId} running on ${internal.session.innerHost}:${internal.session.innerPort} (yaml=${path.basename(yamlPath)})`,
      );
    })();

    internal.readyPromise = readyPromise;
    try {
      await readyPromise;
    } catch (err) {
      this.resetToIdle(internal, (err as Error).message);
      throw err;
    }
  }

  /**
   * Kill the sandbox (inner Playwright process) but keep the session in
   * the map so the user can re-start. Status transitions to `"idle"`.
   */
  async stopSandbox(sessionId: string): Promise<void> {
    const internal = this.sessions.get(sessionId);
    if (!internal) return;
    if (internal.session.status === "idle") return;
    if (internal.session.status === "ended") return;

    this.log(`[manager] stopSandbox ${sessionId}`);

    if (internal.livenessTimer) {
      clearInterval(internal.livenessTimer);
      internal.livenessTimer = undefined;
    }

    try {
      await internal.cleanup();
    } catch (err) {
      this.log(`[manager] stopSandbox ${sessionId} cleanup error: ${(err as Error).message}`);
    }

    this.resetToIdle(internal, null);
  }

  /**
   * Poll for inner-process liveness via its pid. When the pid is gone, flip
   * the session to "ended" so subsequent requests return 410 and the UI can
   * show the error in place (FR-019).
   *
   * We use `process.kill(pid, 0)` — signal 0 checks deliverability without
   * actually signalling — rather than a TCP probe against the inner's port.
   * Earlier iterations probed 127.0.0.1:<innerPort>, but Playwright's
   * generated spec spawns the inner with `listen(port, "localhost")`, which
   * on macOS resolves to IPv6 (::1) first. An IPv4 probe then fails even
   * though the inner is healthy, which caused sessions to flip to "ended"
   * immediately after spawn.
   *
   * Pid liveness is the right signal: if the playwright process is alive,
   * whatever address family its Express happens to bind to is irrelevant —
   * the in-process proxy uses the actual port, not our probe.
   */
  private startLivenessProbe(sessionId: string, onProcessExited: (exitInfo: number | string | null) => void): NodeJS.Timeout {
    const INTERVAL_MS = 3000;
    const FAILURE_THRESHOLD = 3;
    let failures = 0;
    const timer = setInterval(() => {
      const internal = this.sessions.get(sessionId);
      if (!internal || internal.session.status === "ended" || internal.session.status === "idle") {
        clearInterval(timer);
        return;
      }
      let alive = false;
      try {
        process.kill(internal.session.pid, 0);
        alive = true;
      } catch (e: unknown) {
        // ESRCH means the pid is gone — that's the only signal we can
        // confidently treat as "dead". EPERM (ptrace restrictions,
        // user-namespace remapping, etc.) means the process exists but
        // we can't signal it; under those conditions every probe would
        // false-positive into shutdown without this guard.
        const code = (e as Partial<NodeJS.ErrnoException>)?.code;
        if (code !== "ESRCH") alive = true;
      }
      if (alive) {
        failures = 0;
      } else {
        failures += 1;
        if (failures >= FAILURE_THRESHOLD) {
          clearInterval(timer);
          onProcessExited("process-exited");
        }
      }
    }, INTERVAL_MS);
    timer.unref();
    return timer;
  }

  /**
   * Terminate a session: SIGTERM via the cleanup hook, wait up to 5s, then
   * remove from map. Idempotent — returns silently if already gone. See
   * contracts/session-api.md for the full lifecycle diagram.
   */
  async closeSession(sessionId: string): Promise<void> {
    const internal = this.sessions.get(sessionId);
    if (!internal) return;

    this.log(`[manager] closeSession ${sessionId} (status=${internal.session.status})`);

    // Remove from indexes first so subsequent dedup or proxy lookups skip this session.
    this.sessions.delete(sessionId);
    if (this.byYamlPath.get(internal.session.yamlPath) === sessionId) {
      this.byYamlPath.delete(internal.session.yamlPath);
    }

    // Stop the liveness-probe timer so the event loop can settle once the
    // inner process is gone. Without this, `closeSession` eventually returns
    // but the timer keeps firing until process exit.
    if (internal.livenessTimer) {
      clearInterval(internal.livenessTimer);
      internal.livenessTimer = undefined;
    }

    if (internal.session.status !== "ended") {
      internal.session.status = "ended";
      internal.session.exitInfo = "SIGTERM";
      this.notifyStateChange(internal.session);
    }

    try {
      await internal.cleanup();
    } catch (err) {
      this.log(`[manager] closeSession ${sessionId} cleanup error: ${(err as Error).message}`);
    }
  }



  /**
   * Kill the current inner Playwright process and spawn a fresh one for the
   * same session. The sessionId and the session-map entry are preserved, so
   * the consumer's `/debugger/<sid>/` URL and webview base href keep working.
   *
   * Used by the SPA's "Reset" button (via POST /api/int-runner/terminate-session)
   * to get a clean browser without forcing the consumer to re-create the
   * session and reload its UI.
   *
   * Throws on respawn failure; the session is left marked "ended" so the
   * consumer can react.
   */
  async restartInner(sessionId: string): Promise<void> {
    const internal = this.sessions.get(sessionId);
    if (!internal) {
      throw new Error(`No session ${sessionId} to restart`);
    }
    if (internal.restartInProgress) {
      throw new Error(`Restart already in progress for session ${sessionId}`);
    }

    const yamlPath = internal.session.yamlPath;
    const configPath = findPlaywrightConfig(path.dirname(yamlPath));
    if (!configPath) {
      throw new Error(
        `No Playwright config found for ${yamlPath} (searched parents for playwright.config.{ts,js,mjs}).`,
      );
    }

    internal.restartInProgress = true;
    try {

    // Stop the liveness probe BEFORE tearing down the old inner so the probe
    // doesn't fire mid-respawn and prematurely flip status to "ended".
    if (internal.livenessTimer) {
      clearInterval(internal.livenessTimer);
      internal.livenessTimer = undefined;
    }

    // Kill the existing inner process.
    try {
      await internal.cleanup();
    } catch (err) {
      this.log(`[manager] restartInner ${sessionId} old cleanup error: ${(err as Error).message}`);
    }

    // Reset to "starting" so listSessions polling reflects in-progress state.
    internal.session.status = "starting";
    internal.session.innerPort = 0;
    internal.session.pid = 0;
    this.notifyStateChange(internal.session);

    // Same spawn budget as openSession — guard against a wedged spawner.
    const SPAWN_BUDGET_MS = REGISTRATION_TIMEOUT_MS + 180_000;
    let spawnBudgetTimer: NodeJS.Timeout | undefined;
    const spawnBudget = new Promise<never>((_, reject) => {
      spawnBudgetTimer = setTimeout(
        () =>
          reject(
            new Error(
              `Timed out after ${SPAWN_BUDGET_MS / 1000}s waiting for inner playwright to respawn.`,
            ),
          ),
        SPAWN_BUDGET_MS,
      );
    });
    let spawnResult: SpawnerResult;
    try {
      spawnResult = await Promise.race([
        this.spawner({
          yamlFilePath: yamlPath,
          configPath,
          tempSuffix: sessionId,
          headed: this.headed,
        }),
        spawnBudget,
      ]);
    } catch (err) {
      this.resetToIdle(internal, (err as Error).message);
      throw err;
    } finally {
      if (spawnBudgetTimer) clearTimeout(spawnBudgetTimer);
    }

    internal.session.innerPort = spawnResult.port;
    internal.session.innerHost = spawnResult.host;
    internal.session.pid = spawnResult.pid;
    internal.session.status = "running";
    internal.cleanup = spawnResult.cleanup;

    // Reinstall liveness probe for the fresh inner.
    internal.livenessTimer = this.startLivenessProbe(sessionId, (exitInfo) => {
      if (internal.session.status === "running" || internal.session.status === "starting") {
        this.resetToIdle(internal, exitInfo);
      }
    });

    this.notifyStateChange(internal.session);
    this.log(
      `[manager] session ${sessionId} restarted on ${internal.session.innerHost}:${internal.session.innerPort} (yaml=${path.basename(yamlPath)})`,
    );
    } finally {
      internal.restartInProgress = false;
    }
  }

  /** Snapshot of all current sessions across all states. */
  listSessions(): DebuggerSession[] {
    return Array.from(this.sessions.values()).map((i) => ({ ...i.session }));
  }

  getSession(sessionId: string): DebuggerSession | undefined {
    const internal = this.sessions.get(sessionId);
    return internal ? { ...internal.session } : undefined;
  }

  /**
   * Express middleware that proxies HTTP requests to the inner process for
   * the given `sessionId`. Intercepts path-matched debugger endpoints that
   * the outer layer used to own (create-session, terminate-session,
   * liveview-url) so consumers don't duplicate that logic.
   */
  httpProxyFor(sessionId: string, options: ProxyOptions = {}): RequestHandler {
    const { liveviewUrlBuilder } = options;

    return async (req: Request, res: Response, _next: NextFunction) => {
      const internal = this.sessions.get(sessionId);
      if (!internal) {
        res.status(404).json({ status: "error", message: "Session not found" });
        return;
      }
      if (internal.session.status === "ended") {
        res.status(410).json({ status: "error", message: "Session has ended", exitInfo: internal.session.exitInfo });
        return;
      }
      if (internal.session.status === "idle") {
        res.status(503).json({ status: "error", message: "Sandbox not started" });
        return;
      }

      const methodPath = `${req.method} ${req.path}`;

      if (methodPath === "POST /api/int-runner/create-session") {
        const body = await readRequestBody(req);
        let parsed: Record<string, unknown> = {};
        if (body.length) {
          try {
            parsed = JSON.parse(body.toString("utf-8"));
          } catch {
            res.status(400).json({ status: "error", message: "Invalid JSON body" });
            return;
          }
        }
        parsed.testFilePath = internal.session.yamlPath;
        await forwardToInner(req, res, internal.session.innerHost, internal.session.innerPort, Buffer.from(JSON.stringify(parsed), "utf-8"), "application/json");
        return;
      }

      // terminate-session: stop the sandbox (kill the inner process) but
      // keep the session in the map. The user can click Start again to
      // re-launch. Status transitions to "idle".
      if (methodPath === "POST /api/int-runner/terminate-session") {
        try {
          await this.stopSandbox(sessionId);
          res.json({ status: "success", details: "Sandbox stopped" });
        } catch (err) {
          res.status(500).json({ status: "error", message: (err as Error).message });
        }
        return;
      }

      // liveview-url: return the WS URL for the live CDP view. The outer
      // URL scheme is consumer-specific — let the consumer build it.
      if (methodPath === "POST /api/int-runner/liveview-url") {
        const liveviewUrl = liveviewUrlBuilder?.(req) ?? "";
        res.json({ liveviewUrl, browserWsUrl: "" });
        return;
      }

      // Default: raw reverse proxy. Body collected upfront because Express
      // middleware (CORS, etc.) may have consumed the readable stream.
      const body = await readRequestBody(req);
      await forwardToInner(req, res, internal.session.innerHost, internal.session.innerPort, body, req.headers["content-type"]);
    };
  }

  /**
   * HTTP upgrade handler for WebSocket traffic to the inner process.
   *
   * The upgrade handshake forwards to the inner's `/api/browser-cdp` to
   * discover the Chrome CDP URL (inner holds the live Chromium), then opens
   * a raw TCP pipe between the client socket and the Chrome CDP socket.
   *
   * Call from your HTTP server's upgrade listener:
   *
   *   server.on("upgrade", (req, socket, head) => {
   *     const sessionId = resolveSessionFromUrl(req.url);
   *     manager.wsUpgradeFor(sessionId)(req, socket, head, innerSubpath);
   *   });
   */
  wsUpgradeFor(sessionId: string): (req: IncomingMessage, socket: Duplex, head: Buffer, innerSubpath?: string) => void {
    return async (req, socket, head, innerSubpath) => {
      const internal = this.sessions.get(sessionId);
      if (!internal) {
        writeSocketStatus(socket, "HTTP/1.1 404 Not Found\r\n\r\n");
        return;
      }
      if (internal.session.status === "ended") {
        writeSocketStatus(socket, "HTTP/1.1 410 Gone\r\n\r\n");
        return;
      }
      try {
        // Resolve the inner's actual Chrome CDP URL. innerHost is stored
        // without IPv6 brackets (so it works as `http.request` hostname);
        // wrap it for URL string contexts.
        const innerHostForUrl = internal.session.innerHost.includes(":")
          ? `[${internal.session.innerHost}]`
          : internal.session.innerHost;
        const cdpRes = await fetch(`http://${innerHostForUrl}:${internal.session.innerPort}/api/browser-cdp`);
        if (!cdpRes.ok) throw new Error(`Inner /api/browser-cdp returned ${cdpRes.status}`);
        const { cdpUrl } = (await cdpRes.json()) as { cdpUrl: string };

        const cdpParsed = new URL(cdpUrl.replace(/^ws/, "http"));
        const cdpPort = parseInt(cdpParsed.port || "80", 10);
        const cdpHost = cdpParsed.hostname;

        // Default path: the browser CDP root from Chrome.
        // If innerSubpath is /page/<id>, rewrite to Chrome's /devtools/page/<id>.
        let targetPath = cdpParsed.pathname;
        if (innerSubpath && innerSubpath.startsWith("/page/")) {
          targetPath = `/devtools${innerSubpath}`;
        }

        const targetSocket = net.createConnection(cdpPort, cdpHost);
        targetSocket.on("connect", () => {
          let headers = `GET ${targetPath} HTTP/1.1\r\nHost: ${cdpHost}:${cdpPort}\r\n`;
          for (const [k, v] of Object.entries(req.headers)) {
            const kl = k.toLowerCase();
            // Strip host (replaced above) and origin (Chrome CDP validates origin;
            // omitting it bypasses the check for proxied local connections).
            if (kl !== "host" && kl !== "origin") {
              headers += `${k}: ${Array.isArray(v) ? v.join(", ") : v}\r\n`;
            }
          }
          headers += "\r\n";
          targetSocket.write(headers);
          if (head.length) targetSocket.write(head);
          targetSocket.pipe(socket);
          socket.pipe(targetSocket);
        });
        targetSocket.on("error", () => {
          if (!("destroyed" in socket) || !(socket as { destroyed: boolean }).destroyed) socket.destroy();
        });
        socket.on("error", () => {
          if (!targetSocket.destroyed) targetSocket.destroy();
        });
        socket.on("close", () => {
          if (!targetSocket.destroyed) targetSocket.destroy();
        });
      } catch (err) {
        this.log(`[manager] WS upgrade for ${sessionId} failed: ${(err as Error).message}`);
        writeSocketStatus(socket, "HTTP/1.1 502 Bad Gateway\r\n\r\n");
      }
    };
  }

  /**
   * Graceful teardown — closes every session concurrently, resolves when
   * all have exited. Safe to call on SIGINT/SIGTERM from the CLI or from
   * the testbox container shutdown hook.
   */
  async shutdown(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.allSettled(sessionIds.map((id) => this.closeSession(id)));
  }
}

// -------------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------------

function readRequestBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // If the body parser already consumed the stream and populated `req.body`,
    // re-serialize it. Otherwise, read raw.
    if ((req as { body?: unknown }).body && typeof (req as { body?: unknown }).body === "object") {
      try {
        resolve(Buffer.from(JSON.stringify((req as { body: unknown }).body), "utf-8"));
        return;
      } catch {
        // fall through
      }
    }
    if (req.readableEnded) {
      resolve(Buffer.alloc(0));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function forwardToInner(
  req: Request,
  res: Response,
  innerHost: string,
  innerPort: number,
  body: Buffer,
  contentType: string | string[] | undefined,
): Promise<void> {
  return new Promise((resolve) => {
    const ct = Array.isArray(contentType) ? contentType[0] : contentType;
    const proxyReq = http.request(
      {
        hostname: innerHost,
        port: innerPort,
        path: req.originalUrl,
        method: req.method,
        headers: {
          "content-type": ct || "application/json",
          "content-length": String(body.length),
        },
        timeout: 300_000,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.on("data", (chunk: Buffer) => res.write(chunk));
        proxyRes.on("end", () => {
          res.end();
          resolve();
        });
        proxyRes.on("error", () => {
          if (!res.writableEnded) res.end();
          resolve();
        });
      },
    );
    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.status(502).json({ status: "error", message: "Inner server unavailable: " + err.message });
      } else if (!res.writableEnded) {
        res.end();
      }
      resolve();
    });
    proxyReq.end(body);
  });
}

function writeSocketStatus(socket: Duplex, line: string): void {
  try {
    if (!("destroyed" in socket) || !(socket as { destroyed: boolean }).destroyed) {
      socket.write(line);
      socket.destroy();
    }
  } catch {
    // ignore — socket already torn down
  }
}
