/**
 * Shiplight SDK
 *
 * General-purpose SDK for browser automation with AI capabilities.
 * Can be used standalone or with any test framework.
 */

import type { Page } from "playwright";
import type { z } from "zod";
import { VariableStore } from "shiplight-types";
import { Agent, createAgentContext } from "./agent";
import type { AgentContextOptions } from "./core/agentContext";

// ============================================================================
// Simple Factory API (Recommended for most users)
// ============================================================================

/**
 * Options for creating an agent with the simple factory
 */
export interface CreateAgentOptions {
  /** LLM model to use (e.g., 'gemini-2.5-pro', 'gpt-4o') */
  model: string;
  /** Initial variables to set in the agent's variable store */
  variables?: Record<string, any>;
  /** Keys to mark as sensitive (won't be sent to LLM). E.g., ['password', 'apiKey'] */
  sensitiveKeys?: string[];
  /** Directory for test data files */
  testDataDir?: string;
  /** Directory for downloads */
  downloadDir?: string;
}

// ============================================================================
// Custom Action Types (shared with sdk-public)
// ============================================================================

/**
 * Context passed to custom action execute function.
 * Provides access to the browser page and variable storage.
 */
export interface ActionExecutionContext {
  /** Playwright page instance */
  page: Page;

  /**
   * Variable store for accessing and setting test variables.
   * Use this to read input variables or store output values.
   *
   * @example
   * ```typescript
   * // Read a variable
   * const email = ctx.variableStore.get('email');
   *
   * // Store a value for later use
   * ctx.variableStore.set('verification_code', code);
   *
   * // Mark as sensitive (won't be sent to LLM)
   * ctx.variableStore.set('api_token', token, true);
   * ```
   */
  variableStore: VariableStore;

  /**
   * Resolve variable placeholders in a string.
   *
   * Arguments passed to `execute()` are already resolved. Use this for strings
   * you build yourself, or for values that arrive from somewhere other than the
   * model (a config file, an API response).
   *
   * Supports `{{ name }}`, `{{ $name }}`, `${name}` and `$name`. Unknown
   * placeholders are left in place rather than blanked.
   *
   * @example
   * ```typescript
   * const url = ctx.replaceVariables('https://{{ host }}/reset');
   * ```
   */
  replaceVariables(text: string): string;
}

/**
 * Result from custom action execution.
 */
export interface CustomActionResult {
  /** Whether the action completed successfully */
  success: boolean;

  /** Optional message describing what happened (shown in logs/reports) */
  message?: string;
}

/**
 * Custom action definition.
 *
 * Register custom actions to extend the agent's capabilities.
 * The LLM will automatically call your action when appropriate
 * based on the name and description you provide.
 *
 * @example
 * ```typescript
 * const extractEmailCode: ICustomAction = {
 *   name: 'extract_email_code',
 *   description: 'Extract verification code from email inbox',
 *   schema: z.object({
 *     email_address: z.string().describe('The email address to check'),
 *     code_type: z.enum(['verification', 'reset']).describe('Type of code'),
 *   }),
 *   async execute(args, ctx) {
 *     const code = await myEmailService.getCode(args.email_address);
 *     ctx.variableStore.set('email_code', code);
 *     return { success: true, message: `Extracted code: ${code}` };
 *   },
 * };
 * ```
 */
export interface ICustomAction<TSchema extends z.ZodObject<any> = z.ZodObject<any>> {
  /**
   * Unique action name (snake_case recommended).
   * The LLM uses this to identify the action.
   */
  name: string;

  /**
   * Description for the LLM explaining when and how to use this action.
   * Be specific about what the action does and what inputs it needs.
   */
  description: string;

  /**
   * Zod schema defining the action's parameters.
   * Use .describe() on fields to help the LLM understand what values to provide.
   */
  schema: TSchema;

