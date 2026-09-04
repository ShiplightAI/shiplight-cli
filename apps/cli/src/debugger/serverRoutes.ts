/**
 * Multi-session debugger HTTP + WS routes — shared between the CLI
 * (`shiplight debug`), the testbox OmniTerm server, and future consumers
 * like the VSCode extension.
 *
 * All three hosts mount the same routes and the same URL scheme:
 *
 *   POST   /api/debugger/sessions          — open a session for a yaml path
 *   GET    /api/debugger/sessions          — list live sessions
 *   DELETE /api/debugger/sessions/:id      — close a session
 *   GET    /debugger/static/*              — debugger SPA bundle
 *   GET    /debugger/:sessionId/           — HTML shell for the iframe
 *   ANY    /debugger/:sessionId/*          — HTTP reverse proxy to the inner
 *   (upgrade) /ws/debugger/:sessionId/*    — WebSocket proxy (via handleDebuggerUpgrade)
 *
 * The shared module is host-agnostic; each consumer supplies:
 *  - the `DebuggerManager` instance (shared so all sessions live in one map)
 *  - the static asset directory (where the built debugger SPA lives)
 *  - an optional `resolveYamlPath` gate (the testbox uses confinePath; the
 *    CLI has no trusted root so it accepts any reachable yaml)
 *
 * See specs/_archive/004-testbox-debugger/contracts/{session-api,proxy-routes,embedded-ui}.md
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { Router } from "express";
import express from "express";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import * as fs from "fs";
import * as path from "path";
import type { DebuggerManager } from "./manager.js";
import { createEmailForwardingRouter } from "./routes/emailForwarding.js";

export interface ServerRoutesOptions {
  /** The shared multi-session manager. One instance per host process. */
  manager: DebuggerManager;
  /**
   * Absolute path to the directory serving the built debugger SPA (contains
   * `index.html` + `assets/`). The testbox stages this from the CLI's build
   * output; the CLI points directly at its own `dist/static`.
   */
  staticDir: string;
  /**
   * Optional gate on the incoming yamlPath. Return the absolute path to
   * allow, or `null` to refuse with 403. Defaults to pass-through absolute
   * resolution — suitable for the CLI, where path confinement is the OS's
   * job. The testbox supplies `confinePath(raw, allowedRoots())`.
   */
  resolveYamlPath?: (raw: string) => string | null;
  /**
   * Optional override for the liveview-url builder. Receives the session-id
   * from the URL + the incoming request; returns the ws:// URL the SPA
   * should connect to for the live CDP DevTools view. Defaults to
   * `ws://host/ws/debugger/:sessionId/cdp-browser`.
   */
  liveviewUrlBuilder?: (sessionId: string, req: Request) => string;
  /**
   * Fallback router for idle sessions (no sandbox process). When the SPA
   * makes file-related API calls (`/api/test-flow`, `/api/files`, etc.)
   * through the session proxy but the sandbox isn't running, the proxy
   * delegates to this router instead of forwarding to the inner process.
   */
  fallbackRouter?: Router;
  /**
   * Absolute path to the artifacts directory (screenshots, videos).
   * When set, `/api/report-assets/*` requests inside a session are served
   * from this directory instead of being proxied to the inner process.
   */
  artifactsDir?: string;
}

function defaultResolveYamlPath(raw: string): string | null {
  if (!raw) return null;
  // Absolute resolve (no confinement — the caller trusts its own environment).
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(raw);
}

function defaultLiveviewUrlBuilder(sessionId: string, req: Request): string {
  const host = req.headers.host ?? "127.0.0.1";
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "ws";
  const wsProto = proto === "https" ? "wss" : "ws";
  return `${wsProto}://${host}/ws/debugger/${sessionId}/cdp-browser`;
}

function isTestYamlBasename(absolutePath: string): boolean {
  const base = path.basename(absolutePath);
  return base.endsWith(".test.yaml") || base.endsWith(".test.yml");
}

