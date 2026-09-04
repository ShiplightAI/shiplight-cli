/**
 * mcp-tools
 *
 * Shared MCP tools with injectable backends for Shiplight.
 *
 * This package provides:
 * - Tool definitions for MCP servers
 * - Injectable interfaces for different backends (SessionManager)
 * - ToolRegistry for selective tool registration
 *
 * Browser-only. The v1 cloud tools (test cases, templates, functions, test
 * accounts, report upload) and the API-token layer they needed were removed —
 * they were backed solely by the deprecated monots core-api. Authoring and
 * syncing tests is the `shiplightai` CLI's job.
 *
 * Tool Categories:
 * - SessionTools: Session lifecycle (new_session, close, close_all, get_state)
 * - BrowserTools: All browser operations (navigate, screenshot, dom, operate_browser, execute_actions, etc.)
 * - DebugTools: Debugging (console_logs, network_logs, clear_logs, artifacts)
 * - LocalTestTools: Session-scoped HTML reporting
 *
 * Example usage:
 *
 * ```ts
 * import {
 *   SessionTools,
 *   BrowserTools,
 *   DebugTools,
 *   ToolRegistry,
 *   SessionManager,
 * } from 'mcp-tools';
 *
 * // Create backend
 * const sessionManager = new SessionManager({ runDir: './runs' });
 *
 * // Create tool instances
 * const sessionTools = new SessionTools(sessionManager);
 * const browserTools = new BrowserTools(sessionManager);
 * const debugTools = new DebugTools(sessionManager);
 *
 * // Register tools with selective registration
 * const registry = new ToolRegistry();
 * registry.registerAll(SessionTools, sessionTools);
 * registry.registerAll(BrowserTools, browserTools);
 * registry.registerAll(DebugTools, debugTools);
 *
 * // Build and use
 * const { tools, handleToolCall } = registry.build();
 *
 * // Use with MCP server
 * server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
 * server.setRequestHandler(CallToolRequestSchema, async (request) => {
 *   const result = await handleToolCall(request.params.name, request.params.arguments);
 *   return { content: [{ type: 'text', text: result }] };
 * });
 * ```
 */

// Types
export type {
  CreateSessionConfig,
  CreateSessionWithPageConfig,
  WebAgentConfig,
  TestAccountInfo,
  TestAccountLoginConfig,
  SessionInfo,
  ConsoleLog,
  NetworkLog,
  LogOptions,
  TaskOptions,
  TaskResult,
  PageInfo,
  InspectPageResult,
  GetLocatorResult,
  ActionResultItem,
  ActOptions,
  ActResult,
  ActSupportedAction,
  ActionLogEntry,
  PageCacheMetadata,
  TestEvidenceManifest,
  LocatorEntry,
} from "./backends/sessionTypes.js";

export { ACT_SUPPORTED_ACTIONS } from "./backends/sessionTypes.js";

// Re-export types used by mcp-tools public API
export type { AgentEvent, WebAgentContext, ActionEntity } from "sdk-core";


// Tools
export { SessionTools } from "./tools/sessionTools.js";
export { RelayTools } from "./tools/relayTools.js";
export { BrowserTools, getActSchema, getActToolDefinition } from "./tools/browserTools.js";
export { DebugTools } from "./tools/debugTools.js";
export { LocalTestTools } from "./tools/localTestTools.js";
// Browser Tool Definitions (for dual use: MCP server + Claude Agent SDK)
export {
  // Schemas
  navigateSchema,
  actSchema,
  updateVariablesSchema,
  clearExecutionHistorySchema,
  getPageInfoSchema,
  inspectPageSchema,
  getLocatorsSchema,
  // Metadata
  navigateToolMeta,
  getActToolMeta,
  updateVariablesToolMeta,
  clearExecutionHistoryToolMeta,
  getPageInfoToolMeta,
  inspectPageToolMeta,
  getLocatorsToolMeta,
  // Handlers
  navigateHandler,
  actHandler,
  updateVariablesHandler,
  clearExecutionHistoryHandler,
  getPageInfoHandler,
  inspectPageHandler,
  getLocatorsHandler,
  // Result types
  type NavigateResult,
  type ActHandlerResult,
  type UpdateVariablesResult,
  type ClearExecutionHistoryResult,
  type GetPageInfoResult,
  type InspectPageResult as InspectPageHandlerResult,
  type GetLocatorResult as GetLocatorHandlerResult,
} from "./tools/browserTools.js";

// Registry
export { ToolRegistry, type ToolCallOptions } from "./registry/toolRegistry.js";

// Types
export type { ToolDefinition, ToolHandler, ToolClass, ToolMethodName } from "./types/index.js";

// Default Backends (requires optional peer dependencies: sdk-core, shiplight-types, playwright)
export { SessionManager, WebAgent, type SessionManagerOptions, type SessionData } from "./backends/SessionManager.js";
export { ExtensionRelayServer } from "./backends/ExtensionRelayServer.js";
export { RelayElectionCoordinator } from "./backends/RelayElectionCoordinator.js";

// Prompts
export { PROMPTS, getPrompt, listPrompts, type PromptDefinition } from "./prompts/index.js";

// Resources
export {
  RESOURCES,
  getResource,
  listResources,
  getActionEntitySchemaResource,
  type ResourceDefinition,
} from "./resources/index.js";
