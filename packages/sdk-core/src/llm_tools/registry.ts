/**
 * LLM Tools - Tool Registry
 *
 * Central registry for managing tool registration, validation, and execution.
 * Similar to browser-use's Registry pattern but adapted for TypeScript + Zod.
 */

import { z } from 'zod';
import {
  RegisteredTool,
  ToolExecutionContext,
  ToolRegistrationConfig,
  ToolResult,
} from './types';

/**
 * ToolRegistry - Manages tool registration and execution
 *
 * Example usage:
 * ```typescript
 * const registry = new ToolRegistry();
 *
 * // Register a tool
 * registry.register({
 *   name: 'click',
 *   description: 'Click an element by index',
 *   schema: z.object({ index: z.number() }),
 *   execute: async (args, ctx) => {
 *     // Implementation
 *     return { success: true, actionEntity, message: 'Clicked!' };
 *   },
 * });
 *
 * // Execute a tool
 * const result = await registry.execute('click', { index: 5 }, context);
 * ```
 */
export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  /**
   * Register a tool with schema and execution logic
   *
   * @param config - Tool configuration including name, description, schema, and execute function
   * @throws {Error} If a tool with the same name is already registered
   */
  register<T extends z.ZodType>(config: ToolRegistrationConfig<T>): void {
    if (this.tools.has(config.name)) {
      throw new Error(`Tool '${config.name}' is already registered`);
    }

    const tool: RegisteredTool = {
      name: config.name,
      description: config.description,
      schema: config.schema,
      execute: config.execute as any, // Type erasure for storage
      resolveArgs: config.resolveArgs,
      redactErrorText: config.redactErrorText,
      usesElementIndex: config.usesElementIndex ?? false,
      availability: {
        openai: config.availability?.openai ?? true,
        mcp: config.availability?.mcp ?? true,
      },
    };

    this.tools.set(config.name, tool);
  }

  /**
   * Get a tool by name
   *
   * @param name - Tool name
   * @returns The registered tool or undefined if not found
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists
   *
   * @param name - Tool name
   * @returns True if the tool is registered
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tool names
   *
   * @returns Array of tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get all registered tools
   *
   * @returns Array of registered tools
   */
  getTools(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool by name with argument validation
   *
   * @param toolName - Name of the tool to execute
   * @param args - Arguments to pass to the tool (will be validated against schema)
   * @param context - Execution context (page, agent, domService, etc.)
   * @returns Tool execution result with ActionEntity
   * @throws {Error} If tool not found or validation fails
   */
  async execute(
    toolName: string,
    args: any,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    try {
      // Extract description from args before validation (if present)
      // Description is added by VercelAIToolProvider but not part of the original schema
      const actionDescription = args?.description;
      const argsWithoutDescription = { ...args };
      delete argsWithoutDescription.description;

      // Resolve variable placeholders before validation. The model is told to write
      // {{ placeholder }} instead of a variable's real value, so a constrained field
      // such as z.string().email() would reject the placeholder if this ran after
      // parsing. Only tools that opt in are transformed.
      const argsToValidate = tool.resolveArgs
        ? tool.resolveArgs(argsWithoutDescription)
        : argsWithoutDescription;

      // Validate arguments with Zod schema (without description field)
      const validatedArgs = tool.schema.parse(argsToValidate);

      // Add description to context so tool implementations can use it. rawArgs carries
      // the pre-resolution arguments so the ActionEntity can keep the placeholder.
      const contextWithDescription = {
        ...context,
        actionDescription,
        ...(tool.resolveArgs ? { rawArgs: argsWithoutDescription } : {}),
      };

      // Execute tool with validated arguments and enhanced context
      return await tool.execute(validatedArgs, contextWithDescription);
    } catch (error) {
      // Handle Zod validation errors
      if (error instanceof z.ZodError) {
        // Zod embeds the rejected value in some messages (z.enum, custom .refine). Since
        // validation now runs on resolved arguments, that value can be a secret, and this
        // text is surfaced to the model as the step's failure reason. Tools that resolve
        // arguments supply a redactor for exactly this.
        const redact = tool.redactErrorText ?? ((text: string) => text);
        const errorMessages = redact(
          error.issues.map((err: any) => `${err.path.join('.')}: ${err.message}`).join(', ')
        );

        return {
          success: false,
          error: `Invalid arguments for tool '${toolName}': ${errorMessages}`,
          actionEntity: {
            action_description: args?.description || `${toolName} (validation failed)`,
            action_data: {
              action_name: toolName,
              kwargs: args,
            },
            feedback: `Validation error: ${errorMessages}`,
          },
        };
      }

      // Re-throw unexpected errors
      throw error;
    }
  }

  /**
   * Clear all registered tools (useful for testing)
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Get the count of registered tools
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * Build a Zod union schema for all registered actions
   * Each action becomes: z.object({ actionName: actionSchema })
   * Returns a union of all these wrapped schemas
   *
   * This is used by generateText with Output.object() to enforce structured output from LLMs.
   * Gemini requires OBJECT types to have non-empty properties, so we can't
   * use z.record(z.any()). Instead, we build an explicit union of all actions.
   *
   * For actions with no parameters (empty z.object({})), we add a dummy
   * optional property since Gemini rejects objects with empty properties.
   */
  buildActionUnionSchema(): z.ZodType {
    const tools = this.getTools().filter(tool => tool.availability.openai);
    return this.buildUnionSchemaFromTools(tools);
  }

  /**
   * Build a Zod union schema for a specific subset of tools by name.
   * Useful for exposing only certain actions to external consumers (e.g., MCP tools).
   * Each action schema is automatically extended with a description field.
   *
   * @param toolNames - Array of tool names to include in the schema
   * @returns Zod union schema for the specified tools
   */
  buildActionUnionSchemaForTools(toolNames: string[], withDescriptionField: boolean = false): z.ZodType {
    const toolNameSet = new Set(toolNames);
    const tools = this.getTools().filter(tool => toolNameSet.has(tool.name));
    return this.buildUnionSchemaFromTools(tools, withDescriptionField);
  }

  /**
   * Internal helper to build union schema from a list of tools
   */
  private buildUnionSchemaFromTools(tools: RegisteredTool[], withDescriptionField: boolean = false): z.ZodType {
    if (tools.length === 0) {
      // Fallback if no tools registered
      return z.object({ done: z.any() });
    }

    // Wrap each tool's schema as { toolName: schema }
    // For empty schemas (no properties), add a dummy optional field since:
    // 1. Gemini rejects objects with empty properties
    // 2. z.any() causes issues with Vercel AI SDK's union validation (no "required" field)
    const wrappedSchemas = tools.map(tool => {
      let schema: z.ZodType = tool.schema;

      // Extend schema with description field if requested
      if (withDescriptionField && schema instanceof z.ZodObject) {
        const shape = schema._def.shape();
        schema = z.object({
          ...shape,
          description: z.string().describe('Semantic, human-readable description of the action'),
        });
      }

      // Check if schema is an empty object (no properties)
      // ZodObject with empty shape has _def.shape() returning {}
      if (schema instanceof z.ZodObject) {
        const shape = schema._def.shape();
        if (Object.keys(shape).length === 0) {
          // Add a dummy optional field instead of z.any()
          // This ensures proper "required" field in JSON Schema for union validation.
          // Under OpenAI strict mode every property is required, so the model is
          // forced to emit this key — describe it, or it reads as a mandatory
          // field with unknown meaning. toStrictOutputSchema strips the null back
          // out, so it never reaches action_data.kwargs.
          schema = z.object({
            _empty: z
              .boolean()
              .optional()
              // Deliberately not "return null": this same union is published to
              // MCP `act` clients, where the field is plain optional and a null
              // would be rejected. "Value is ignored" is true for both consumers.
              .describe('Placeholder for an action that takes no parameters. Its value is ignored.'),
          });
        }
      }

      return z.object({ [tool.name]: schema });
    });

    // Create union of all wrapped schemas
    // z.union requires at least 2 elements
    if (wrappedSchemas.length === 1) {
      return wrappedSchemas[0];
    }

    // TypeScript needs explicit casting for z.union's tuple requirement
    const [first, second, ...rest] = wrappedSchemas;
    return z.union([first, second, ...rest]);
  }
}

/**
 * Singleton instance of the tool registry
 * Use this for global tool registration
 */
export const toolRegistry = new ToolRegistry();