export function createDebuggerHttpRoutes(opts: ServerRoutesOptions): Router {
  const {
    manager,
    staticDir,
    resolveYamlPath = defaultResolveYamlPath,
    liveviewUrlBuilder = defaultLiveviewUrlBuilder,
    fallbackRouter,
    artifactsDir,
  } = opts;

  const router = Router();
  const reportAssetsHandler: RequestHandler | null = artifactsDir
    ? express.static(artifactsDir)
    : null;

  // -------- Control plane --------
  router.post("/api/debugger/sessions", express.json(), async (req, res) => {
    const raw = (req.body as { yamlPath?: unknown } | undefined)?.yamlPath;
    if (typeof raw !== "string" || !raw) {
      res.status(400).json({ error: "yamlPath is required" });
      return;
    }
    const resolved = resolveYamlPath(raw);
    if (!resolved) {
      res.status(403).json({ error: "Path outside allowed roots" });
      return;
    }
    if (!isTestYamlBasename(resolved)) {
      res.status(400).json({ error: "Not a Shiplight test file (expected *.test.yaml or *.test.yml)" });
      return;
    }
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const existing = manager.listSessions().find((s) => s.yamlPath === resolved && s.status !== "ended");
    try {
      const session = manager.openSession(resolved);
      res.status(existing ? 200 : 201).json({
        sessionId: session.sessionId,
        yamlPath: session.yamlPath,
        startedAt: session.startedAt,
        status: session.status,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/api/debugger/sessions", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      sessions: manager.listSessions().map((s) => ({
        sessionId: s.sessionId,
        yamlPath: s.yamlPath,
        startedAt: s.startedAt,
        status: s.status,
      })),
    });
  });

  router.delete("/api/debugger/sessions/:sessionId", async (req, res) => {
    const sessionId = req.params.sessionId;
    const existed = !!manager.getSession(sessionId);
    await manager.closeSession(sessionId);
    res.json({ deleted: true, alreadyGone: !existed });
  });

  // -------- Static debugger SPA --------
  if (fs.existsSync(staticDir)) {
    router.use("/debugger/static", express.static(staticDir));
  } else {
    console.error(`[debugger] WARNING: debugger static dir missing at ${staticDir} — iframe routes will 404`);
  }

  // -------- Iframe HTML shell --------
  // Serves the SPA for any existing session (idle or running).
  router.get("/debugger/:sessionId/", (req, res) => {
    const sessionId = req.params.sessionId;
    const session = manager.getSession(sessionId);
    if (!session) {
      res.status(404).send("Debugger session not found");
      return;
    }
    const indexPath = path.join(staticDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      res.status(500).send(`Debugger SPA bundle missing at ${indexPath}`);
      return;
    }
    const raw = fs.readFileSync(indexPath, "utf-8");
    const rewritten = raw
      .replace(/(src|href)="\/assets\//g, `$1="/debugger/static/assets/`)
      .replace(/(src|href)="\/index\.html/g, `$1="/debugger/static/index.html`);
    res.type("html").send(rewritten);
  });

  // -------- Email forwarding proxy (no sandbox needed) --------
  router.use("/debugger/:sessionId", createEmailForwardingRouter());

  // -------- HTTP reverse proxy to the inner --------
  // For idle/starting sessions: auto-starts sandbox on create-session,
  // delegates file-related APIs to fallbackRouter, returns 503 for other
  // sandbox APIs.
  const proxyMiddleware: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    const sessionId = req.params.sessionId;
    if (sessionId === "static") return next();

    const session = manager.getSession(sessionId);
    if (!session) {
      res.status(404).json({ status: "error", message: "Session not found" });
      return;
    }

    const originalUrl = req.originalUrl;
    const prefix = `/debugger/${sessionId}`;
    if (originalUrl.startsWith(prefix)) {
      const stripped = originalUrl.slice(prefix.length) || "/";
      req.url = stripped;
      Object.defineProperty(req, "originalUrl", { value: stripped, configurable: true });
    }

    if (reportAssetsHandler && req.path.startsWith("/api/report-assets/")) {
      req.url = req.url.replace(/^\/api\/report-assets/, "");
      reportAssetsHandler(req, res, next);
      return;
    }

    if (session.status === "idle" || session.status === "starting") {
      const methodPath = `${req.method} ${req.path}`;

      if (methodPath === "POST /api/int-runner/create-session") {
        try {
          await manager.startSandbox(sessionId);
        } catch (err) {
          res.status(500).json({ status: "error", message: (err as Error).message });
          return;
        }
        // Sandbox is now running — fall through to normal proxy
      } else if (methodPath === "POST /api/int-runner/liveview-url") {
        res.json({ liveviewUrl: "", browserWsUrl: "" });
        return;
      } else if (req.path.startsWith("/api/int-runner/")) {
        res.status(503).json({ status: "error", message: "Sandbox not started" });
        return;
      } else if (fallbackRouter) {
        fallbackRouter(req, res, next);
        return;
      } else {
        res.status(503).json({ status: "error", message: "Sandbox not started" });
        return;
      }
    }

    const mw = manager.httpProxyFor(sessionId, {
      liveviewUrlBuilder: () => liveviewUrlBuilder(sessionId, req),
    }) as unknown as RequestHandler;
    mw(req, res, next);
  };
  router.use("/debugger/:sessionId", proxyMiddleware);

  return router;
}

/**
 * WebSocket upgrade dispatcher for `/ws/debugger/:sessionId/<inner-path>`.
 * Call from your HTTP server's `upgrade` listener when the URL matches:
 *
 *   if (url.startsWith("/ws/debugger/")) {
 *     handleDebuggerUpgrade(manager, req, socket, head);
 *     return;
 *   }
 */
export function handleDebuggerUpgrade(
  manager: DebuggerManager,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const url = req.url ?? "";
  const match = url.match(/^\/ws\/debugger\/([^/]+)(.*)$/);
  if (!match) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  const sessionId = match[1];
  let subpath = match[2] || "";
  // The embedded SPA connects to /ws/debugger/:id/cdp-browser[/page/<target>].
  // The manager's wsUpgradeFor expects "" for browser-level or "/page/<id>".
  if (subpath.startsWith("/cdp-browser/page/")) {
    subpath = subpath.slice("/cdp-browser".length); // "/page/<id>"
  } else if (subpath === "/cdp-browser" || subpath === "/cdp-browser/") {
    subpath = "";
  }
  manager.wsUpgradeFor(sessionId)(req, socket, head, subpath || undefined);
}
