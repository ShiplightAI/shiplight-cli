# LLM Tools Architecture

## Overview

The LLM Tools framework provides a flexible system for exposing SDK actions to different consumers (LLMs, MCP, humans) with fine-grained control over which tools are available to each.

## Provider-Specific Availability

### The Problem

Different use cases require different tool sets:

1. **OpenAI Function Calling**: LLMs should have access to primitive actions (click, fill, navigate) but NOT AI-powered actions (to prevent recursive AI calls)
2. **MCP (Human-in-the-Loop)**: Humans using MCP should have access to ALL tools, including AI-powered ones for assisted workflows

### The Solution

Each tool is registered with an `availability` object:

```typescript
{
  openai: boolean,  // Available for OpenAI function calling
  mcp: boolean,     // Available for MCP
}
```

Providers automatically filter tools based on these flags.

## Tool Categories

### Category 1: Universal Tools (OpenAI + MCP)

**Tools**: Mouse, Navigation, Input, Scroll, Tabs, File, Form, Auth, Utility

**Availability**: `{ openai: true, mcp: true }`

**Purpose**: Basic browser automation primitives that work the same regardless of caller

**Example**:
```typescript
registry.register({
  name: 'click',
  description: 'Click an element by index',
  schema: z.object({ index: z.number() }),
  execute: async (args, ctx) => { /* ... */ },
  // Default availability (can be omitted)
  availability: { openai: true, mcp: true },
});
```

### Category 2: AI Tools (MCP-Only)

**Tools**: ai_assert, ai_extract, ai_action, ai_step

**Availability**: `{ openai: false, mcp: true }`

**Purpose**: AI-powered actions for human-in-the-loop scenarios

**Rationale**:
- LLM → AI tool → LLM = Recursive calls, confusion, unpredictable behavior
- Human → AI tool → LLM = Useful assisted workflow

**Example**:
```typescript
registry.register({
  name: 'ai_assert',
  description: 'Use AI to verify a statement',
  schema: z.object({ statement: z.string() }),
  execute: async (args, ctx) => { /* ... */ },
  // MCP-only availability
  availability: { openai: false, mcp: true },
});
```

## Data Flow

### OpenAI Function Calling Flow

```
User: "Click the submit button"
    ↓
OpenAI API (with filtered tools)
    ↓
LLM chooses: click({ index: 5 })
    ↓
ToolRegistry.execute('click', { index: 5 }, context)
    ↓
DOM Service (resolve element by index)
    ↓
ActionEntity generated
    ↓
ClickAction.execute()
    ↓
ToolResult with ActionEntity (saved to trajectory)
```

**Tools available to LLM**: click, hover, fill, navigate, etc. (7-10 tools)

**Tools filtered out**: ai_assert, ai_extract, ai_action, ai_step (4 tools)

### MCP Flow (Human-in-the-Loop)

```
Human via MCP Client: "ai_assert: Login was successful"
    ↓
MCP Server (with ALL tools)
    ↓
ToolRegistry.execute('ai_assert', { statement: '...' }, context)
    ↓
AiAssertAction.execute()
    ↓
  ↓ Internally uses AI
  Agent.assert(page, statement)
  ↓
ToolResult with ActionEntity
    ↓
MCP Client shows result to human
```

**Tools available via MCP**: ALL tools including AI tools (11+ tools)

## Implementation Details

### Registry (registry.ts)

```typescript
class ToolRegistry {
  register(config: {
    name: string;
    description: string;
    schema: ZodType;
    execute: Function;
    availability?: { openai?: boolean; mcp?: boolean };
  }) {
    const tool = {
      ...config,
      availability: {
        openai: config.availability?.openai ?? true,  // Default: true
        mcp: config.availability?.mcp ?? true,        // Default: true
      },
    };
    this.tools.set(config.name, tool);
  }
}
```

### OpenAI Provider (providers/openai.ts)

```typescript
class OpenAIToolProvider {
  getToolDefinitions(): ToolDefinition[] {
    return this.registry
      .getTools()
      .filter(tool => tool.availability.openai)  // Filter by availability
      .map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: zodToOpenAISchema(tool.schema),
          strict: true,
        },
      }));
  }
}
```

### MCP Provider (providers/mcp.ts)

