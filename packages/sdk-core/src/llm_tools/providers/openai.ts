/**
 * LLM Tools - OpenAI Function Calling Provider
 *
 * Adapter for exposing tools in OpenAI function calling format.
 * Converts tool registry to OpenAI-compatible tool definitions.
 */

import { ToolRegistry } from '../registry';
import { ToolDefinition } from '../types';
import { zodToOpenAISchema } from '../schema';

/**
 * OpenAI Tool Provider
 *
 * Converts tools from the registry into OpenAI function calling format.
 *
 * Example usage:
 * ```typescript
 * const registry = new ToolRegistry();
 * // ... register tools
 *
 * const provider = new OpenAIToolProvider(registry);
 * const tools = provider.getToolDefinitions();
 *
 * // Use with OpenAI API
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [...],
 *   tools: tools,
 * });
 * ```
 */
export class OpenAIToolProvider {
  constructor(private registry: ToolRegistry) {}

  /**
   * Get OpenAI-compatible tool definitions for all registered tools
   * Only includes tools where availability.openai = true
   *
   * @returns Array of tool definitions in OpenAI format
   */
  getToolDefinitions(): ToolDefinition[] {
    return this.registry
      .getTools()
      .filter((tool) => tool.availability.openai)
      .map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: zodToOpenAISchema(tool.schema),
          strict: true, // Enable OpenAI strict mode for better reliability
        },
      }));
  }

  /**
   * Get tool definitions for specific tools only
   * Only includes tools where availability.openai = true
   *
   * @param toolNames - Array of tool names to include
   * @returns Filtered array of tool definitions
   */
  getToolDefinitionsFiltered(toolNames: string[]): ToolDefinition[] {
    const toolSet = new Set(toolNames);

    return this.registry
      .getTools()
      .filter((tool) => toolSet.has(tool.name) && tool.availability.openai)
      .map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: zodToOpenAISchema(tool.schema),
          strict: true,
        },
      }));
  }

  /**
   * Get tool definitions as plain JSON (for API serialization)
   *
   * @returns Tool definitions as JSON-serializable array
   */
  toJSON(): any[] {
    return this.getToolDefinitions();
  }

  /**
   * Get a single tool definition by name
   *
   * @param toolName - Name of the tool
   * @returns Tool definition or undefined if not found
   */
  getToolDefinition(toolName: string): ToolDefinition | undefined {
    const tool = this.registry.get(toolName);

    if (!tool) {
      return undefined;
    }

    return {
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToOpenAISchema(tool.schema),
        strict: true,
      },
    };
  }

  /**
   * Get count of available tools
   */
  getToolCount(): number {
    return this.registry.size();
  }

  /**
   * Get names of all available tools
   */
  getToolNames(): string[] {
    return this.registry.getToolNames();
  }
}
