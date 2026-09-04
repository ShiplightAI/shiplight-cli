/**
 * Shiplight MCP Server
 *
 * Standalone MCP server binary that exposes Shiplight testing tools
 * over the Model Context Protocol (stdio transport).
 */

// Enable Playwright console API (playwright.generateLocator, etc.)
process.env.PWDEBUG = "console";

import { isBrokenPipe, formatThrown, createStderrConsole } from "./stdioGuards.js";

let exitingForBrokenStdio = false;
function exitForBrokenStdio(): void {
  if (exitingForBrokenStdio) return;
  exitingForBrokenStdio = true;
  process.exit(0);
}

function safeStderr(message: string): void {
  if (process.stderr.destroyed) return;
  if (process.stderr.errored) {
    if (isBrokenPipe(process.stderr.errored)) exitForBrokenStdio();
    return;
  }

  try {
    process.stderr.write(message);
  } catch (error) {
    if (isBrokenPipe(error)) exitForBrokenStdio();
  }
}

process.stdout.on("error", (error) => {
  if (isBrokenPipe(error)) {
    exitForBrokenStdio();
    return;
  }
  safeStderr(`[MCP] stdout error: ${formatThrown(error)}\n`);
});

process.stderr.on("error", (error) => {
  if (isBrokenPipe(error)) {
    exitForBrokenStdio();
  }
});

// Guard stdio transport integrity:
// Any console.log/info/debug from dependencies would write to stdout and corrupt JSON-RPC.
// Redirect them to stderr for this MCP server process.
const stderrConsole = createStderrConsole(safeStderr);
console.log = stderrConsole as typeof console.log;
console.info = stderrConsole as typeof console.info;
console.debug = stderrConsole as typeof console.debug;

// Last-resort process handlers. Preserve the previous non-fatal behavior for
// relay/Playwright errors, but exit cleanly if the MCP stdio channel is gone.
process.on('uncaughtException', (err) => {
  if (isBrokenPipe(err)) {
    exitForBrokenStdio();
    return;
  }
  safeStderr(`[MCP] Uncaught exception (non-fatal):\n${formatThrown(err)}\n`);
});
process.on('unhandledRejection', (reason) => {
  if (isBrokenPipe(reason)) {
    exitForBrokenStdio();
    return;
  }
  safeStderr(`[MCP] Unhandled rejection (non-fatal):\n${formatThrown(reason)}\n`);
});

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import dotenv from "dotenv";
import { showActionIndicator } from "./actionIndicator.js";

import {
  ToolRegistry,
  listResources,
  getResource,
  listPrompts,
  getPrompt,
} from "mcp-tools";
import type {
  SessionTools as SessionToolsType,
  RelayTools as RelayToolsType,
  BrowserTools as BrowserToolsType,
  DebugTools as DebugToolsType,
  LocalTestTools as LocalTestToolsType,
  SessionManager as SessionManagerType,
  ExtensionRelayServer as ExtensionRelayServerType,
} from "mcp-tools";
import { configureSdk } from "sdk-core";
import logger from "./logger.js";
import { trackNewSession } from "./telemetry.js";

// Load project-local environment variables from the current working directory
// without overriding variables already provided by the host or MCP client.
dotenv.config({ override: false });

/**
 * Lazily import browser-related modules to avoid loading Playwright
 * when running in cloud mode.
 */
async function importBrowserModules() {
  const {
    SessionTools,
    RelayTools,
    BrowserTools,
    DebugTools,
    LocalTestTools,
    SessionManager,
    ExtensionRelayServer,
    RelayElectionCoordinator,
  } = await import("mcp-tools");
  return {
    SessionTools,
    RelayTools,
    BrowserTools,
    DebugTools,
    LocalTestTools,
    SessionManager,
    ExtensionRelayServer,
    RelayElectionCoordinator,
  };
}

declare const __PACKAGE_VERSION__: string;

class ShiplightMCPServer {
  private server: Server;
  private registry: ToolRegistry;
  private sessionBackend: SessionManagerType | null = null;
  private sessionTools: SessionToolsType | null = null;
  private browserTools: BrowserToolsType | null = null;
  private debugTools: DebugToolsType | null = null;
  private localTestTools: LocalTestToolsType | null = null;
  private relayTools: RelayToolsType | null = null;
  private relayServer: ExtensionRelayServerType | null = null;
  private relayCoordinator: { stop(): Promise<void> } | null = null;

  constructor(
    private debugMode: boolean = false,
    private relayPort: number | null = null,
  ) {
    // Route all SDK logs to stderr so they don't pollute stdio MCP transport
    configureSdk({ stderrOnly: true });

    this.server = new Server(
      { name: "shiplight-mcp", version: "1.0.0" },
      {
        capabilities: { tools: {}, resources: {}, prompts: {} },
      }
    );

    this.registry = new ToolRegistry();
  }