  /**
   * Execute the action with validated arguments.
   *
   * String arguments are variable-resolved before the schema validates them and before
   * they reach this function, so a value the model wrote as `{{ testEmail }}` arrives as
   * the real address. Declare such fields as plain `z.string()`: a refinement like
   * `.email()` is also applied to the model's literal output during action generation for
   * `act()`, where the placeholder cannot satisfy it. The trajectory keeps the
   * placeholder, which is what keeps secrets out of stored runs and generated code.
   *
   * @param args - Arguments matching the schema (variable-resolved, then validated)
   * @param ctx - Execution context with page, variableStore and replaceVariables
   * @returns Result indicating success/failure
   */
  execute: (
    args: z.infer<TSchema>,
    ctx: ActionExecutionContext
  ) => Promise<CustomActionResult>;
}

/**
 * Create an AI-powered browser automation agent
 *
 * @example
 * ```typescript
 * import { createAgent } from '@shiplightai/sdk-core';
 *
 * const agent = createAgent({
 *   model: 'gemini-2.5-pro',
 *   variables: { username: 'test@example.com' }
 * });
 *
 * // Use with Playwright
 * await agent.run(page, 'Click the login button');
 * await agent.assert(page, 'Dashboard is visible');
 * ```
 */
export function createAgent(options: CreateAgentOptions): Agent {
  const variableStore = new VariableStore();
  const sensitiveSet = new Set(options.sensitiveKeys || []);

  // Set initial variables if provided
  if (options.variables) {
    for (const [key, value] of Object.entries(options.variables)) {
      variableStore.set(key, value, sensitiveSet.has(key));
    }
  }

  const context = createAgentContext({
    model: options.model,
    variableStore,
    testDataDir: options.testDataDir,
    downloadDir: options.downloadDir,
  });

  return new Agent(context);
}

// ============================================================================
// Core Exports
// ============================================================================

// Re-export VariableStore for advanced usage
export { VariableStore } from "shiplight-types";

// Agent classes (for advanced usage - prefer createAgent for simplicity)
export { Agent, createAgentContext, WebAgent } from "./agent";
export type { LoginOptions } from "./agent";
export type { AgentContextOptions } from "./core/agentContext";
export { AgentServices } from "./agent/agentServices";

// Agent types
export { AgentStepEventTypes, AgentTaskFailedError } from "./agent/types";
export type {
  ActionResult,
  AgentAction,
  AgentStepEvent,
  AgentStepResult,
  TokenUsage as AgentTokenUsage,
  AIActionDetail,
  ConsoleLogEntry,
  DOMSnapshot,
  PageState,
  ActionInfo,
  StateEntry,
  ActionEntry,
  RedirectEntry,
  StepTransition,
  RedirectTransition,
  StateTransition,
  StateTransitionsOutput,
  EvaluationResult,
  StepExecutionResult,
  StepTrackingConfig,
  TestContextData,
} from "./agent/types";

// Internal context type (for test-fixtures package integration)
export type { WebAgentContext } from "./agent/types";

// Agent helper functions
export { buildRunUsageSummary, inferProvider } from "./agent/runUsageSummary";
export type { BuildRunUsageSummaryOptions } from "./agent/runUsageSummary";
export { evaluateStatement, executeStep, generateActionStep, runTask } from "./agent/agentHelpers";
export type {
  AgentEvent,
  AgentOptions,
  AssertionResult,
  ChatMessage,
  StepResult,
} from "./agent/core/types";

// Action Helper (for test export/transpilation)
export { ActionHelper } from "./actions/actionHelper";

// ============================================================================
// Actions (Curated exports - internal implementations hidden)
// ============================================================================

// Action handler for executing actions
export { default as ActionHandler } from "./actions/handler";

// Action types
export type { ActionEntity, ActionEntityLocatorInfo, IAction, IAgent } from "./actions/types";

// Re-export login enums for backward compatibility
export { LoginType } from "./agent/agentLogin";
export { TwoFactorAuthType } from "shiplight-types";

