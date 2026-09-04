/**
 * Browser Tools
 *
 * MCP tool definitions for browser operations.
 * Exports reusable components (Zod schemas, metadata, handlers) that can be consumed by:
 * - MCP server (converts Zod to JSON Schema)
 * - Claude Agent SDK (uses Zod directly with tool() helper)
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { SessionManager } from "../backends/SessionManager.js";
import { ACT_SUPPORTED_ACTIONS, type GetLocatorResult } from "../backends/sessionTypes.js";
import { isPerfProfiling } from "../utils/perfProfiling.js";

import { toolRegistry } from "sdk-core";

// ============================================================================
// Result Types
// ============================================================================

export interface NavigateResult {
  session_id: string;
  current_url: string;
  message: string;
}

export interface ActHandlerResult {
  success: boolean;
  duration_ms?: number;
  actions: Array<{
    action_entity?: unknown;
    success: boolean;
    error?: string;
    duration_ms?: number;
    timing?: { execute_ms: number; log_ms: number };
    step_index?: number;
  }>;
  error?: string;
  /** Path to DOM text file with element indices (post-action state). Absent if page was still loading. */
  dom_file_path?: string;
}

export interface UpdateVariablesResult {
  session_id: string;
  message: string;
  variable_count: number;
  sensitive_keys_count: number;
}

export interface ClearExecutionHistoryResult {
  session_id: string;
  message: string;
}

export interface GetPageInfoResult {
  session_id: string;
  url: string;
  title: string;
}

export interface InspectPageResult {
  session_id: string;
  dom_file_path: string;
  screenshot_path?: string;
  current_url: string;
  duration_ms?: number;
  timing?: {
    screenshot_ms: number;
    dom_extraction_ms: number;
    page_info_ms: number;
    file_write_ms: number;
  };
}

export { type GetLocatorResult } from "../backends/sessionTypes.js";

// ============================================================================
// Navigate Tool
// ============================================================================

export const navigateSchema = z.object({
  session_id: z.string().describe("Session ID from new_session"),
  url: z.string().optional().describe("URL to navigate to (optional, stays at current URL if not provided)"),
});

export const navigateToolMeta = {
  name: "navigate",
  description: `Navigate to a URL in an existing browser session.

Examples:
- Navigate to a specific page: url="https://example.com/login"
- Stay at current page and get URL: (no url parameter)

The tool returns the current URL after navigation.`,
};

export async function navigateHandler(
  backend: SessionManager,
  args: z.infer<typeof navigateSchema>
): Promise<NavigateResult> {
  const { session_id, url } = args;

  const session = backend.getSession(session_id);
  if (!session) {
    throw new Error(`Session ${session_id} not found`);
  }

  if (url) {
    await backend.navigate(session_id, url);
  }

  const currentUrl = await backend.getCurrentUrl(session_id);

  return {
    session_id,
    current_url: currentUrl,
    message: url ? `Navigated to ${currentUrl}` : `Current URL: ${currentUrl}`,
  };
}

// ============================================================================
// Act Tool
// ============================================================================

/** Lookup for the advertised act surface. Built once — the list is a constant. */
const SUPPORTED_ACT_ACTIONS = new Set<string>(ACT_SUPPORTED_ACTIONS);

export const actSchema = z.object({
  session_id: z.string().describe("Session ID"),
  actions: z.array(z.record(z.any())).describe("List of actions to execute"),
  stop_on_error: z.boolean().optional().describe("Stop execution on first error (default: true)"),
});

export function getActToolMeta() {
  return {
    name: "act",
    description: `Execute browser actions using element indices from inspect_page.

CRITICAL: Before your first act call, you MUST read resource 'shiplight://schemas/action-entity' to learn action parameter formats. Each action has specific required parameters (e.g., press uses "keys" not "key"). To read it: first call ListMcpResourcesTool (without a server parameter) to discover the correct server name, then call ReadMcpResourceTool with that server name and uri 'shiplight://schemas/action-entity'.

Workflow:
1. inspect_page → get DOM with element indices [0], [1], etc. + screenshot
2. act → execute actions using element indices
3. Repeat until task is complete

Supported actions: ${ACT_SUPPORTED_ACTIONS.join(", ")}

Each action is exactly ONE object with the action name as its single key (e.g. input_text, press). Empty objects {} are invalid and will error.
When converting from TestFlow YAML (action_entity with action_data.action_name/kwargs), map each statement to this shape: key = action_name, value = { element_index, description, ...kwargs }.
- element_index: Element index from DOM (for element-based actions)
- description: REQUIRED - Semantic, human-readable description of the action
- Action-specific params: MUST read 'shiplight://schemas/action-entity' resource (use ListMcpResourcesTool without server to discover the server name first)

CRITICAL: The 'description' field must be semantic and grounded - DO NOT reference element indices.
- BAD: "Click element 5", "Input text to element 3"
- GOOD: "Click the Submit button", "Enter 'john@example.com' in email field"

Response fields:
- success: Whether all actions completed successfully
- actions: Array of { action_entity, success, error?, screenshot_path? } for each executed action
  - actions[].screenshot_path: Path to the post-action screenshot (present when screenshot was captured successfully).
- dom_file_path: Path to the DOM text file with updated page state and element indices. Absent if the page was still loading — call inspect_page if not present.`,
  };
}

