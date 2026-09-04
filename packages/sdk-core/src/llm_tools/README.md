# LLM Tools

A framework for exposing SDK actions to LLMs via function calling (OpenAI) and MCP (Model Context Protocol).

## Overview

The `llm_tools` module provides a clean layer between LLM function calls and the SDK's action execution layer. It:

1. **Converts simple parameters** (like `index`) into full `ActionEntity` objects
2. **Resolves DOM elements** using the DOM service
3. **Executes actions** via existing action classes
4. **Returns ActionEntity** for trajectory saving and test case generation
5. **Supports multiple providers**: OpenAI function calling, MCP, and future protocols

## Architecture

```
LLM Function Call
    ↓
Tool Definition (simple params: { index: 5 })
    ↓
DOM Service (resolve element by index)
    ↓
Generate ActionEntity (with xpath, locator, etc.)
    ↓
Execute Action (via existing action classes)
    ↓
Return ToolResult (with ActionEntity for trajectory)
```

## Quick Start

### Basic Usage

```typescript
import { toolRegistry, OpenAIToolProvider } from 'sdk-core/llm_tools';
import { Page } from 'playwright';
import { DOMService } from 'sdk-core/dom';

// Create execution context
const page = await browser.newPage();
const domService = new DOMService(page);

const context = {
  page,
  agent, // IAgent instance
  domService,
  stepId: 'step_1',
};

// Execute a tool
const result = await toolRegistry.execute('click', { index: 5 }, context);

if (result.success) {
  console.log(result.message); // "Clicked element 5"
  console.log(result.actionEntity); // Save to trajectory
} else {
  console.error(result.error);
}
```

### With OpenAI

```typescript
import { toolRegistry, OpenAIToolProvider } from 'sdk-core/llm_tools';
import OpenAI from 'openai';

// Get tool definitions
const provider = new OpenAIToolProvider(toolRegistry);
const tools = provider.getToolDefinitions();

// Use with OpenAI API
const openai = new OpenAI();
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'user', content: 'Click the submit button' }
  ],
  tools: tools,
});

// Execute the tool that LLM chose
const toolCall = response.choices[0].message.tool_calls?.[0];
if (toolCall) {
  const result = await toolRegistry.execute(
    toolCall.function.name,
    JSON.parse(toolCall.function.arguments),
    context
  );

  // Save result.actionEntity to trajectory
  trajectory.push(result.actionEntity);
}
```

### With MCP (Model Context Protocol)

```typescript
import { toolRegistry, MCPToolProvider } from 'sdk-core/llm_tools';

// Create MCP provider
const mcpProvider = new MCPToolProvider(
  toolRegistry,
  () => context // Context factory
);

// Get MCP tool definitions
const mcpTools = mcpProvider.getToolDefinitions();

// Or create an MCP server (requires MCP SDK)
const server = await mcpProvider.createServer('web-sdk-tools');
```

## Available Tools

### Tool Availability Matrix

Tools are registered with availability flags that control which providers can access them:

| Tool Category | OpenAI Function Calling | MCP | Purpose |
|--------------|------------------------|-----|---------|
| Mouse Tools | ✅ | ✅ | Basic interactions |
| Navigation Tools | ✅ | ✅ | Page navigation |
| AI Tools | ❌ | ✅ | Human-in-the-loop only |
| Input Tools (TODO) | ✅ | ✅ | Form input |
| Scroll Tools (TODO) | ✅ | ✅ | Page scrolling |
| Tab Tools (TODO) | ✅ | ✅ | Tab management |
| File Tools (TODO) | ✅ | ✅ | File operations |
| Form Tools (TODO) | ✅ | ✅ | Form controls |
| Auth Tools (TODO) | ✅ | ✅ | Authentication |
| Utility Tools (TODO) | ✅ | ✅ | Helpers |

### Mouse Tools (OpenAI + MCP)
- `click` - Click an element by index
- `hover` - Hover over an element
- `right_click` - Right-click an element
- `double_click` - Double-click an element

### Navigation Tools (OpenAI + MCP)
- `go_to_url` - Navigate to a URL
- `go_back` - Navigate back
- `reload_page` - Reload current page

### AI Tools (MCP-Only)
- `ai_assert` - Use AI to verify a statement
- `ai_extract` - Use AI to extract information and save to variable
- `ai_action` - Use AI to perform a specific action
- `ai_step` - Use AI to execute a complete multi-action step

**Why AI tools are MCP-only**: These tools use AI internally, so exposing them to LLMs via OpenAI function calling would create recursive AI calls. They are only available through MCP for human-in-the-loop scenarios or external orchestration.

