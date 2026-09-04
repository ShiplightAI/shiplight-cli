# sdk-core

A browser automation SDK with AI capabilities built on Playwright. Provides intelligent DOM extraction, AI-powered actions, and self-healing test execution.

## Installation

```bash
npm install sdk-core playwright @playwright/test
```

## Quick Start

```typescript
import { createAgent } from 'sdk-core';
import { chromium } from 'playwright';

async function main() {
  // Launch browser
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Create agent with simple factory
  const agent = createAgent({
    model: 'claude-sonnet-4-20250514',
    variables: { username: 'test@example.com' }
  });

  // Navigate and perform AI-powered actions
  await page.goto('https://example.com');

  // Execute natural language instructions
  await agent.run(page, 'Click the login button');

  // Make AI-powered assertions
  await agent.assert(page, 'The login form is visible');

  await browser.close();
}
```

## Core API

### createAgent (Recommended)

The simplest way to create an agent:

```typescript
import { createAgent } from 'sdk-core';

const agent = createAgent({
  model: 'claude-sonnet-4-20250514',  // Required: LLM model
  variables: {                         // Optional: Initial variables
    username: 'test@example.com',
    password: 'secret123',
  },
  sensitiveKeys: ['password'],         // Optional: Keys hidden from LLM
});
```

### Agent Methods

```typescript
// Run a natural language instruction
await agent.run(page, 'Fill in the email field with test@example.com');

// Assert a condition (throws if false)
await agent.assert(page, 'The success message is displayed');

// Evaluate a condition (returns boolean)
const isVisible = await agent.evaluate(page, 'The submit button is enabled');

// Execute a multi-step task
const result = await agent.step(page, 'Complete the checkout process');

// Execute a specific action (low-level)
await agent.execAction('click', page, {
  locator: "getByRole('button', { name: 'Submit' })"
});
```

### Advanced: Manual Agent Creation

For more control, create the agent manually:

```typescript
import { Agent, createAgentContext, VariableStore } from 'sdk-core';

const variableStore = new VariableStore();
variableStore.set('username', 'test@example.com');

const context = createAgentContext({
  model: 'claude-sonnet-4-20250514',
  variableStore,
  organizationId: 'your-org-id',
});

const agent = new Agent(context);
```

## DOM Extraction

Extract and analyze DOM structure for AI processing:

```typescript
import { DomService } from 'sdk-core';

const domService = new DomService();

// Get interactive elements as a structured tree
const domState = await domService.getDomState(page, {
  includeIframes: true,
  maxDepth: 10,
});

// Get text representation for LLM
const domText = domState.toString();
```

## LLM Tool Integration

### OpenAI Function Calling

```typescript
import { getToolRegistry, OpenAIToolProvider } from 'sdk-core';

const registry = getToolRegistry();
const provider = new OpenAIToolProvider(registry);

// Get tools in OpenAI format
const tools = provider.getToolDefinitions();

// Execute a tool call from LLM response
const result = await provider.executeTool(toolCall, { page, agentServices });
```

### MCP (Model Context Protocol)

```typescript
import { getToolRegistry, MCPToolProvider } from 'sdk-core';

const registry = getToolRegistry();
const provider = new MCPToolProvider(registry);

// Get MCP tool definitions
const tools = provider.getTools();

// Execute MCP tool call
const result = await provider.executeTool(toolName, args, context);
```

## Browser Management

```typescript
import { BrowserManager } from 'sdk-core';

const manager = new BrowserManager({
  headless: false,
  recordVideo: true,
  device: 'iPhone 14',
});

const { browser, context, page } = await manager.launch();
// ... run automation
await manager.close();
```

## Configuration

```typescript
import { configureSdk, LogLevel } from 'sdk-core';

configureSdk({
  logLevel: LogLevel.DEBUG,
  debugAgent: true,
});
```

## Type Exports

```typescript
import type {
  // Agent types
  CreateAgentOptions,
  AgentOptions,
  StepResult,
  ActionResult,

  // Action types
  ActionEntity,
  IAction,

  // DOM types
  DOMState,
  DOMElementNode,

  // Tool types
  ToolDefinition,
  MCPToolDefinition,

  // Browser types
  BrowserManagerConfig,
} from 'sdk-core';
```

## Requirements

- Node.js >= 18.0.0
- Playwright >= 1.40.0
- @playwright/test >= 1.40.0

## License

MIT