// ============================================================================
// DOM Module
// ============================================================================

export { DomService, HistoryTreeProcessor } from "./dom";
export type {
  DOMBaseNode,
  DOMElementNode,
  DOMExtractionOptions,
  DOMHistoryElement,
  DOMState,
  DOMTextNode,
  HashedDomElement,
  SelectorMap,
  StringifyConfig,
} from "./dom";

// DOM Utilities
export { pickBestLocator, pickBestLocatorForElement, pickBestLocators } from "./dom/utils/locator";

// LLM tool utilities
export { getActionEntityLocatorInfo, getFramePath } from "./llm_tools/utils";

// AXTree shared constants (used by debug tools)
export {
  INTERACTIVE_ROLES,
  INTERACTION_EVENT_TYPES,
  EVENT_LISTENER_CANDIDATE_SELECTORS,
  DEFAULT_EVENT_LISTENER_LIMIT,
  isInteractiveRole,
  isInteractionEventType,
  filterInteractionListeners,
} from "./dom/axtree-shared";

// ============================================================================
// LLM Tools
// ============================================================================

export {
  createToolRegistry,
  createToolRegistryWithCapabilities,
  ensureToolsRegistered,
  exportMCPTools,
  getCapabilitySummary,
  getToolRegistry,
  MCPToolProvider,
  OpenAIToolProvider,
  toolRegistry,
  ToolRegistry,
} from "./llm_tools";
export type {
  MCPToolDefinition,
  RegisteredTool,
  ToolDefinition,
  ToolExecuteFunction,
  ToolExecutionContext,
  ToolRegistrationConfig,
  ToolResult,
} from "./llm_tools";

// ============================================================================
// Browser Utilities
// ============================================================================

export {
  getBrowserCdpUrl,
  getPageInfo,
  getPageWsUrl,
  newBrowserContext,
  setWindowBounds,
} from "./browser/browserUtils";

export { INIT_SCRIPT } from "./browser/constants";

export { BrowserManager } from "./browser/browserManager";
export type { BrowserInstance, BrowserManagerConfig, BrowserLaunchOptions } from "./browser/browserManager";

export { registerBrowser, unregisterBrowser } from "./browser/registryClient";
export type { RegisterArgs } from "./browser/registryClient";
export { discoverChromiumCdpUrl } from "./browser/cdpDiscovery";

export { getPlatformFromDeviceName } from "./browser/platformUtils";
export type { DevicePlatform } from "./browser/types";

// ============================================================================
// Utilities
// ============================================================================

export { default as logger } from "./utils/logger";
export { parseSSEStream } from "./utils/streamingUtils";
export { replaceVariables } from "shiplight-types";
export type { StreamEventCallback } from "./utils/streamingUtils";
export { injectUserFunction, loadUserFunctions } from "./utils/userFunctions";
export { loadKnowledges, loadKnowledgeMappings } from "./utils/knowledgeLoader";
export type { KnowledgeData, KnowledgeMapping } from "./utils/knowledgeLoader";

// ============================================================================
// Configuration
// ============================================================================

export { configureSdk, getSdkConfig, parseSdkLogLevelFromEnv } from "./config";
export type { SdkConfig } from "./config";
export { llmAbortSignal, getLlmCallTimeoutMs, LlmCallTimeoutError, withLlmTimeout, LLM_MAX_RETRIES } from "./agent/llm/timeout";
export { LogLevel } from "./utils/logLevel";

// ============================================================================
// LLM Provider
// ============================================================================

export {
  getModel,
  getProviderOptions,
} from "./agent/llmProvider";

// ============================================================================
// Email / Mailgun Provider
// ============================================================================

export type {
  MailgunConfig,
  ExtractionType,
  ExtractEmailContentRequest,
  ExtractEmailContentResponse,
  EmailFilters,
} from "./providers/mailgun";

// ============================================================================
// Version
// ============================================================================

export const SDK_VERSION = "1.0.0";