  /**
   * Initialize browser-related tools.
   */
  private async initBrowserTools() {
    const TERMINATION_TIMEOUT = process.env.TERMINATION_TIMEOUT
      ? parseInt(process.env.TERMINATION_TIMEOUT, 10)
      : null;

    const {
      SessionTools,
      BrowserTools,
      DebugTools,
      LocalTestTools,
      SessionManager,
    } = await importBrowserModules();

    // Initialize backends
    this.sessionBackend = new SessionManager({
      terminationTimeout: TERMINATION_TIMEOUT,
      onBeforeAction: process.env.SHIPLIGHT_ACTION_INDICATORS === '1' ? showActionIndicator : undefined,
    });

    // Initialize tool instances
    this.sessionTools = new SessionTools(this.sessionBackend);
    this.browserTools = new BrowserTools(this.sessionBackend);
    this.debugTools = new DebugTools(this.sessionBackend);
    this.localTestTools = new LocalTestTools(this.sessionBackend);

    // Initialize RelayTools (attach_to_browser is always available for direct CDP)
    const { RelayTools } = await importBrowserModules();
    this.relayTools = new RelayTools(this.sessionBackend);

    // Register tools.
    // SessionTools: close_all is folded into close_session (empty session_id),
    // and get_session_state is not exposed.
    // DebugTools: clear_logs is not exposed.
    this.registry
      .registerTools(SessionTools, this.sessionTools, [
        'newSession',
        'saveStorageState',
        'closeSession',
      ])
      .registerAll(BrowserTools, this.browserTools)
      .registerTools(DebugTools, this.debugTools, [
        'getConsoleLogs',
        'getNetworkLogs',
      ])
      .registerAll(LocalTestTools, this.localTestTools)
      .registerAll(RelayTools, this.relayTools);
  }

  private async startRelayServer(): Promise<boolean> {
    if (this.relayPort === null) return false;

    const port = this.relayPort;
    const { RelayTools, ExtensionRelayServer, RelayElectionCoordinator } = await importBrowserModules();

    if (!this.sessionBackend || !this.relayTools) {
      logger.error('[MCP] Cannot start relay server: session backend not initialized');
      return false;
    }

    const cdpUrl = `ws://127.0.0.1:${port}/cdp`;
    const coordinator = new RelayElectionCoordinator({
      port,
      onPromoted: async () => {
        this.relayServer = new ExtensionRelayServer();
        await this.relayServer.start(port);
        this.relayTools!.setRelayServer(this.relayServer);
        if (this.debugMode) {
          this.registry.registerAll(
            { toolDefinitions: RelayTools.debugToolDefinitions },
            this.relayTools!
          );
        }
        logger.info(`[MCP] Promoted to relay master on port ${port}`);
      },
      onDemoted: async () => {
        if (this.relayServer) {
          await this.relayServer.stop();
          this.relayServer = null;
        }
        this.relayTools!.setRemoteRelayUrl(cdpUrl);
        logger.info(`[MCP] Demoted from relay master`);
      },
    });
    this.relayCoordinator = coordinator;

    const role = await coordinator.start();

    if (role === 'master') {
      logger.info(`[MCP] Relay master on port ${port}`);
      // Debug tools already registered in onPromoted callback
    } else {
      // Follower: relay tools connect through master's CDP endpoint
      this.relayTools.setRemoteRelayUrl(coordinator.getCdpUrl());
      logger.info(`[MCP] Relay follower, master on port ${port}`);
    }

    return true;
  }

  private setupHandlers() {
    const { tools, handleToolCall } = this.registry.build();

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;
        const result = await handleToolCall(name, args);

        if (name === "new_session") {
          trackNewSession(__PACKAGE_VERSION__);
        }

        return { content: [{ type: "text", text: result }] };
      } catch (error) {
        let errorMessage =
          error instanceof Error ? error.message : String(error);
        if (axios.isAxiosError(error)) {
          // Include useful context: URL, status, and underlying cause
          const url = error.config?.url;
          const baseURL = error.config?.baseURL;
          const status = error.response?.status;
          const code = error.code;
          errorMessage = `${code || 'AxiosError'}: ${error.message}`;
          if (baseURL || url) errorMessage += ` (${baseURL || ''}${url || ''})`;
          if (status) errorMessage += ` [${status}]`;
          console.error(`[MCP] API error: ${errorMessage}`);
        }
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          errorMessage =
            "Authentication required. Contact info@shiplight.ai to get access to cloud services and advanced features.";
        }
        throw new McpError(ErrorCode.InternalError, errorMessage);
      }
    });

    // Resources and prompts
    {
      this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
        const resources = listResources();
        return { resources };
      });

      this.server.setRequestHandler(
        ReadResourceRequestSchema,
        async (request) => {
          const { uri } = request.params;
          const content = await getResource(uri);
          if (!content) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              `Unknown resource: ${uri}`
            );
          }

          return {
            contents: [{ uri, mimeType: "text/markdown", text: content }],
          };
        }
      );

      this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
        const prompts = listPrompts();
        return {
          prompts: prompts.map((p) => ({
            name: p.name,
            description: p.description,
          })),
        };
      });

      this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const { name } = request.params;
        const promptContent = getPrompt(name);
        if (!promptContent) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown prompt: ${name}`
          );
        }
        return {
          messages: [
            { role: "user", content: { type: "text", text: promptContent } },
          ],
        };
      });
    }
  }

  async run() {
    await this.initBrowserTools();

    // Start relay server before registering handlers (so relay tools are included)
    await this.startRelayServer();

    this.setupHandlers();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info("Shiplight MCP Server running on stdio");
  }
}

export async function startServer() {
  const debugMode = process.argv.includes("--debug");
  const relayPort = process.env.SHIPLIGHT_RELAY_PORT ? parseInt(process.env.SHIPLIGHT_RELAY_PORT, 10) || null : null;
  const server = new ShiplightMCPServer(debugMode, relayPort);
  await server.run();
}