export async function actHandler(
  backend: SessionManager,
  args: z.infer<typeof actSchema>
): Promise<ActHandlerResult> {
  const { session_id, actions, stop_on_error = true } = args;

  const session = backend.getSession(session_id);
  if (!session) {
    throw new Error(`Session ${session_id} not found`);
  }

  // Enforce the advertised surface. `actSchema` above accepts any action name
  // (z.record(z.any())), while the tool DEFINITION is generated from
  // ACT_SUPPORTED_ACTIONS — so without this check the two disagree: an action
  // the tool never advertised still reaches the sdk-core registry and executes.
  // That is how AI-driven actions (verify, ai_extract, ai_wait_until, login)
  // stayed callable on this browser-only server even though it wires no LLM
  // model, failing with a confusing "No LLM model configured" instead of a
  // clear "not supported here".
  //
  // Names are extracted exactly as SessionManager.act does (first key), so this
  // can never reject an action the backend would have accepted.
  // An action with no key ({}) has no name to check, so it is rejected here
  // rather than forwarded — otherwise it reaches the registry as `undefined`
  // and fails with "Tool not found", which reads like a missing feature.
  const names = actions.map((actionInput) => Object.keys(actionInput)[0]);
  if (names.some((name) => typeof name !== "string")) {
    throw new Error("Each act action must be an object with exactly one action name as its key.");
  }
  const unsupported = (names as string[]).filter((name) => !SUPPORTED_ACT_ACTIONS.has(name));
  if (unsupported.length > 0) {
    // Validated for the whole batch before anything runs, so a bad name cannot
    // half-execute a multi-action request.
    throw new Error(
      `Unsupported act action(s): ${[...new Set(unsupported)].join(", ")}. ` +
        `This server exposes deterministic browser actions only. ` +
        `Supported: ${ACT_SUPPORTED_ACTIONS.join(", ")}.`,
    );
  }

  try {
    const result = await backend.act(session_id, actions, {
      stopOnError: stop_on_error,
    });

    return {
      success: result.success,
      duration_ms: result.duration_ms,
      actions: result.results.map((r) => ({
        action_entity: r.action_entity,
        success: r.success,
        error: r.error,
        duration_ms: r.duration_ms,
        timing: r.timing,
        step_index: r.stepIndex,
      })),
      // Pass through optimistic inspect data
      ...(result.dom_file_path != null && {
        dom_file_path: result.dom_file_path,
      }),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      actions: [],
      error: errorMessage,
    };
  }
}

// ============================================================================
// Update Variables Tool
// ============================================================================

export const updateVariablesSchema = z.object({
  session_id: z.string().describe("Session ID"),
  variables: z.record(z.any()).describe('Variables as key-value pairs (e.g., {username: "user", password: "secret"})'),
  sensitive_keys: z
    .array(z.string())
    .optional()
    .describe('Keys to treat as sensitive - values will be masked in logs (e.g., ["password", "token"])'),
});

export const updateVariablesToolMeta = {
  name: "update_variables",
  description: `Update session variables for use in subsequent browser operations.

Variables are key-value pairs that can be referenced in browser tasks.
Mark sensitive values (passwords, tokens) with sensitive_keys to prevent logging.

Example:
  variables: { username: "john", password: "secret123" }
  sensitive_keys: ["password"]`,
};

export function updateVariablesHandler(
  backend: SessionManager,
  args: z.infer<typeof updateVariablesSchema>
): UpdateVariablesResult {
  const { session_id, variables, sensitive_keys } = args;

  backend.updateVariables(session_id, variables, sensitive_keys);

  return {
    session_id,
    message: "Variables updated successfully",
    variable_count: Object.keys(variables).length,
    sensitive_keys_count: sensitive_keys?.length || 0,
  };
}

// ============================================================================
// Clear Execution History Tool
// ============================================================================

export const clearExecutionHistorySchema = z.object({
  session_id: z.string().describe("Session ID"),
});

export const clearExecutionHistoryToolMeta = {
  name: "clear_execution_history",
  description: `Clear the execution history for a session.

The execution history tracks past browser operations within a session.
Clear it to start fresh or reduce memory usage.`,
};