### TODO: Additional Tools
- Input tools (fill, input_text, clear_input, etc.) - OpenAI + MCP
- Scroll tools (scroll, scroll_down, scroll_up, etc.) - OpenAI + MCP
- Tab tools (open_tab, close_tab, switch_tab) - OpenAI + MCP
- File tools (upload_file, wait_for_download, etc.) - OpenAI + MCP
- Form tools (select_dropdown_option) - OpenAI + MCP
- Auth tools (generate_2fa_code, extract_email_content, etc.) - OpenAI + MCP
- Utility tools (wait, save_variable, done) - OpenAI + MCP

## Creating Custom Tools

### 1. Define the Tool Schema

```typescript
import { z } from 'zod';

const MyCustomToolSchema = z.object({
  param1: z.string().describe('Description of param1'),
  param2: z.number().int().describe('Description of param2'),
});
```

### 2. Register the Tool

```typescript
import { ToolRegistry } from 'sdk-core/llm_tools';

function registerMyCustomTool(registry: ToolRegistry) {
  registry.register({
    name: 'my_custom_tool',
    description: 'What this tool does (shown to LLM/MCP)',
    schema: MyCustomToolSchema,

    // Optional: Control provider availability
    availability: {
      openai: true,  // Available for OpenAI (default: true)
      mcp: true,     // Available for MCP (default: true)
    },

    async execute(args, ctx) {
      const { param1, param2 } = args;
      const { page, agent, domService, stepId } = ctx;

      try {
        // 1. Resolve elements if needed
        const domState = await domService.getClickableElements();
        const element = domState.selectorMap.get(param2);

        // 2. Create ActionEntity
        const actionEntity = {
          action_description: `My custom action`,
          action_data: {
            action_name: 'my_custom_action',
            kwargs: { param1, param2 },
          },
        };

        // 3. Execute action
        // ... your implementation

        // 4. Return result with ActionEntity
        return {
          success: true,
          actionEntity,
          message: 'Success!',
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: { /* error entity */ },
        };
      }
    },
  });
}

// Export for auto-registration
export { registerMyCustomTool };
```

### 3. Auto-Register in index.ts

```typescript
// In src/llm_tools/index.ts
import { registerMyCustomTool } from './tools/custom';

// Add to auto-registration
registerMyCustomTool(toolRegistry);
```

## Provider-Specific Features

### OpenAI Provider

The OpenAI provider automatically:
- Converts Zod schemas to JSON Schema
- Enables strict mode (`additionalProperties: false`)
- Makes all parameters required
- Flattens all $refs and $defs
- **Filters to only include tools with `availability.openai = true`**

```typescript
const provider = new OpenAIToolProvider(toolRegistry);

// Get all OpenAI-compatible tools (excludes AI tools)
const allTools = provider.getToolDefinitions();
// Returns: click, hover, go_to_url, etc. (no ai_assert, ai_extract, etc.)

// Get specific tools only
const specificTools = provider.getToolDefinitionsFiltered(['click', 'fill']);

// Get a single tool
const clickTool = provider.getToolDefinition('click');

console.log('OpenAI tools:', allTools.length);
// Example output: 7 tools (excludes 4 AI tools)
```

### MCP Provider

The MCP provider is designed for Model Context Protocol integration and includes ALL tools (including AI tools):

```typescript
const mcpProvider = new MCPToolProvider(
  toolRegistry,
  () => ({ page, agent, domService }) // Context factory
);

// Get MCP-formatted tools (includes AI tools for human-in-the-loop)
const tools = mcpProvider.getToolDefinitions();
// Returns: click, hover, go_to_url, ai_assert, ai_extract, etc.

// Execute through MCP interface
const result = await mcpProvider.executeTool('click', { index: 5 });

console.log('MCP tools:', tools.length);
// Example output: 11 tools (includes 4 AI tools)
```

### Tool Filtering by Provider

Tools are automatically filtered based on their `availability` flags:

```typescript
// Example: AI tool with MCP-only availability
registry.register({
  name: 'ai_assert',
  description: 'Verify a statement with AI',
  schema: AiAssertSchema,
  execute: async (args, ctx) => { /* ... */ },
  availability: {
    openai: false,  // NOT available for OpenAI
    mcp: true,      // Available for MCP
  },
});

// OpenAI provider will skip this tool
const openaiTools = openaiProvider.getToolDefinitions();
// Does NOT include 'ai_assert'

// MCP provider will include this tool
const mcpTools = mcpProvider.getToolDefinitions();
// DOES include 'ai_assert'
```

## Key Design Principles

