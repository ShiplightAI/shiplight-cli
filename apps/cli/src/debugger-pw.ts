/**
 * Playwright Debugger — public entry point for `shiplightai/debugger-pw`.
 *
 * Imported by the generated debug test file inside a Playwright test context.
 * Starts an internal HTTP server with int-runner routes,
 * backed by PlaywrightSandboxService.
 */

import express from "express";
import path from "path";
import type { Page } from "playwright";
import type { WebAgent } from "sdk-core";

export { PlaywrightSandboxService } from "./debugger/services/playwrightSandbox.js";
import { PlaywrightSandboxService } from "./debugger/services/playwrightSandbox.js";
import { discoverChromiumCdpUrl } from "sdk-core";
import type { TestContext } from "./fixture.js";

export interface PlaywrightDebugOptions {
  yamlFilePath: string;
  port: number;
  page: Page;
  agent: WebAgent;
  /** Proxy-backed test context from the `testContext` fixture, shared with `agent`'s VariableStore. */
  testContext: TestContext;
  /** Directory containing playwright.config.ts — used to resolve the fixtures dir. */
  projectRoot?: string;
}

/**
 * Start the internal sandbox server backed by a Playwright-provided page and agent.
 */
export async function startPlaywrightDebugServer(
  options: PlaywrightDebugOptions
): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const { yamlFilePath, port, page, agent, testContext, projectRoot } = options;

  const testDataDir = projectRoot ?? path.dirname(yamlFilePath);
  const sandbox = new PlaywrightSandboxService(page, agent, testDataDir, projectRoot, testContext);

  // Discover Chromium's CDP URL via sdk-core's unified helper (walks the
  // process tree, reads DevToolsActivePort). Debugger does NOT register with
  // the browser registry — the debugger SPA shows its own embedded live view
  // inside the iframe, so there's no external consumer that needs the entry.
  // DebuggerManager's spawn env clears OMNITERM_BROWSER_REGISTRY_URL so the fixture's
  // own registerBrowser is also a no-op for this subtree.
  try {
    const cdpUrl = await discoverChromiumCdpUrl(process.pid);
    sandbox.setCdpEndpoint(cdpUrl);
    console.error(`[debugger] CDP endpoint: ${cdpUrl}`);
  } catch (err) {
    console.error(`[debugger] Could not discover CDP endpoint: ${(err as Error).message}`);
  }

  const app = express();
  app.use(express.json({ limit: "10mb" }));

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

  // Mount routes
  const { createTestFlowRouter } = await import("./debugger/routes/testFlow.js");
  const { createIntRunnerRouter } = await import("./debugger/routes/intRunner.js");

  // Serve .shiplight/artifacts/ so the embedded SPA can load screenshots/video.
  const artifactsDir = path.join(projectRoot ?? path.dirname(yamlFilePath), ".shiplight", "artifacts");
  app.use("/api/report-assets", express.static(artifactsDir));

  // Test-flow route serves as a health check for readiness polling
  app.use(createTestFlowRouter({ initialDir: path.dirname(yamlFilePath), initialFile: yamlFilePath, projectRoot }));
  app.use(createIntRunnerRouter(sandbox as any));

  const server = await new Promise<import("http").Server>((resolve, reject) => {
    // Bind explicitly to IPv4 loopback. "localhost" resolves to IPv6 on modern
    // macOS, which makes IPv4-only callers (the DebuggerManager's proxy, the
    // readiness probe a few lines below) unable to connect even though the
    // inner is healthy.
    const s = app.listen(port, "127.0.0.1", () => resolve(s));
    s.on("error", reject);
  });

  const url = `http://localhost:${port}`;

  return {
    url,
    close: async () => {
      await sandbox.cleanupAll();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
