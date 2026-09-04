/**
 * Session Tools
 *
 * Provides tools for creating and managing browser/device sessions.
 * Login happens only at session creation time for a clear mental model.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { logger } from "sdk-core";
import type { SessionManager } from "../backends/SessionManager.js";

/** Exported for testing — the runtime schema used by new_session handler */
export const newSessionArgsSchema = z.object({
  starting_url: z.string().optional(),
  storage_state_path: z.string().optional(),
  browser_options: z
    .object({
      viewport: z.object({
        width: z.number(),
        height: z.number(),
      }).optional(),
      is_mobile: z.boolean().optional(),
      has_touch: z.boolean().optional(),
      user_agent: z.string().optional(),
      color_scheme: z.enum(["light", "dark", "no-preference"]).optional(),
      timezone_id: z.string().optional(),
      geolocation: z.object({
        latitude: z.number(),
        longitude: z.number(),
        accuracy: z.number().optional(),
      }).optional(),
      locale: z.string().optional(),
      disable_security: z.boolean().optional(),
      record_evidence: z.boolean().optional(),
      headless: z.boolean().optional(),
      proxy: z
        .object({
          server: z.string(),
          username: z.string().optional(),
          password: z.string().optional(),
        })
        .optional(),
      path_to_extension: z.string().optional(),
      user_data_dir: z.string().optional(),
    })
    .optional(),
});

export class SessionTools {
  constructor(
    private backend: SessionManager,
    private webAgentModel?: string,
  ) {}


  // ============================================================================
  // New Session Tool
  // ============================================================================

  static readonly newSessionTool = {
    name: "new_session",
    description:
      "Create a new browser session with optional device emulation. Returns a session_id for subsequent operations. " +
      "Use storage_state_path to restore a previously saved session (cookies, localStorage, IndexedDB). " +
      "SCREEN RECORDING: Set browser_options.record_evidence=true only when you believe implementation is complete and are doing a final verification pass — not for exploration, investigation, or mid-task checking. This produces a video and trace the user can watch to confirm the finished change works. Both are saved automatically when the session is closed. " +
      "After creating a session, IMMEDIATELY read resource 'shiplight://schemas/action-entity' for action parameter formats before calling any other tools. " +
      "To read it: first call ListMcpResourcesTool (without a server parameter) to discover the correct server name, then call ReadMcpResourceTool with that server name and uri 'shiplight://schemas/action-entity'.",
    inputSchema: zodToJsonSchema(
      z.object({
        starting_url: z
          .string()
          .optional()
          .describe("Starting URL (defaults to about:blank)"),
        storage_state_path: z
          .string()
          .optional()
          .describe("Path to a storage state file to restore cookies, localStorage, and IndexedDB into the session."),
        browser_options: z
          .object({
            viewport: z.object({
              width: z.number().describe("Viewport width in pixels"),
              height: z.number().describe("Viewport height in pixels"),
            }).optional().describe("Viewport size. Default: 1280x720. Common: mobile (390x844), tablet (768x1024), desktop (1920x1080)."),
            is_mobile: z.boolean().optional().describe("Emulate mobile device behavior (mobile CSS media queries, meta viewport tag). Default: false"),
            has_touch: z.boolean().optional().describe("Enable touch events. Default: false"),
            user_agent: z.string().optional().describe("Custom user agent string"),
            color_scheme: z.enum(["light", "dark", "no-preference"]).optional().describe("Emulated color scheme. Default: light"),
            timezone_id: z.string().optional().describe("Timezone ID (e.g., 'America/New_York', 'Europe/London')"),
            geolocation: z.object({
              latitude: z.number(),
              longitude: z.number(),
              accuracy: z.number().optional(),
            }).optional().describe("Emulated geolocation"),
            locale: z.string().optional().describe("Browser locale (e.g., 'en-US', 'ja-JP')"),
            disable_security: z.boolean().optional().describe("Disable web security (CORS, CSP). Default: false"),
            record_evidence: z.boolean().optional().describe("Enable video and trace recording. Set to true when verifying features or bug fixes so the user can watch the recording and review the trace."),
            headless: z.boolean().optional().describe("Run browser in headless mode"),
            proxy: z
              .object({
                server: z.string(),
                username: z.string().optional(),
                password: z.string().optional(),
              })
              .optional()
              .describe("Proxy configuration"),
            path_to_extension: z
              .string()
              .optional()
              .describe("Path to unpacked Chrome extension directory. Launches a persistent Chromium context with --load-extension (headed mode forced, as headless Chrome cannot load extensions). See: https://playwright.dev/docs/chrome-extensions"),
            user_data_dir: z
              .string()
              .optional()
              .describe("Chrome user data directory for persistent profile. Caches extension state, Google OAuth sessions, chrome.storage.local data between sessions. If omitted, a fresh temp profile is created and cleaned up on close."),
          })
          .optional()
          .describe("Browser launch and emulation options."),
      }),
      { $refStrategy: "none" }
    ),
  };

