/**
 * Debug Tools
 *
 * Provides tools for debugging: console logs, network logs, and artifacts.
 * Uses injectable backends for different runtime environments.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { SessionManager } from "../backends/SessionManager.js";

export class DebugTools {
  constructor(private backend: SessionManager) {}

  // ============================================================================
  // Get Console Logs Tool
  // ============================================================================

  static readonly getConsoleLogsTool = {
    name: "get_browser_console_logs",
    description: "Get console logs from the browser (errors, warnings, etc.)",
    inputSchema: zodToJsonSchema(
      z.object({
        session_id: z.string().describe("Browser session ID"),
        since_timestamp: z.number().optional().describe("Only return logs after this timestamp"),
        log_types: z.array(z.string()).optional().describe("Filter by log types (e.g., ['error', 'warning'])"),
      }),
      { $refStrategy: "none" }
    ),
  };

  async getConsoleLogs(args: unknown): Promise<string> {
    const { session_id, since_timestamp, log_types } = z
      .object({
        session_id: z.string(),
        since_timestamp: z.number().optional(),
        log_types: z.array(z.string()).optional(),
      })
      .parse(args);

    const session = this.backend.getSession(session_id);
    if (!session) {
      throw new Error(`Session ${session_id} not found`);
    }

    const logs = this.backend.getConsoleLogs(session_id, {
      sinceTimestamp: since_timestamp,
      logTypes: log_types,
    });

    return JSON.stringify({
      session_id,
      log_count: logs.length,
      logs: logs.slice(-100),
    });
  }

  // ============================================================================
  // Get Network Logs Tool
  // ============================================================================

  static readonly getNetworkLogsTool = {
    name: "get_browser_network_logs",
    description: "Get network request logs from the browser",
    inputSchema: zodToJsonSchema(
      z.object({
        session_id: z.string().describe("Browser session ID"),
        since_timestamp: z.number().optional().describe("Only return logs after this timestamp"),
        status_filter: z
          .enum(["errors", "success"])
          .optional()
          .describe("Filter by HTTP status (errors: 4xx/5xx, success: 2xx)"),
      }),
      { $refStrategy: "none" }
    ),
  };

  async getNetworkLogs(args: unknown): Promise<string> {
    const { session_id, since_timestamp, status_filter } = z
      .object({
        session_id: z.string(),
        since_timestamp: z.number().optional(),
        status_filter: z.enum(["errors", "success"]).optional(),
      })
      .parse(args);

    const session = this.backend.getSession(session_id);
    if (!session) {
      throw new Error(`Session ${session_id} not found`);
    }

    const logs = this.backend.getNetworkLogs(session_id, {
      sinceTimestamp: since_timestamp,
      statusFilter: status_filter,
    });

    return JSON.stringify({
      session_id,
      log_count: logs.length,
      logs: logs.slice(-100),
    });
  }

  // ============================================================================
  // Clear Logs Tool
  // ============================================================================

  static readonly clearLogsTool = {
    name: "clear_logs",
    description: "Clear console and network logs for a session",
    inputSchema: zodToJsonSchema(
      z.object({
        session_id: z.string().describe("Browser session ID"),
      }),
      { $refStrategy: "none" }
    ),
  };

  async clearLogs(args: unknown): Promise<string> {
    const { session_id } = z.object({ session_id: z.string() }).parse(args);

    const session = this.backend.getSession(session_id);
    if (!session) {
      throw new Error(`Session ${session_id} not found`);
    }

    this.backend.clearLogs(session_id);

    return JSON.stringify({
      session_id,
      message: "Logs cleared successfully",
    });
  }

  // ============================================================================
  // Get Artifact Tool
  // ============================================================================

  static readonly getLocalArtifactTool = {
    name: "get_local_artifact",
    description: "Get a local artifact file (screenshot, DOM snapshot, etc.) from a live browser session. Only accepts local file paths, NOT S3 URIs. For test run artifacts, use get_step_artifacts instead.",
    inputSchema: zodToJsonSchema(
      z.object({
        path: z.string().describe("Artifact file path from previous tool output"),
        return_format: z
          .enum(["base64", "text"])
          .optional()
          .describe("Return format (auto-detected if not specified)"),
      }),
      { $refStrategy: "none" }
    ),
  };

  async getLocalArtifact(args: unknown): Promise<string> {
    const { path } = z
      .object({
        path: z.string(),
        return_format: z.enum(["base64", "text"]).optional(),
      })
      .parse(args);

    const result = await this.backend.getLocalArtifact(path);

    return JSON.stringify({
      path,
      format: result.format,
      size: result.size,
      data: result.data,
    });
  }

  // ============================================================================
  // Export all tool definitions
  // ============================================================================

  static readonly toolDefinitions = [
    DebugTools.getConsoleLogsTool,
    DebugTools.getNetworkLogsTool,
    DebugTools.clearLogsTool,
  ];
}
