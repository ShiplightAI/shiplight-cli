/**
 * Debugger Server (CLI mode)
 *
 * Thin Express shell around `DebuggerManager`. Serves:
 *
 *   /                            → multi-tab shell SPA (dist/static/)
 *   /api/files, /api/test-flow,… → file-tree + YAML read/write (createTestFlowRouter)
 *   /api/debugger/sessions       → session CRUD (createDebuggerHttpRoutes)
 *   /debugger/:sessionId/*       → embedded per-session SPA (dist/static-embedded/)
 *                                  + HTTP/WS reverse proxy to that session's inner
 *                                    Playwright process via the manager.
 *
 * Multi-session from day one: the shell can open as many parallel debug
 * sessions as the user wants. There is no longer a "current session" at the
 * outer layer — every request that touches an inner process goes through
 * `/debugger/:sessionId/*` and is dispatched by the manager.
 *
 * See specs/_archive/004-testbox-debugger/plan.md (shared manager + routes) and
 * specs/_archive/007-cli-multi-session-shell/plan.md (the shell that replaced the
 * pre-existing single-session root SPA).
 */

import express from "express";
import * as net from "net";
import * as http from "http";
import * as path from "path";
import { createRequire } from "node:module";
import { createTestFlowRouter } from "./routes/testFlow.js";
import { DebuggerManager } from "./manager.js";
import { createDebuggerHttpRoutes, handleDebuggerUpgrade } from "./serverRoutes.js";

// Resolve the vendored Chrome DevTools assets out of the @shiplightai/devtools-assets
// package. Splitting it out lets npm's content-addressed cache reuse the unchanged
// devtools tarball across shiplightai upgrades.
const requireFromHere = createRequire(import.meta.url);
let devtoolsAssetsDir: string;
try {
  devtoolsAssetsDir = path.join(
    path.dirname(requireFromHere.resolve("@shiplightai/devtools-assets/package.json")),
    "dist",
  );
} catch {
  console.error(
    "[debugger] Required peer package @shiplightai/devtools-assets is not installed. " +
    "Reinstall shiplightai (it pulls the assets package as a dependency)."
  );
  process.exit(1);
}

export interface DebuggerServerOptions {
  /** Starting directory for the file browser sidebar. */
  initialDir: string;
  /** Absolute path the shell will pre-open as a tab on launch (set when invoked with a file argument). */
  initialFile?: string;
  /** Directory containing playwright.config.ts — default expanded node in file tree. */
  projectRoot?: string;
  port: number;
  /** Force a visible Chromium window, overriding `use.headless`. Defaults to false. */
  headed?: boolean;
}

export async function startDebuggerServer(
  options: DebuggerServerOptions
): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const { initialDir, initialFile, projectRoot, port, headed = false } = options;

  const manager = new DebuggerManager({ headed });

  const app = express();

  // CORS for localhost development
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, Cache-Control, Idempotency-Key"
    );
    if (_req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: "10mb" }));

  // File-tree + YAML read/write routes. Used by the multi-tab shell to list
  // *.test.yaml files and by the embedded SPA (when not under a session prefix)
  // for its own metadata calls. Also used as fallback for idle sessions.
  const testFlowRouter = createTestFlowRouter({ initialDir, initialFile, projectRoot });
  app.use(testFlowRouter);

  // Serve .shiplight/artifacts/ (screenshots, videos) so the frontend
  // can reference them via /api/report-assets/<relative-path>.
  const artifactsDir = path.join(projectRoot ?? initialDir, ".shiplight", "artifacts");
  app.use("/api/report-assets", express.static(artifactsDir));

  // Two static bundles, built by separate vite configs (see
  // specs/_archive/007-cli-multi-session-shell/plan.md):
  //   - dist/static/          → multi-tab shell, served at the root URL `/`
  //   - dist/static-embedded/ → embedded per-session SPA, served at /debugger/:id/
  //
  // When running built code, import.meta.dirname is dist/ so the relative paths
  // resolve directly. When running via tsx (dev), import.meta.dirname is
  // src/debugger/ — walk up to the package root.
  const currentDir = typeof import.meta.dirname === "string" ? import.meta.dirname : __dirname;
  const fromSrc = currentDir.includes(path.sep + "src" + path.sep);
  const shellDir = fromSrc
    ? path.resolve(currentDir, "../../dist/static")
    : path.join(currentDir, "static");
  const embeddedDir = fromSrc
    ? path.resolve(currentDir, "../../dist/static-embedded")
    : path.join(currentDir, "static-embedded");
  // Mount /devtools before the shell static handler so /devtools/* hits the
  // standalone DevTools asset package, not the shell.
  app.use("/devtools", express.static(devtoolsAssetsDir));
  app.use(express.static(shellDir));

  // Multi-session control plane + per-session HTTP reverse proxy. Mounts:
  //   POST   /api/debugger/sessions, GET /api/debugger/sessions, DELETE …
  //   GET    /debugger/:sessionId/  (HTML shell + asset URL rewrite)
  //   ANY    /debugger/:sessionId/* (forwarded to that session's inner)
  // The embedded SPA's static assets are served from /debugger/static/* (embeddedDir).
  app.use(createDebuggerHttpRoutes({ manager, staticDir: embeddedDir, fallbackRouter: testFlowRouter, artifactsDir }));

  // SPA fallback — serve the shell's index.html for non-API routes.
  app.get("*path", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(shellDir, "index.html"), (err) => {
      if (err) {
        res.send(getPlaceholderHtml(initialDir, port));
      }
    });
  });

  // Start server
  const server = await new Promise<http.Server>((resolve, reject) => {
    const s = app.listen(port, "localhost", () => {
      resolve(s);
    });
    s.on("error", reject);
  });

  // WebSocket upgrades. Only the session-scoped path is recognised:
  //   /ws/debugger/:sessionId/cdp-browser[/page/<target>]
  server.on("upgrade", (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    const upgradeUrl = req.url ?? "";
    if (upgradeUrl.startsWith("/ws/debugger/")) {
      handleDebuggerUpgrade(manager, req, socket, head);
      return;
    }
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  });

  // When invoked with a file argument, append `?open=<abs path>` so the
  // shell auto-opens that file as a tab on first load. The shell reads this
  // query param on mount and POSTs /api/debugger/sessions.
  const baseUrl = `http://localhost:${port}`;
  const url = initialFile
    ? `${baseUrl}/?open=${encodeURIComponent(initialFile)}`
    : baseUrl;
  console.error(`[debugger] Server running at ${baseUrl}`);
  console.error(`[debugger] Directory: ${initialDir}`);
  if (initialFile) {
    console.error(`[debugger] File: ${initialFile}`);
  }

  return {
    url,
    close: async () => {
      await manager.shutdown();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

function getPlaceholderHtml(dir: string, port: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Shiplight Debugger</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
           max-width: 600px; margin: 80px auto; padding: 0 20px; color: #333; }
    h1 { font-size: 24px; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 14px; }
    .status { color: #666; margin-top: 40px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Shiplight Debugger</h1>
  <p>Directory: <code>${dir}</code></p>
  <p>Server: localhost:${port}</p>
</body>
</html>`;
}
