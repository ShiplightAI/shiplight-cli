# Agent Examples

This directory contains examples demonstrating how to use the Agent for AI-powered browser automation.

## Prerequisites

1. **WebAgent Service Running**: You need the WebAgent service running at `http://localhost:8000`
   ```bash
   # From webagent directory
   python -m uvicorn api.main:app --reload --port 8000
   ```

2. **Environment Variables**:
   - `WEBAGENT_URL`: WebAgent API URL (default: http://localhost:8000)
   - `PLAYWRIGHT_DEBUG_PORT`: CDP debug port for browser communication (default: 9222)

## Running Examples

### Quick Start
```bash
# Run a single example
WEBAGENT_URL=http://localhost:8000 tsx src/agent/examples/basicAgent.ts 1

# Run all examples
WEBAGENT_URL=http://localhost:8000 tsx src/agent/examples/basicAgent.ts all
```

## Available Examples

### Example 1: Simple Action
```bash
tsx src/agent/examples/basicAgent.ts 1
# or
tsx src/agent/examples/basicAgent.ts simple
```

Demonstrates:
- Starting a browser with CDP enabled
- Creating an agent
- Using `agent.execute()` to perform an AI-generated action
- Example: "Click on the English Wikipedia link"

### Example 2: Multiple Actions
```bash
tsx src/agent/examples/basicAgent.ts 2
# or
tsx src/agent/examples/basicAgent.ts multiple
```

Demonstrates:
- Executing multiple AI actions in sequence
- Example workflow: Search for "Playwright" on Wikipedia

### Example 3: Assertions
```bash
tsx src/agent/examples/basicAgent.ts 3
# or
tsx src/agent/examples/basicAgent.ts assert
```

Demonstrates:
- Using `agent.assert()` to verify page state
- Example: "The page contains a search box"
- Assertions throw errors if they fail

### Example 4: Evaluate
```bash
tsx src/agent/examples/basicAgent.ts 4
# or
tsx src/agent/examples/basicAgent.ts evaluate
```

Demonstrates:
- Using `agent.evaluate()` to check conditions without throwing errors
- Returns boolean results
- Example: "There is a search box on the page"

## How It Works

### 1. Browser Setup
The examples launch a Chromium browser with CDP enabled:
```typescript
const browser = await chromium.launch({
  headless: false,
  args: [`--remote-debugging-port=${process.env.PLAYWRIGHT_DEBUG_PORT}`]
});
```

### 2. Agent Creation
Create an agent with proper configuration:
```typescript
const context = createAgentContext({
  testDataDir: '/tmp',
  organizationSettings: {
    webagent_url: process.env.WEBAGENT_URL || 'http://localhost:8000'
  }
});
const agent = new Agent(context);
```

### 3. AI-Powered Actions
Use natural language to control the browser:
```typescript
// Execute an action
await agent.execute(page, 'Click on the English Wikipedia link');

// Make an assertion
await agent.assert(page, 'The page contains a search box');

// Evaluate a condition
const hasSearch = await agent.evaluate(page, 'There is a search box');
```

## Troubleshooting

### WebAgent Not Running
```
Error: WEBAGENT_URL environment variable not set
```
**Solution**: Start the WebAgent service and set the environment variable:
```bash
export WEBAGENT_URL=http://localhost:8000
```

### CDP Connection Issues
```
Error: CDP URL is required
```
**Solution**: Ensure `PLAYWRIGHT_DEBUG_PORT` is set and the browser launches with the debug port:
```bash
export PLAYWRIGHT_DEBUG_PORT=9222
```

### Action Execution Fails
```
Error: AI action generation failed
```
**Possible causes**:
1. WebAgent service not running
2. Page is not stable/loaded
3. Natural language instruction is ambiguous

**Solution**:
- Verify WebAgent is running at the correct URL
- Add `await page.waitForTimeout(2000)` after navigation
- Make instructions more specific

## Next Steps

After trying these examples, you can:
1. Modify the examples to test different websites
2. Create your own AI-powered automation scripts
3. Integrate agent actions into your test suites
4. Combine with traditional Playwright actions for hybrid automation
