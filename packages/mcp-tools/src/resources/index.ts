/**
 * MCP Resources
 *
 * Shared resource definitions for Shiplight AI MCP servers.
 * Provides schema documentation and examples for TestFlow format.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { getToolRegistry, ensureToolsRegistered, type ToolRegistry } from "sdk-core";
import { ACT_SUPPORTED_ACTIONS } from "../backends/sessionTypes.js";

// ============================================================================
// Documentation Generation Helpers
// ============================================================================

/**
 * Generate markdown documentation for specified tools from registry.
 * Uses zod-to-json-schema for accurate schema conversion.
 */
function generateToolDocumentation(registry: ToolRegistry, toolNames: readonly string[]): string {
  const lines: string[] = [];

  lines.push('## Supported Actions\n');

  for (const toolName of toolNames) {
    const tool = registry.get(toolName);
    if (!tool) continue;

    const jsonSchema = zodToJsonSchema(tool.schema, { $refStrategy: "none" });

    lines.push(`#### ${tool.name}`);
    lines.push(tool.description);
    lines.push('```json');
    lines.push(JSON.stringify(jsonSchema, null, 2));
    lines.push('```\n');
  }

  return lines.join('\n');
}

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/**
 * List of all available resources
 */
export const RESOURCES: ResourceDefinition[] = [
  {
    uri: "shiplight://schemas/action-entity",
    name: "ActionEntity Schema & Action Parameters",
    description: "Detailed parameter documentation for supported browser actions",
    mimeType: "text/markdown",
  },
];


/**
 * Generate ActionEntity schema resource content
 * Dynamically generates documentation from the tool registry's Zod schemas.
 * This ensures documentation stays in sync with actual tool definitions.
 */
export async function getActionEntitySchemaResource(): Promise<string> {
  await ensureToolsRegistered();
  const registry = getToolRegistry();
  const actionDocs = generateToolDocumentation(registry, ACT_SUPPORTED_ACTIONS);

  return `# ActionEntity Schema & Action Parameters

## Overview

This document describes the ActionEntity schema and parameters for supported browser actions.

**IMPORTANT:** All actions require a \`description\` field with a semantic, human-readable description.

## ActionEntity Structure

\`\`\`typescript
interface ActionEntity {
  action_description: string;    // Human-readable description
  action_data: {
    action_name: string;         // Name of the action
    kwargs: Record<string, any>; // Action-specific parameters
  };
  locator?: string;              // Playwright locator (auto-generated)
  xpath?: string;                // XPath selector (auto-generated)
  frame_path?: string[];         // Frame path for iframes (auto-generated)
}
\`\`\`

${actionDocs}

## Examples

### Click a button
\`\`\`json
{"click": {"element_index": 5, "description": "Click the Submit button"}}
\`\`\`

### Type in a field
\`\`\`json
{"input_text": {"element_index": 3, "text": "john@example.com", "description": "Enter email address"}}
\`\`\`

### Press Enter
\`\`\`json
{"press": {"keys": "Enter", "description": "Submit the form"}}
\`\`\`

### Select dropdown option
\`\`\`json
{"select_dropdown_option": {"element_index": 7, "option": "United States", "description": "Select country"}}
\`\`\`

### Navigate to URL
\`\`\`json
{"go_to_url": {"url": "https://example.com/login", "description": "Navigate to login page"}}
\`\`\`

### Scroll down
\`\`\`json
{"scroll": {"down": true, "num_pages": 1, "description": "Scroll down one page"}}
\`\`\`

## Where This Data Goes

The \`locator\`, \`xpath\`, and \`frame_path\` fields above are what make a saved
test replay deterministically instead of re-detecting each element with the
model. Embed them into the \`.test.yaml\` statements you write.

Authoring those files is the CLI's job, not this server's — the parser that
validates a test ships with the one that runs it, so they cannot disagree
about what the YAML means:

1. \`npx shiplight create . --json\` — scaffold a Playwright project (JSON output carries per-file merge instructions when the directory is not empty)
2. \`npx shiplight spec yaml\` — the normative YAML language spec for the installed version
3. Write \`.test.yaml\` files, embedding the action-entity data captured here via \`get_locators\`
4. \`npx shiplight transpile --strict\` — validate; fails while statements are still bare drafts
`;
}


/**
 * List all available resources
 */
export function listResources(): ResourceDefinition[] {
  return RESOURCES;
}

/**
 * Get resource content by URI
 */
export async function getResource(uri: string): Promise<string | undefined> {
  switch (uri) {
    case "shiplight://schemas/action-entity":
      return await getActionEntitySchemaResource();
    default:
      return undefined;
  }
}
