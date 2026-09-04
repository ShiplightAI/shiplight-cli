/**
 * Relay Tools
 *
 * Tools for connecting to Chrome tabs via extension relay.
 * Single-session model: one relay session where all registered tabs
 * appear as Pages within one BrowserContext.
 */

import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { logger } from "sdk-core";
import type { SessionManager } from "../backends/SessionManager.js";
import type { ExtensionRelayServer } from "../backends/ExtensionRelayServer.js";

interface DebuggerPortInfo {
  port: number;
  yamlFile: string;
  pid: number;
  startedAt: string;
}

const RUN_DIR = ".shiplight/run";
const FILE_PREFIX = "debug-";

/**
 * Find the project root by walking up from startDir looking for package.json or .shiplight/.
 */
function findProjectRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(dir, "package.json")) ||
      fs.existsSync(path.join(dir, ".shiplight"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Discover running Shiplight debugger instances via .shiplight/run/ in the project root.
 */
function discoverDebuggers(): DebuggerPortInfo[] {
  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) return [];

  const dir = path.join(projectRoot, RUN_DIR);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.startsWith(FILE_PREFIX) && f.endsWith(".json"));
  } catch {
    return [];
  }

  const results: DebuggerPortInfo[] = [];
  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const info: DebuggerPortInfo = JSON.parse(content);
      try { process.kill(info.pid, 0); } catch {
        try { fs.unlinkSync(filePath); } catch {}
        continue;
      }
      results.push(info);
    } catch {
      // skip malformed
    }
  }
  return results;
}

export class RelayTools {
  private relayServer: ExtensionRelayServer | null;
  private remoteRelayUrl: string | null = null;

  constructor(
    private backend: SessionManager,
    relayServer?: ExtensionRelayServer | null
  ) {
    this.relayServer = relayServer ?? null;
  }

  setRelayServer(server: ExtensionRelayServer): void {
    this.relayServer = server;
  }

  setRemoteRelayUrl(url: string): void {
    this.remoteRelayUrl = url;
  }

  // ============================================================================
  // Attach to Browser
  // ============================================================================

  static readonly attachToBrowserTool = {
    name: "attach_to_browser",
    description:
      "Connect to a browser for testing. Two modes:\n" +
      "1. Direct CDP: pass cdp_url (e.g. from a debugger's /api/browser-cdp endpoint) to connect directly via Chrome DevTools Protocol.\n" +
      "2. Extension relay: omit cdp_url to auto-discover Chrome tabs via the Shiplight AI Chrome extension.\n" +
      "Returns session_id for use with inspect_page, act, get_page_info, switch_tab, etc.",
    inputSchema: zodToJsonSchema(
      z.object({
        cdp_url: z.string().optional().describe(
          "CDP WebSocket URL to connect to directly (e.g. ws://localhost:9222/devtools/browser/...). " +
          "If omitted, falls back to extension relay auto-discovery."
        ),
      }),
      { $refStrategy: "none" }
    ),
  };