```typescript
class MCPToolProvider {
  getToolDefinitions(): MCPToolDefinition[] {
    return this.registry
      .getTools()
      .filter(tool => tool.availability.mcp)  // Filter by availability
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToMCPSchema(tool.schema),
      }));
  }
}
```

## Use Cases

### Use Case 1: LLM-Driven Automation

**Scenario**: AI agent automates a web workflow

**Provider**: OpenAI Function Calling

**Available Tools**: click, hover, fill, navigate, scroll, etc.

**Blocked Tools**: ai_assert, ai_extract (prevents recursion)

**Example**:
```typescript
const provider = new OpenAIToolProvider(toolRegistry);
const tools = provider.getToolDefinitions();
// Returns 7 tools (no AI tools)

await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Fill the login form' }],
  tools: tools,
});
```

### Use Case 2: Human-Assisted Testing via MCP

**Scenario**: Tester uses Claude Desktop with MCP to build test cases

**Provider**: MCP

**Available Tools**: ALL tools including AI tools

**Example**:
```typescript
const mcpProvider = new MCPToolProvider(toolRegistry, getContext);
const tools = mcpProvider.getToolDefinitions();
// Returns 11+ tools (includes AI tools)

// Human in Claude Desktop:
// "Use ai_extract to get the product price"
// MCP executes ai_extract, which uses AI internally
// Result returned to human for verification
```

### Use Case 3: Future Provider (e.g., Custom Agent Framework)

**Scenario**: Custom agent framework with different requirements

**Solution**: Create new provider with custom filtering logic

**Example**:
```typescript
class CustomProvider {
  getToolDefinitions() {
    return this.registry
      .getTools()
      .filter(tool => {
        // Custom logic: Only basic tools
        return tool.name.startsWith('click') || tool.name.startsWith('fill');
      })
      .map(/* ... */);
  }
}
```

## Benefits

1. **Prevents Recursion**: LLMs can't call AI tools that would create infinite loops
2. **Enables Human-AI Collaboration**: Humans can use AI tools via MCP
3. **Flexible**: Easy to add new providers with different tool sets
4. **Type-Safe**: Zod schemas enforce correct tool usage
5. **Discoverable**: Providers automatically filter based on availability flags
6. **Extensible**: New tools can specify availability for existing and future providers

## Testing

Tools can be tested with different provider configurations:

```typescript
import { ToolRegistry, OpenAIToolProvider, MCPToolProvider } from './index';

describe('Tool Availability', () => {
  it('OpenAI provider excludes AI tools', () => {
    const registry = new ToolRegistry();
    registerMouseTools(registry);
    registerAITools(registry);

    const provider = new OpenAIToolProvider(registry);
    const tools = provider.getToolDefinitions();

    expect(tools.some(t => t.function.name === 'click')).toBe(true);
    expect(tools.some(t => t.function.name === 'ai_assert')).toBe(false);
  });

  it('MCP provider includes AI tools', () => {
    const registry = new ToolRegistry();
    registerMouseTools(registry);
    registerAITools(registry);

    const provider = new MCPToolProvider(registry, getContext);
    const tools = provider.getToolDefinitions();

    expect(tools.some(t => t.name === 'click')).toBe(true);
    expect(tools.some(t => t.name === 'ai_assert')).toBe(true);
  });
});
```

## Migration Guide

If you have existing tools without availability flags:

**Before**:
```typescript
registry.register({
  name: 'click',
  description: 'Click element',
  schema: ClickSchema,
  execute: clickFn,
  // No availability specified
});
```

**After** (no changes needed):
```typescript
registry.register({
  name: 'click',
  description: 'Click element',
  schema: ClickSchema,
  execute: clickFn,
  // Defaults to { openai: true, mcp: true }
});
```

**For MCP-only tools**:
```typescript
registry.register({
  name: 'ai_assert',
  description: 'AI-powered assertion',
  schema: AiAssertSchema,
  execute: aiAssertFn,
  // Explicitly set MCP-only
  availability: { openai: false, mcp: true },
});
```

## Future Extensions

Potential future availability flags:

```typescript
availability: {
  openai: boolean,
  mcp: boolean,
  anthropic: boolean,     // Anthropic's tool use
  langchain: boolean,      // LangChain integration
  custom_agent: boolean,   // Custom agent framework
}
```

The system is designed to be easily extended with new providers and availability controls.