1. **Simple LLM interface**: Tools take simple parameters (like `index`) that LLMs can easily provide
2. **Full ActionEntity generation**: Every tool execution generates a complete ActionEntity with all metadata
3. **Trajectory support**: ActionEntity objects can be saved to trajectories for test case generation
4. **Provider agnostic**: Same tools work with OpenAI, MCP, and future protocols
5. **Type safe**: Zod schemas provide runtime validation and TypeScript types
6. **Matches browser-use**: Similar architecture to browser-use's Python implementation
7. **Provider-specific availability**: Tools can be selectively exposed to different providers (OpenAI vs MCP)

## File Structure

```
src/llm_tools/
├── index.ts                 # Main exports + auto-registration
├── types.ts                 # Core types and interfaces
├── registry.ts              # Tool registry (registration + execution)
├── schema.ts                # Zod → JSON Schema conversion
├── providers/
│   ├── openai.ts           # OpenAI function calling adapter
│   └── mcp.ts              # MCP adapter
└── tools/                   # Tool definitions
    ├── index.ts            # Export all tools
    ├── mouse.ts            # Mouse interaction tools
    ├── navigation.ts       # Navigation tools
    └── ... (more to come)
```

## Extending the System

### Adding a New Provider

```typescript
// src/llm_tools/providers/my-provider.ts

import { ToolRegistry } from '../registry';
import { zodToJsonSchema } from 'zod-to-json-schema';

export class MyProvider {
  constructor(private registry: ToolRegistry) {}

  getToolsInMyFormat() {
    return this.registry.getTools().map(tool => ({
      // Convert to your provider's format
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.schema),
    }));
  }
}
```

### Adding More Tools

See the examples in `tools/mouse.ts` and `tools/navigation.ts`. The pattern is:

1. Create a Zod schema for parameters
2. Register with `registry.register()`
3. In `execute()`:
   - Get DOM elements if needed
   - Create ActionEntity
   - Execute via existing action class
   - Return ToolResult with ActionEntity

## Testing

Tools can be tested independently:

```typescript
import { ToolRegistry } from 'sdk-core/llm_tools';
import { registerMouseTools } from 'sdk-core/llm_tools/tools';

const registry = new ToolRegistry();
registerMouseTools(registry);

// Test tool execution
const result = await registry.execute('click', { index: 5 }, context);
expect(result.success).toBe(true);
expect(result.actionEntity.action_data.action_name).toBe('click');
```

## Playwright Locator Generation

The LLM tools framework automatically generates the best Playwright locator for each action using Playwright's built-in `playwright.generateLocator()` function. This provides high-quality, maintainable locators that are optimized for reliability.

### How It Works

When a tool is executed (e.g., `click`, `hover`), the framework:

1. Gets the DOM element by index from the DOM service
2. Calls `pickBestLocator(page, xpath)` to generate the best locator
3. Falls back to `xpath=...` if the locator generator is not available
4. Includes the locator in the ActionEntity for test case generation

### Environment Setup

For best results, set `PWDEBUG=console` in your environment:

```bash
# In your .env file
PWDEBUG=console
```

This enables Playwright's locator generator, which produces locators like:
- `getByRole('button', { name: 'Submit' })`
- `getByLabel('Email')`
- `getByText('Click here')`

### Example

```typescript
import { toolRegistry } from 'sdk-core/llm_tools';
import { pickBestLocator } from 'sdk-core/dom';

// Execute a tool - locator is automatically generated
const result = await toolRegistry.execute('click', { index: 5 }, context);

console.log(result.actionEntity.locator);
// Output: getByRole("button", { name: "Submit" })

// Or generate a locator manually
const locator = await pickBestLocator(page, '//button[@id="submit"]');
console.log(locator);
// Output: getByRole("button", { name: "Submit" })
```

### Fallback Behavior

If `playwright.generateLocator()` is not available (PWDEBUG not set), the framework falls back to xpath-based locators:

```typescript
// With PWDEBUG=console
locator: 'getByRole("button", { name: "Submit" })'

// Without PWDEBUG (fallback)
locator: 'xpath=//button[@id="submit"]'
```

Both locators work with Playwright's `page.locator()` API.

## Future Enhancements

- [x] Provider-specific tool availability (OpenAI vs MCP)
- [x] AI tools with MCP-only availability
- [x] Playwright locator generation with fallback
- [ ] Complete all tool implementations (input, scroll, tabs, file, form, auth, utility)
- [ ] Add full MCP server implementation (once MCP SDK is chosen)
- [ ] Add tool filtering by page state (similar to browser-use's domain/page filters)
- [ ] Add tool usage telemetry/logging
- [ ] Add tool composition (combine multiple tools into workflows)
- [ ] Add streaming support for long-running tools
