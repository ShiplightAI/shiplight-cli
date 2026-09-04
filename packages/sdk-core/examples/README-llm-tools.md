# LLM Tools Example

This example demonstrates how to use the LLM tools framework with OpenAI function calling for web automation.

## Overview

The LLM tools framework exposes SDK actions as tools that can be used with:
- **OpenAI Function Calling** - For AI-driven automation
- **MCP (Model Context Protocol)** - For human-in-the-loop scenarios

## Prerequisites

1. **Install dependencies**:
   ```bash
   cd <repo-root>
   pnpm install
   ```

2. **Build the SDK**:
   ```bash
   cd packages/web-sdk
   pnpm build
   ```

3. **Set up OpenAI API key** (for OpenAI examples):
   ```bash
   export OPENAI_API_KEY='your-api-key-here'
   ```

4. **Optional: Enable Playwright locator generator**:
   ```bash
   export PWDEBUG=console
   ```

## Running the Example

```bash
cd examples/sdk-examples
tsx llmTools.ts
```

## What the Example Demonstrates

### 1. **Basic Tool Execution**
   - Direct tool execution without LLM
   - Navigation and interaction
   - ActionEntity generation

### 2. **OpenAI Function Calling Integration**
   - Getting tool definitions for OpenAI
   - Single-turn conversation with tool use
   - Executing tools based on LLM decisions
   - Locator generation for test case creation

### 3. **Multi-turn Conversation**
   - Stateful conversation with tools
   - Multiple tool calls in sequence
   - Context preservation across turns

### 4. **Tool Information**
   - Listing available tools
   - Filtering tools
   - Tool introspection
   - Understanding provider-specific availability

## Available Tools

### Universal Tools (OpenAI + MCP)

- **Mouse**: `click`, `hover`, `right_click`, `double_click`
- **Navigation**: `go_to_url`, `go_back`, `reload_page`

### MCP-Only Tools (AI Tools)

- `ai_assert` - Verify statements with AI
- `ai_extract` - Extract information with AI
- `ai_action` - Perform actions with AI
- `ai_step` - Execute complete steps with AI

> **Note**: AI tools are excluded from OpenAI function calling to prevent recursive AI calls.

## Example Output

```
🚀 LLM Tools Examples

=== Example 4: Tool Information ===

📋 Total tools: 7

🎯 Filtered tools (click, go_to_url): 2
  - click: Click an interactive element by its index
  - go_to_url: Navigate to a specific URL

🔍 Click tool details:
  Name: click
  Description: Click an interactive element by its index
  Parameters: {...}

📊 Tool availability:
  Total registered: 11
  Available to OpenAI: 7
  Filtered out: 4 (AI tools - MCP only)

=== Example 1: Basic Tool Execution ===

Navigation result: ✅ Navigated to https://example.com

=== Example 2: OpenAI Function Calling ===

📋 Registered 7 tools for OpenAI:
  - click
  - hover
  - right_click
  - double_click
  - go_to_url
  - go_back
  - reload_page

🤖 User: Navigate to https://github.com

💬 Assistant: (using tools)

🔧 Tool Call: go_to_url
   Arguments: {"url":"https://github.com"}
   Result: ✅ Navigated to https://github.com
   Locator: xpath=/html/body
   Action: go_to_url

=== Example 3: Multi-turn Conversation ===

👤 User: Go to https://example.com
🤖 Assistant: I'll navigate to example.com
   🔧 Executing: go_to_url
   ✅ Navigated to https://example.com

👤 User: Now go back to the previous page
🤖 Assistant: Going back to the previous page
   🔧 Executing: go_back
   ✅ Navigated back

✅ All examples completed!
```

## Code Structure

The example includes:

1. **Mock Agent** - Minimal IAgent implementation for demonstration
2. **Basic Usage** - Direct tool execution
3. **OpenAI Integration** - Function calling with OpenAI
4. **Multi-turn** - Stateful conversations
5. **Tool Information** - Introspection and filtering

## Key Features Demonstrated

### Automatic Locator Generation

Tools automatically generate Playwright locators using `playwright.generateLocator()`:

```typescript
const result = await toolRegistry.execute('click', { index: 5 }, context);
console.log(result.actionEntity.locator);
// Output: getByRole("button", { name: "Submit" })
```

### ActionEntity for Test Cases

Every tool execution returns an ActionEntity that can be saved to trajectories:

```typescript
const trajectory: ActionEntity[] = [];
const result = await toolRegistry.execute('click', { index: 5 }, context);
if (result.success) {
  trajectory.push(result.actionEntity);
}
```

### Provider-Specific Tools

Tools are filtered by provider:
- OpenAI gets 7 tools (excluding AI tools)
- MCP gets 11 tools (including AI tools)

## Customization

### Import from SDK

The LLM tools are exported from the main SDK package:

```typescript
import {
  toolRegistry,
  OpenAIToolProvider,
  MCPToolProvider,
  DomService,
  IAgent,
  pickBestLocator,
} from 'sdk-core';
```

### Using Specific Tools Only

```typescript
const provider = new OpenAIToolProvider(toolRegistry);
const tools = provider.getToolDefinitionsFiltered(['click', 'go_to_url']);
```

### Creating Custom Tools

See `packages/web-sdk/src/llm_tools/README.md` for how to create custom tools.

## Troubleshooting

### "playwright is not defined"

Set `PWDEBUG=console` to enable Playwright's locator generator:
```bash
export PWDEBUG=console
tsx llmTools.ts
```

### "OPENAI_API_KEY not set"

The OpenAI examples require an API key:
```bash
export OPENAI_API_KEY='sk-...'
```

### TypeScript errors

Make sure the SDK is built:
```bash
cd packages/web-sdk
pnpm build
```

## Next Steps

- Explore the full LLM tools documentation: `packages/web-sdk/src/llm_tools/README.md`
- Learn about the architecture: `packages/web-sdk/src/llm_tools/ARCHITECTURE.md`
- Try creating custom tools
- Integrate with your own agent implementation

## Related Examples

- `basicAgent.ts` - Basic agent usage
- `extractDom.ts` - DOM extraction
- See `README-sdk.md` for more SDK examples
