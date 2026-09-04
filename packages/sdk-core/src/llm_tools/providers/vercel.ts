/**
 * LLM Tools - Vercel AI SDK Provider
 *
 * Adapter for exposing tools in Vercel AI SDK format.
 * Converts tool registry to AI SDK-compatible tool definitions.
 */

import { z } from 'zod';
import { ToolRegistry } from '../registry';

/**
 * Vercel AI SDK Tool Provider
 *
 * Converts tools from the registry into Vercel AI SDK format.
 * Uses Zod schemas directly - the AI SDK handles conversion internally.
 *
 * Example usage:
 * ```typescript
 * import { toolRegistry } from 'sdk-core/llm_tools';
 * import { VercelAIToolProvider } from 'sdk-core/llm_tools/providers/vercel';
 * import { generateText } from 'ai';
 *
 * const provider = new VercelAIToolProvider(toolRegistry);
 * const tools = provider.getTools();
 *
 * const result = await generateText({
 *   model: google('gemini-2.5-pro'),
 *   messages: [...],
 *   tools: tools,
 * });
 * ```
 */
export class VercelAIToolProvider {
	constructor(private registry: ToolRegistry) {}

	/**
	 * Get AI SDK-compatible tool definitions for all registered tools
	 * Only includes tools where availability.openai = true (AI SDK uses same format)
	 *
	 * Automatically adds a 'description' field to browser action tool schemas
	 * so the LLM can provide human-readable descriptions like "click the search button"
	 *
	 * @returns Record of tool definitions in AI SDK format
	 */
	getTools(): Record<string, any> {
		const toolsMap = Object.fromEntries(
			this.registry
				.getTools()
				.filter((tool) => tool.availability.openai)
				.map((tool) => {
					return [
						tool.name,
						{
							description: tool.description,
							inputSchema: tool.schema,
						},
					];
				})
		);
		return toolsMap as unknown as any;
	}

	/**
	 * Get tool definitions for specific tools only
	 * Only includes tools where availability.openai = true
	 *
	 * @param toolNames - Array of tool names to include
	 * @returns Filtered record of tool definitions
	 */
	getToolsFiltered(toolNames: string[]): Record<string, any> {
		const toolSet = new Set(toolNames);
		const toolsMap = Object.fromEntries(
			this.registry
				.getTools()
				.filter((tool) => toolSet.has(tool.name) && tool.availability.openai)
				.map((tool) => [
					tool.name,
					{
						description: tool.description,
						inputSchema: tool.schema,
					},
				])
		);
		return toolsMap;
	}

	/**
	 * Get a single tool definition by name
	 *
	 * @param toolName - Name of the tool
	 * @returns Tool definition or undefined if not found
	 */
	getTool(toolName: string): any {
		const tool = this.registry.get(toolName);

		if (!tool) {
			return undefined;
		}

		return {
			description: tool.description,
			inputSchema: tool.schema,
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