  async newSession(args: unknown): Promise<string> {
    logger.info("[SessionTools.newSession] Starting with args:", JSON.stringify(args));

    const { starting_url, storage_state_path, browser_options } =
      newSessionArgsSchema.parse(args);

    const finalUrl = starting_url || "about:blank";

    logger.info("[SessionTools.newSession] Creating session with URL:", finalUrl);
    let sessionId: string;
    try {
      const result = await this.backend.createSession({
        startingUrl: finalUrl,
        browserOptions: {
          viewport: browser_options?.viewport ?? { width: 1280, height: 720 },
          isMobile: browser_options?.is_mobile,
          hasTouch: browser_options?.has_touch,
          userAgent: browser_options?.user_agent,
          colorScheme: browser_options?.color_scheme,
          timezoneId: browser_options?.timezone_id,
          geolocation: browser_options?.geolocation,
          locale: browser_options?.locale,
          disableSecurity: browser_options?.disable_security ?? false,
          recordEvidence: browser_options?.record_evidence,
          headless: browser_options?.headless ?? (process.env.PLAYWRIGHT_HEADED !== undefined ? process.env.PLAYWRIGHT_HEADED !== 'true' : false),
          proxy: browser_options?.proxy,
          storageStatePath: storage_state_path,
          pathToExtension: browser_options?.path_to_extension,
          userDataDir: browser_options?.user_data_dir,
        },
        webAgentConfig: {
          model: this.webAgentModel,
        },
      });
      sessionId = result.sessionId;
      logger.info("[SessionTools.newSession] Session created:", sessionId);
    } catch (error) {
      logger.info("[SessionTools.newSession] Error creating session:", error);
      throw error;
    }

    logger.info("[SessionTools.newSession] Getting current URL");
    const currentUrl = await this.backend.getCurrentUrl(sessionId);
    logger.info("[SessionTools.newSession] Current URL:", currentUrl);

    const debugPort = this.backend.getDebugPort(sessionId) ?? null;

    return JSON.stringify({
      session_id: sessionId,
      debug_port: debugPort,
      current_url: currentUrl,
      storage_state_loaded: !!storage_state_path,
      message: storage_state_path
        ? `Session created with restored storage state at ${currentUrl}`
        : `Session created at ${currentUrl}`,
      do_this_now: "You MUST read resource 'shiplight://schemas/action-entity' before calling any other shiplight tools. Call ListMcpResourcesTool (no server parameter) to discover the correct server name, then ReadMcpResourceTool with that server name and uri 'shiplight://schemas/action-entity'.",
    });
  }

  // ============================================================================
  // Save Storage State Tool
  // ============================================================================

  static readonly saveStorageStateTool = {
    name: "save_storage_state",
    description:
      "Save the browser session's storage state (cookies, localStorage, IndexedDB) to a file. " +
      "Use this after logging in to cache the session for fast restores via new_session's storage_state_path.",
    inputSchema: zodToJsonSchema(
      z.object({
        session_id: z.string().describe("Session ID"),
        path: z.string().describe("File path to save the storage state to (e.g., ~/.shiplight/storage-states/my-app.json)"),
      }),
      { $refStrategy: "none" }
    ),
  };