export function clearExecutionHistoryHandler(
  backend: SessionManager,
  args: z.infer<typeof clearExecutionHistorySchema>
): ClearExecutionHistoryResult {
  const { session_id } = args;

  backend.clearExecutionHistory(session_id);

  return {
    session_id,
    message: "Execution history cleared successfully",
  };
}

// ============================================================================
// Get Page Info Tool
// ============================================================================

export const getPageInfoSchema = z.object({
  session_id: z.string().describe("Session ID"),
});

export const getPageInfoToolMeta = {
  name: "get_page_info",
  description: `Get basic page information (URL and title) without taking a screenshot.

Use this as a lightweight way to check what page you're on.
For visual inspection, use inspect_page.`,
};

export async function getPageInfoHandler(
  backend: SessionManager,
  args: z.infer<typeof getPageInfoSchema>
): Promise<GetPageInfoResult> {
  const { session_id } = args;

  const session = backend.getSession(session_id);
  if (!session) {
    throw new Error(`Session ${session_id} not found`);
  }

  const pageInfo = await backend.getPageInfo(session_id);

  return {
    session_id,
    url: pageInfo.url,
    title: pageInfo.title,
  };
}

// ============================================================================
// Inspect Page Tool
// ============================================================================

export const inspectPageSchema = z.object({
  session_id: z.string().describe("Session ID"),
});

export const inspectPageToolMeta = {
  name: "inspect_page",
  description: `Inspect the current page: extracts the DOM tree and saves a Set-of-Mark screenshot.

Returns the DOM file path (with element indices [0], [1], etc. for the act tool) and a screenshot file path. The DOM and screenshot are captured atomically so element indices always match.

IMPORTANT: Read the DOM file to understand page state and decide actions. Only view the screenshot file when the DOM is insufficient (e.g., visual layout, canvas content, images, verifying colors/styling).

Returns:
- dom_file_path: Path to file containing DOM text with element indices
- screenshot_path: Path to the SoM screenshot (element indices match the DOM)
- current_url: The current page URL`,
};

export async function inspectPageHandler(
  backend: SessionManager,
  args: z.infer<typeof inspectPageSchema>
): Promise<InspectPageResult> {
  const { session_id } = args;

  const session = backend.getSession(session_id);
  if (!session) {
    throw new Error(`Session ${session_id} not found`);
  }

  const result = await backend.getDom(session_id);

  return {
    session_id,
    dom_file_path: result.domFilePath,
    screenshot_path: result.screenshotPath,
    current_url: result.currentUrl,
    duration_ms: result.duration_ms,
    timing: result.timing,
  };
}

// ============================================================================
// Get Locator Tool
// ============================================================================

export const getLocatorsSchema = z.object({
  session_id: z.string().describe("Session ID"),
  element_indices: z.array(z.number()).min(1).max(50).describe("Element indices from inspect_page output (1-50)"),
});

export const getLocatorsToolMeta = {
  name: "get_locators",
  description: `Extract Playwright locators for one or more elements by index. Call inspect_page first.

Returns locator, xpath, frame path, tag name, and text for each element.
Use this to collect locator data for building test flows without interacting
with the page. Pass multiple indices in a single call to save round-trips.`,
};

export interface GetLocatorsHandlerResult {
  results: (GetLocatorResult | { element_index: number; error: string })[];
  duration_ms?: number;
}

export async function getLocatorsHandler(
  backend: SessionManager,
  args: z.infer<typeof getLocatorsSchema>
): Promise<GetLocatorsHandlerResult> {
  const perf = isPerfProfiling();
  const t0 = perf ? performance.now() : 0;
  const { session_id, element_indices } = args;

  const session = backend.getSession(session_id);
  if (!session) {
    throw new Error(`Session ${session_id} not found`);
  }

  const settled = await Promise.allSettled(
    element_indices.map(index => backend.getLocator(session_id, index))
  );
  const results = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { element_index: element_indices[i], error: r.reason?.message ?? String(r.reason) }
  );
  return {
    results,
    ...(perf && { duration_ms: Math.round(performance.now() - t0) }),
  };
}

// ============================================================================
// MCP Tool Definitions
// ============================================================================

// Tool definition type
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Cached action schema for act tool (built lazily)
let cachedActActionSchema: z.ZodType | null = null;
let cachedActToolDefinition: ToolDefinition | null = null;

/**
 * Initialize the action schema for the act tool.
 * Must be called before using BrowserTools if you need the full action schema.
 */
