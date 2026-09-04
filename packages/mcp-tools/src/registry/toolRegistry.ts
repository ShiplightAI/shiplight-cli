/**
 * Tool Registry
 *
 * Provides selective registration of MCP tools.
 * Allows apps to register only the tools they need.
 */

import type { ToolDefinition } from "../types/index.js";

/**
 * Options passed to tool handlers (e.g., abort signal for cancellation)
 */
export interface ToolCallOptions {
  signal?: AbortSignal;
}

interface ToolEntry {
  definition: ToolDefinition;
  handler: (args: unknown, options?: ToolCallOptions) => Promise<string>;
}

type ToolMethodMap<T> = {
  [K in keyof T]: T[K] extends (args: unknown) => Promise<string> ? K : never;
}[keyof T];

/**
 * Registry for MCP tools with selective registration support.
 *
 * Example usage:
 * ```ts
 * const registry = new ToolRegistry();
 *
 * // Register all tools from a class
 * registry.registerAll(SessionTools, sessionToolsInstance);
 *
 * // Register specific tools only
 * registry.registerTools(InspectionTools, inspectionToolsInstance, [
 *   'inspectPage'
 * ]);
 *
 * // Build and get tools + handler
 * const { tools, handleToolCall } = registry.build();
 * ```
 */
/**
 * Tool name -> handler method name.
 *
 * The single source of truth for tool/method correspondence. Module scope, not
 * a local const: it was previously rebuilt on every lookup, and — more
 * importantly — it had a hand-maintained inverse that could drift from it.
 *
 * Naming patterns this encodes:
 *   new_session       -> newSession
 *   get_session_state -> getCurrentState
 *   list_environments -> listEnvironments
 */
export const TOOL_TO_METHOD: Record<string, string> = {

    // Session tools
    new_session: "newSession",
    save_storage_state: "saveStorageState",
    close_session: "closeSession",
    close_all: "closeAllSessions",
    get_session_state: "getCurrentState",
    attach_to_browser: "attachToBrowser",
    get_relay_status: "getRelayStatus",

    // Browser tools
    navigate: "navigate",
    get_page_info: "getPageInfo",
    inspect_page: "inspectPage",
    act: "act",
    get_locators: "getLocators",
    update_variables: "updateVariables",
    clear_execution_history: "clearExecutionHistory",

    // Debug tools
    get_browser_console_logs: "getConsoleLogs",
    get_browser_network_logs: "getNetworkLogs",
    clear_logs: "clearLogs",
    get_local_artifact: "getLocalArtifact",

    // Local test tools
    generate_html_report: "generateHtmlReport",
};

/**
 * Handler method name -> tool names, DERIVED from TOOL_TO_METHOD.
 *
 * This was a hand-written inverse and it drifted: when the authoring tools
 * (scaffold_project, validate_yaml_test, export_yaml_to_test) moved to the
 * CLI, they were deleted from the forward map but two survived here as dead
 * lookups. Deriving makes that class of desync impossible rather than relying
 * on an editor updating both halves.
 *
 * Values stay arrays even though every method currently backs exactly one
 * tool: a method may be registered from more than one definition list (local
 * vs cloud), and the caller already resolves by scanning the candidates
 * against the definitions it was given.
 */
const METHOD_TO_TOOLS: Record<string, string[]> = Object.entries(
  TOOL_TO_METHOD,
).reduce<Record<string, string[]>>((acc, [tool, method]) => {
  (acc[method] ||= []).push(tool);
  return acc;
}, {});

export class ToolRegistry {
  private tools: Map<string, ToolEntry> = new Map();

  /**
   * Register all tools from a tool class.
   */
  registerAll<T extends object>(
    ToolClass: { toolDefinitions: ToolDefinition[] },
    instance: T
  ): this {
    for (const definition of ToolClass.toolDefinitions) {
      const methodName = this.findMethodForTool(instance, definition.name);
      if (methodName) {
        this.tools.set(definition.name, {
          definition,
          handler: (instance as any)[methodName].bind(instance),
        });
      }
    }
    return this;
  }

  /**
   * Register specific tools from a tool class.
   */
  registerTools<T extends object>(
    ToolClass: { toolDefinitions: ToolDefinition[] },
    instance: T,
    methodNames: ToolMethodMap<T>[]
  ): this {
    for (const methodName of methodNames) {
      const definition = this.findDefinitionForMethod(ToolClass.toolDefinitions, methodName as string);
      if (definition) {
        this.tools.set(definition.name, {
          definition,
          handler: (instance as any)[methodName].bind(instance),
        });
      }
    }
    return this;
  }

  /**
   * Register a single tool manually.
   */
  registerTool(
    definition: ToolDefinition,
    handler: (args: unknown, options?: ToolCallOptions) => Promise<string>
  ): this {
    this.tools.set(definition.name, { definition, handler });
    return this;
  }

  /**
   * Build the registry and return tools list and handler function.
   */
  build(): {
    tools: ToolDefinition[];
    handleToolCall: (name: string, args: unknown, options?: ToolCallOptions) => Promise<string>;
  } {
    const toolsList = Array.from(this.tools.values()).map((entry) => entry.definition);

    const handleToolCall = async (name: string, args: unknown, options?: ToolCallOptions): Promise<string> => {
      const entry = this.tools.get(name);
      if (!entry) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return entry.handler(args, options);
    };

    return { tools: toolsList, handleToolCall };
  }

  /**
   * Get the list of registered tool names.
   */
  getRegisteredToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Check if a tool is registered.
   */
  hasToolRegistered(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Find method name that corresponds to a tool name.
   */
  private findMethodForTool<T extends object>(instance: T, toolName: string): string | null {
    const methodName = TOOL_TO_METHOD[toolName];
    if (methodName && typeof (instance as unknown as Record<string, unknown>)[methodName] === "function") {
      return methodName;
    }

    return null;
  }

  /**
   * Find tool definition for a method name.
   */
  private findDefinitionForMethod(
    definitions: ToolDefinition[],
    methodName: string
  ): ToolDefinition | null {
    const toolNames = METHOD_TO_TOOLS[methodName];
    if (!toolNames) return null;

    for (const toolName of toolNames) {
      const definition = definitions.find((d) => d.name === toolName);
      if (definition) return definition;
    }

    return null;
  }
}
