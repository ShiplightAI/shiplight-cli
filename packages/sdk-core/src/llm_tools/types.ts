/**
 * LLM Tools - Core Types and Interfaces
 *
 * This module defines the core types for the LLM tool system that bridges
 * between LLM function calling (OpenAI, MCP) and the action execution layer.
 */

import { Page } from 'playwright';
import { z } from 'zod';
import { ActionEntity } from '../actions/types';
import { DomService } from '../dom/service';
import type { AgentServices } from '../agent/agentServices';

/**
 * OpenAI-compatible tool definition for function calling
 * Follows the OpenAI function calling format
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>; // JSON Schema
    strict?: boolean; // OpenAI strict mode
  };
}

/**
 * MCP-compatible tool definition
 * Model Context Protocol tool format
 */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>; // JSON Schema
}

/**
 * Context passed to tool execution
 * Contains all the runtime dependencies needed to execute a tool
 * Uses AgentServices instead of IAgent to break circular dependencies
 */
export interface ToolExecutionContext {
  /** Playwright page instance */
  page: Page;

  /** Agent services for utilities (not full agent with AI methods to avoid circular deps) */
  agentServices: AgentServices;

  /** DOM service for element lookup and manipulation */
  domService: DomService;

  /** Optional step identifier for tracking */
  stepId?: string;

  /**
   * The arguments as the model wrote them, before `resolveArgs` ran.
   *
   * Only set when the tool declares a `resolveArgs` transform. Record these in the
   * ActionEntity rather than the resolved arguments, so a resolved secret never
   * reaches stored trajectories, reports or generated code.
   */
  rawArgs?: unknown;
}

/**
 * Result from tool execution
 * Contains both the execution outcome and the ActionEntity for trajectory saving
 */
export interface ToolResult {
  /** Whether the tool executed successfully */
  success: boolean;

  /** ActionEntity generated during execution (for trajectory/test case generation) */
  actionEntity: ActionEntity;

  /** Human-readable success message */
  message?: string;

  /** Error message if execution failed */
  error?: string;
}

/**
 * Registered tool configuration
 * Internal representation of a tool in the registry
 */
export interface RegisteredTool<T extends z.ZodType = z.ZodType> {
  /** Unique tool name (used by LLM to call the tool) */
  name: string;

  /** Description of what the tool does (for LLM) */
  description: string;

  /** Zod schema defining the tool's parameters */
  schema: T;

  /** Function that executes the tool */
  execute: ToolExecuteFunction<T>;

  /** Optional pre-validation transform of the raw arguments (see ToolRegistrationConfig) */
  resolveArgs?: (args: unknown) => unknown;

  /** Optional redactor for validation-error text (see ToolRegistrationConfig) */
  redactErrorText?: (text: string) => string;

  /** Whether this tool uses element_index parameter to reference DOM elements */
  usesElementIndex: boolean;

  /** Tool availability flags */
  availability: {
    openai: boolean;
    mcp: boolean;
  };
}

/**
 * Tool execution function type
 * Takes validated arguments and context, returns a result with ActionEntity
 */
export type ToolExecuteFunction<T extends z.ZodType> = (
  args: z.infer<T>,
  context: ToolExecutionContext
) => Promise<ToolResult>;

/**
 * Tool registration configuration
 * Used when registering a new tool with the registry
 */
export interface ToolRegistrationConfig<T extends z.ZodType> {
  /** Unique tool name */
  name: string;

  /** Description for LLM/MCP */
  description: string;

  /** Zod schema for parameter validation */
  schema: T;

  /** Execution function */
  execute: ToolExecuteFunction<T>;

  /**
   * Optional transform applied to the raw arguments **before** schema validation.
   *
   * Used to resolve variable placeholders: the action-generation prompt tells the
   * model to write `{{ placeholder }}` rather than a variable's real value, so the
   * substitution has to happen before `schema.parse` — otherwise a constrained field
   * such as `z.string().email()` rejects the placeholder and the tool never runs.
   *
   * Opt-in per tool. Built-in actions that resolve their own fields at execution time
   * leave this unset, which keeps substitution away from arguments where it would be
   * wrong (`js_code`'s `code`, where `${name}` is valid JavaScript).
   *
   * The pre-transform arguments are passed to `execute` as `context.rawArgs`.
   */
  resolveArgs?: (args: unknown) => unknown;

  /**
   * Optional redactor applied to validation-error text before it is returned or recorded.
   *
   * Zod embeds the rejected value in some messages (`z.enum`, a custom `.refine`), and
   * with `resolveArgs` that value may be a resolved secret. The failure reason is shown
   * to the model on the next step, so a tool that resolves arguments should pass a
   * redactor that masks its sensitive values.
   */
  redactErrorText?: (text: string) => string;

  /**
   * Whether this tool uses element_index parameter to reference DOM elements
   * When true, agentCore will resolve locator info for the element
   * Default: false
   */
  usesElementIndex?: boolean;

  /**
   * Tool availability flags
   * Controls which providers can expose this tool
   */
  availability?: {
    /** Available for OpenAI function calling (default: true) */
    openai?: boolean;
    /** Available for MCP (default: true) */
    mcp?: boolean;
  };
}