export function getActSchema(): z.ZodType {
  if (cachedActActionSchema) return cachedActActionSchema;
  // Schema already includes description field (added by buildActionUnionSchemaForTools)
  cachedActActionSchema = toolRegistry.buildActionUnionSchemaForTools([...ACT_SUPPORTED_ACTIONS], true);
  return cachedActActionSchema;
}

/**
 * Get the act tool definition with the full action schema.
 */
export function getActToolDefinition(): ToolDefinition {
  if (cachedActToolDefinition) return cachedActToolDefinition;

  const actionSchema = getActSchema();
  const actionsSchema = z.array(actionSchema);

  const meta = getActToolMeta();
  cachedActToolDefinition = {
    name: meta.name,
    description: meta.description,
    inputSchema: zodToJsonSchema(
      z.object({
        session_id: z.string().describe("Session ID"),
        actions: actionsSchema.describe("List of actions to execute"),
        stop_on_error: z.boolean().optional().describe("Stop execution on first error (default: true)"),
      }),
      { $refStrategy: "none" }
    ),
  };

  return cachedActToolDefinition;
}

/**
 * BrowserTools class for MCP server usage.
 * Methods parse args from unknown and return JSON strings.
 */
export class BrowserTools {
  constructor(private backend: SessionManager) {}

  // ============================================================================
  // Navigate Tool
  // ============================================================================

  static readonly navigateTool = {
    ...navigateToolMeta,
    inputSchema: zodToJsonSchema(navigateSchema, { $refStrategy: "none" }),
  };

  async navigate(args: unknown): Promise<string> {
    const parsed = navigateSchema.parse(args);
    const result = await navigateHandler(this.backend, parsed);
    return JSON.stringify(result);
  }

  // ============================================================================
  // Act Tool
  // ============================================================================

  static get actTool() {
    return getActToolDefinition();
  }

  async act(args: unknown): Promise<string> {
    const parsed = actSchema.parse(args);
    const result = await actHandler(this.backend, parsed);
    return JSON.stringify(result);
  }

  // ============================================================================
  // Update Variables Tool
  // ============================================================================

  static readonly updateVariablesTool = {
    ...updateVariablesToolMeta,
    inputSchema: zodToJsonSchema(updateVariablesSchema, { $refStrategy: "none" }),
  };

  async updateVariables(args: unknown): Promise<string> {
    const parsed = updateVariablesSchema.parse(args);
    const result = updateVariablesHandler(this.backend, parsed);
    return JSON.stringify(result);
  }

  // ============================================================================
  // Clear Execution History Tool
  // ============================================================================

  static readonly clearExecutionHistoryTool = {
    ...clearExecutionHistoryToolMeta,
    inputSchema: zodToJsonSchema(clearExecutionHistorySchema, { $refStrategy: "none" }),
  };

  async clearExecutionHistory(args: unknown): Promise<string> {
    const parsed = clearExecutionHistorySchema.parse(args);
    const result = clearExecutionHistoryHandler(this.backend, parsed);
    return JSON.stringify(result);
  }

  // ============================================================================
  // Get Page Info Tool
  // ============================================================================

  static readonly getPageInfoTool = {
    ...getPageInfoToolMeta,
    inputSchema: zodToJsonSchema(getPageInfoSchema, { $refStrategy: "none" }),
  };

  async getPageInfo(args: unknown): Promise<string> {
    const parsed = getPageInfoSchema.parse(args);
    const result = await getPageInfoHandler(this.backend, parsed);
    return JSON.stringify(result);
  }

  // ============================================================================
  // Inspect Page Tool
  // ============================================================================

  static readonly inspectPageTool = {
    ...inspectPageToolMeta,
    inputSchema: zodToJsonSchema(inspectPageSchema, { $refStrategy: "none" }),
  };

  async inspectPage(args: unknown): Promise<string> {
    const parsed = inspectPageSchema.parse(args);
    const result = await inspectPageHandler(this.backend, parsed);
    return JSON.stringify(result);
  }

  // ============================================================================
  // Get Locator Tool
  // ============================================================================

  static readonly getLocatorsTool = {
    ...getLocatorsToolMeta,
    inputSchema: zodToJsonSchema(getLocatorsSchema, { $refStrategy: "none" }),
  };

  async getLocators(args: unknown): Promise<string> {
    const parsed = getLocatorsSchema.parse(args);
    const result = await getLocatorsHandler(this.backend, parsed);
    return JSON.stringify(result);
  }

  // ============================================================================
  // Export all tool definitions
  // ============================================================================

  static get toolDefinitions() {
    return [
      // Navigation & inspection
      BrowserTools.navigateTool,
      BrowserTools.getPageInfoTool,
      BrowserTools.inspectPageTool,
      // Browser operations
      BrowserTools.actTool,
      // Locator extraction
      BrowserTools.getLocatorsTool,
    ];
  }
}