  async saveStorageState(args: unknown): Promise<string> {
    const { session_id, path: filePath } = z
      .object({
        session_id: z.string(),
        path: z.string(),
      })
      .parse(args);

    await this.backend.saveStorageState(session_id, filePath);

    return JSON.stringify({
      path: filePath,
      message: `Storage state saved to ${filePath}`,
    });
  }

  // ============================================================================
  // Close Session Tool
  // ============================================================================

  static readonly closeSessionTool = {
    name: "close_session",
    description:
      "Close a browser session. Omit session_id entirely to close ALL open sessions.",
    inputSchema: zodToJsonSchema(
      z.object({
        session_id: z
          .string()
          .optional()
          .describe("Session ID to close. Omit entirely to close all open sessions."),
      }),
      { $refStrategy: "none" }
    ),
  };

  async closeSession(args: unknown): Promise<string> {
    // Accept null as well as undefined — LLM clients commonly send
    // {"session_id": null} to mean "absent", which should close all, not error.
    const { session_id } = z
      .object({ session_id: z.string().nullish() })
      .parse(args);

    // Omitting session_id (or passing null) closes ALL sessions (folds in the
    // former close_all tool). A provided-but-empty session_id is rejected rather
    // than silently closing everything — an empty/unresolved id almost always
    // signals a caller bug, and mass-closing on it would be destructive.
    if (session_id == null) {
      const count = this.backend.getSessionCount();
      await this.backend.closeAllSessions();
      return JSON.stringify({
        message: `Closed ${count} session(s)`,
      });
    }

    if (session_id.trim() === "") {
      throw new Error(
        "session_id was empty. Omit session_id entirely to close all sessions, or pass a valid session id."
      );
    }

    const result = await this.backend.closeSession(session_id);

    const parts: string[] = [];
    if (result.videoPath) parts.push(`Local video recording saved to: ${result.videoPath}`);
    if (result.tracePath) parts.push(`Local trace saved to: ${result.tracePath}`);
    if (result.reportDataPath) parts.push(`Local report snapshot saved to: ${result.reportDataPath}`);

    const response: Record<string, string> = {
      message: parts.length > 0
        ? `Session ${session_id} closed. ${parts.join(' ')}`
        : `Session ${session_id} closed successfully`,
    };
    if (result.videoPath) response.local_video_path = result.videoPath;
    if (result.tracePath) response.local_trace_path = result.tracePath;
    if (result.reportDataPath) response.report_data_path = result.reportDataPath;
    return JSON.stringify(response);
  }

  // ============================================================================
  // Close All Sessions Tool
  // ============================================================================

  static readonly closeAllSessionsTool = {
    name: "close_all",
    description: "Close all browser sessions",
    inputSchema: zodToJsonSchema(z.object({}), { $refStrategy: "none" }),
  };

  async closeAllSessions(): Promise<string> {
    const count = this.backend.getSessionCount();
    await this.backend.closeAllSessions();
    return JSON.stringify({
      message: `Closed ${count} session(s)`,
    });
  }

  // ============================================================================
  // Get Current State Tool
  // ============================================================================

  static readonly getCurrentStateTool = {
    name: "get_session_state",
    description: "Get current state of a session (URL, session type)",
    inputSchema: zodToJsonSchema(
      z.object({
        session_id: z.string().describe("Session ID"),
      }),
      { $refStrategy: "none" }
    ),
  };

  async getCurrentState(args: unknown): Promise<string> {
    const { session_id } = z.object({ session_id: z.string() }).parse(args);

    const session = this.backend.getSession(session_id);
    if (!session) {
      throw new Error(`Session ${session_id} not found`);
    }

    const currentUrl = await this.backend.getCurrentUrl(session_id);

    return JSON.stringify({
      session_id,
      current_url: currentUrl,
      session_type: session.sessionType,
    });
  }

  // ============================================================================
  // Export all tool definitions
  // ============================================================================

  static readonly toolDefinitions = [
    SessionTools.newSessionTool,
    SessionTools.saveStorageStateTool,
    SessionTools.closeSessionTool,
    SessionTools.closeAllSessionsTool,
    SessionTools.getCurrentStateTool,
  ];
}