  async attachToBrowser(args: unknown): Promise<string> {
    const { cdp_url } = z.object({
      cdp_url: z.string().optional(),
    }).parse(args);

    if (cdp_url) {
      // Direct CDP mode — connect to browser via WebSocket URL
      // Reuse existing session if one matches the same cdp_url
      const existingSession = this.backend.getAllSessions().find(
        s => s.sessionType === 'relay' && s.relayConnection?.cdpUrl === cdp_url
      );
      if (existingSession) {
        logger.info(`[RelayTools] Reusing existing CDP session: ${existingSession.sessionId}`);
        return JSON.stringify({
          session_id: existingSession.sessionId,
          session_type: "relay",
          message: `Reusing existing session connected to ${cdp_url}.`,
          do_this_now: "You MUST read resource 'shiplight://schemas/action-entity' before calling any other shiplight tools. Call ListMcpResourcesTool (no server parameter) to discover the correct server name, then ReadMcpResourceTool with that server name and uri 'shiplight://schemas/action-entity'."
        });
      }

      const { sessionId } = await this.backend.createRelaySession(cdp_url);
      logger.info(`[RelayTools] CDP session created: ${sessionId} → ${cdp_url}`);

      return JSON.stringify({
        session_id: sessionId,
        session_type: "relay",
        message: `Connected to browser via CDP at ${cdp_url}. Use inspect_page, act, etc.`,
        do_this_now: "You MUST read resource 'shiplight://schemas/action-entity' before calling any other shiplight tools. Call ListMcpResourcesTool (no server parameter) to discover the correct server name, then ReadMcpResourceTool with that server name and uri 'shiplight://schemas/action-entity'."
      });
    }

    // Try debugger discovery before relay fallback
    const debuggers = discoverDebuggers();
    if (debuggers.length > 0 && !this.relayServer) {
      // Return discovered debuggers so the AI can ask the user which one to connect to
      return JSON.stringify({
        status: "debuggers_found",
        debuggers: debuggers.map(d => ({
          port: d.port,
          yamlFile: d.yamlFile,
          pid: d.pid,
          startedAt: d.startedAt,
          cdp_endpoint: `http://localhost:${d.port}/api/browser-cdp`,
        })),
        message: debuggers.length === 1
          ? `Found 1 running debugger: ${debuggers[0].yamlFile} on port ${debuggers[0].port}. ` +
            `Fetch the CDP URL from http://localhost:${debuggers[0].port}/api/browser-cdp and call attach_to_browser again with cdp_url. ` +
            `Note: the browser must be started first (click "Start" in the debugger UI).`
          : `Found ${debuggers.length} running debuggers. Ask the user which one to connect to, ` +
            `then fetch the CDP URL from the chosen debugger's /api/browser-cdp endpoint and call attach_to_browser again with cdp_url.`,
      });
    }

    // Follower mode: connect to master relay via CDP
    if (!this.relayServer && this.remoteRelayUrl) {
      const cdpUrl = this.remoteRelayUrl;
      const existingSession = this.backend.getAllSessions().find(
        s => s.sessionType === 'relay' && s.relayConnection?.cdpUrl === cdpUrl
      );
      if (existingSession) {
        logger.info(`[RelayTools] Reusing existing follower relay session: ${existingSession.sessionId}`);
        return JSON.stringify({
          session_id: existingSession.sessionId,
          session_type: "relay",
          message: `Reusing existing session connected to master relay.`,
          do_this_now: "You MUST read resource 'shiplight://schemas/action-entity' before calling any other shiplight tools. Call ListMcpResourcesTool (no server parameter) to discover the correct server name, then ReadMcpResourceTool with that server name and uri 'shiplight://schemas/action-entity'."
        });
      }

      const { sessionId } = await this.backend.createRelaySession(cdpUrl);
      logger.info(`[RelayTools] Follower relay session created: ${sessionId} → ${cdpUrl}`);
      return JSON.stringify({
        session_id: sessionId,
        session_type: "relay",
        message: `Connected to browser via master relay. Use inspect_page, act, etc.`,
        do_this_now: "You MUST read resource 'shiplight://schemas/action-entity' before calling any other shiplight tools. Call ListMcpResourcesTool (no server parameter) to discover the correct server name, then ReadMcpResourceTool with that server name and uri 'shiplight://schemas/action-entity'."
      });
    }

    // Extension relay mode (existing behavior)
    if (!this.relayServer) {
      throw new Error('No cdp_url provided and no running debuggers found. Either pass cdp_url, start a debugger (shiplight debug <file>), or set SHIPLIGHT_RELAY_PORT in the project .env file to enable the Chrome extension relay.');
    }

    // Return existing relay session if one already exists
    const existingSession = this.backend.getAllSessions().find(s => s.sessionType === 'relay');
    if (existingSession) {
      const tabs = this.relayServer.getTabMapping();
      logger.info(`[RelayTools] Reusing existing relay session: ${existingSession.sessionId}`);

      return JSON.stringify({
        session_id: existingSession.sessionId,
        session_type: "relay",
        tabs: tabs.map(t => ({ url: t.url, title: t.title })),
        message: `Reusing existing relay session with ${tabs.length} tab(s).`,
        do_this_now: "You MUST read resource 'shiplight://schemas/action-entity' before calling any other shiplight tools. Call ListMcpResourcesTool (no server parameter) to discover the correct server name, then ReadMcpResourceTool with that server name and uri 'shiplight://schemas/action-entity'."
      });
    }

    // Create single relay session — tabs appear as pages when registered
    const cdpUrl = this.relayServer.getCdpUrl();
    const { sessionId } = await this.backend.createRelaySession(cdpUrl);

    const tabs = this.relayServer.getTabMapping();
    logger.info(`[RelayTools] Relay session created: ${sessionId} (${tabs.length} tab(s))`);

    return JSON.stringify({
      session_id: sessionId,
      session_type: "relay",
      tabs: tabs.map(t => ({ url: t.url, title: t.title })),
      message: `Relay session created with ${tabs.length} tab(s). Use inspect_page, act, switch_tab, etc.`,
      do_this_now: "You MUST read resource 'shiplight://schemas/action-entity' before calling any other shiplight tools. Call ListMcpResourcesTool (no server parameter) to discover the correct server name, then ReadMcpResourceTool with that server name and uri 'shiplight://schemas/action-entity'."
    });
  }

  // ============================================================================
  // Get Relay Status
  // ============================================================================

  static readonly getRelayStatusTool = {
    name: "get_relay_status",
    description: "Get extension relay server status and tab mapping",
    inputSchema: zodToJsonSchema(z.object({}), { $refStrategy: "none" }),
  };

  async getRelayStatus(args: unknown): Promise<string> {
    z.object({}).parse(args);

    if (!this.relayServer) {
      throw new Error('Relay server not initialized. Start the MCP server with --relay flag.');
    }

    return JSON.stringify({
      status: "running",
      port: this.relayServer.getPort(),
      connected_tabs: this.relayServer.getConnectedTabsCount(),
      tab_mapping: this.relayServer.getTabMapping(),
    });
  }

  // ============================================================================
  // Export all tool definitions
  // ============================================================================

  static readonly toolDefinitions = [
    RelayTools.attachToBrowserTool,
  ];

  static readonly debugToolDefinitions = [
    RelayTools.getRelayStatusTool,
  ];
}
