/**
 * MCP Tool Types
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface ToolHandler {
  (args: unknown): Promise<string>;
}

export interface ToolClass {
  new (...args: any[]): any;
  toolDefinitions: ToolDefinition[];
}

export type ToolMethodName<T> = {
  [K in keyof T]: T[K] extends (args: unknown) => Promise<string> ? K : never;
}[keyof T];
