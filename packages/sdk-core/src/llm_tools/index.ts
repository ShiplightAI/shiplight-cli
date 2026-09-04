/**
 * LLM Tools - Main Entry Point
 *
 * This module provides a clean interface for exposing SDK actions to LLMs
 * via function calling (OpenAI) and MCP (Model Context Protocol).
 *
 * Usage:
 * ```typescript
 * import { toolRegistry, OpenAIToolProvider } from 'sdk-core/llm_tools';
 *
 * // Get OpenAI-compatible tool definitions
 * const openaiProvider = new OpenAIToolProvider(toolRegistry);
 * const tools = openaiProvider.getToolDefinitions();
 *
 * // Use with OpenAI API
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [...],
 *   tools: tools,
 * });
 *
 * // Execute a tool
 * const result = await toolRegistry.execute('click', { index: 5 }, context);
 * console.log(result.actionEntity); // Save to trajectory
 * ```
 */

// Core exports
export { ToolRegistry, toolRegistry } from './registry';
export { optimizeSchema, validateStrictMode, zodToMCPSchema, zodToOpenAISchema } from './schema';
export * from './types';

// Provider exports
export { exportMCPTools, MCPToolProvider } from './providers/mcp';
export { OpenAIToolProvider } from './providers/openai';
export { VercelAIToolProvider } from './providers/vercel';

// Tool registration exports
export * from './tools';

// Auto-register all tools with the singleton registry
import { toolRegistry, ToolRegistry as ToolRegistryClass } from './registry';
import {
  formatCapabilitySummary,
  registerAITools,
  registerAllToolsWithCapabilities,
  registerAuthTools,
  registerFileTools,
  registerFormTools,
  registerInputTools,
  registerMouseTools,
  registerNavigationTools,
  registerScrollTools,
  registerTabTools,
  registerUtilityTools,
  type ToolCapabilities,
} from './tools';

// Register all available tools on module import
// Store promises to allow awaiting completion
const toolRegistrationPromises = [
  registerMouseTools(toolRegistry),
  registerNavigationTools(toolRegistry),
  registerInputTools(toolRegistry),
  registerScrollTools(toolRegistry),
  registerTabTools(toolRegistry),
  registerFileTools(toolRegistry),
  registerFormTools(toolRegistry),
  registerUtilityTools(toolRegistry),
  registerAITools(toolRegistry), // MCP-only tools
  registerAuthTools(toolRegistry),
];

// Promise that resolves when all tools are registered
const allToolsRegistered = Promise.all(toolRegistrationPromises);

/**
 * Ensure all tools are registered before proceeding.
 * Call this before generating documentation or using the registry if you need
 * to guarantee tools are available.
 *
 * @returns Promise that resolves when all tools are registered
 */
export async function ensureToolsRegistered(): Promise<void> {
  await allToolsRegistered;
}

/**
 * Get a pre-configured ToolRegistry with all tools registered
 *
 * @returns Singleton tool registry instance
 */
export function getToolRegistry(): ToolRegistryClass {
  return toolRegistry;
}

/**
 * Create a fresh ToolRegistry instance
 *
 * Useful for testing or creating isolated tool environments
 *
 * @param autoRegister - Whether to automatically register all tools (default: true)
 * @returns New ToolRegistry instance
 */
export function createToolRegistry(autoRegister: boolean = true): ToolRegistryClass {
  const registry = new ToolRegistryClass();

  if (autoRegister) {
    registerMouseTools(registry);
    registerNavigationTools(registry);
    registerInputTools(registry);
    registerScrollTools(registry);
    registerTabTools(registry);
    registerFileTools(registry);
    registerFormTools(registry);
    registerAuthTools(registry);
    registerUtilityTools(registry);
    registerAITools(registry); // MCP-only tools
  }

  return registry;
}

/**
 * Create a fresh ToolRegistry and return both the registry and capability summary.
 *
 * This is useful when you need to know what actions are available without
 * looking at individual tool definitions.
 *
 * @returns Object containing the registry and formatted capability summary
 */
export async function createToolRegistryWithCapabilities(): Promise<{
  registry: ToolRegistryClass;
  capabilities: ToolCapabilities;
  summary: string;
}> {
  const registry = new ToolRegistryClass();
  const capabilities = await registerAllToolsWithCapabilities(registry);
  const summary = formatCapabilitySummary(capabilities);
  return { registry, capabilities, summary };
}

/**
 * Get a formatted summary of all available browser automation capabilities.
 *
 * This returns a human-readable string describing what actions can be performed,
 * useful for including in LLM prompts to describe available capabilities.
 *
 * @returns Formatted capability summary string
 */
export function getCapabilitySummary(): string {
  // Return static summary (doesn't require registry registration)
  return [
    '- Mouse: Click, hover, double-click, right-click or drag on elements',
    '- Navigation: Navigate to URLs, go back, or reload the page',
    '- Input: Type text into inputs, clear input fields, or press keyboard keys',
    '- Scroll: Scroll the page or scroll to specific text/elements',
    '- Tabs: Switch between browser tabs or close tabs',
    '- Files: Upload files or wait for downloads to complete',
    '- Forms: Get dropdown options or select dropdown values',
    '- Utility: Wait for conditions, save variables, or complete tasks',
    '- Auth: Generate 2FA codes or extract email/activation codes',
    '- AI: Perform AI-powered verifications, extractions, or wait conditions',
  ].join('\n');
}
