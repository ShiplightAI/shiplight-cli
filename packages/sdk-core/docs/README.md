# @shiplightai/test

Standalone runtime package for executing Playwright tests with AI capabilities. This package enables tests to run independently without requiring the full Shiplight infrastructure.

## Features

- 🎭 Built on Playwright Test framework
- 🤖 AI-powered test actions and assertions
- 🔧 Self-healing test execution
- 🔐 Agent-based authentication
- 📝 Two-part configuration system
- 🎯 Dynamic context variables with `$.variable` syntax
- 📦 Zero dependency on Shiplight monorepo

## Installation

```bash
npm install @shiplightai/test
```

## Quick Start

### 1. Create organization configuration

Create `shiplight.config.json` in your project root:

```json
{
  "organization": {
    "apiToken": "your-api-token",
    "apiBaseUrl": "https://api.shiplight.ai"
  },
  "webagent": {
    "url": "http://localhost:8000"
  }
}
```

### 2. Create test configuration

For each test file `example.test.ts`, create `example.config.json`:

```json
{
  "environment": {
    "id": 1,
    "url": "https://example.com"
  },
  "startUrl": "https://example.com/login",
  "context": {
    "productName": "Example Product",
    "maxPrice": 100
  },
  "login": {
    "type": "agent",
    "config": {
      "agentTaskId": "login-task-id"
    }
  }
}
```

### 3. Write your test

```typescript
import { test, expect } from '@shiplightai/test';

test('Example test with AI capabilities', async ({ page, ctx, agent }) => {
  // Navigate to start URL (configured in test config)
  await page.goto(ctx.get('startUrl'));

  // Use context variables with $ syntax
  await page.fill('#search', ctx.get('productName'));

  // AI-powered assertions using agent (page is first parameter)
  await agent.assert(page, 'The search results show products', 'step-1');

  // AI-powered actions with agent
  await agent.run(page, 'Click on the first product', 'step-2');

  // Use AI to verify complex conditions
  const priceOk = await agent.evaluate(
    page,
    `The product price is less than $maxPrice`,
    'step-3'
  );
  expect(priceOk).toBe(true);
});

// Multi-page/tab example
test('Example with multiple tabs', async ({ page, context, agent }) => {
  // Use the root page
  await page.goto('https://example.com');
  await agent.assert(page, 'Page loaded', 'step-1');

  // Create a new page/tab
  const page2 = await context.newPage();
  await page2.goto('https://example.com/settings');
  await agent.run(page2, 'Click save button', 'step-2');

  // Switch back to first page
  await agent.assert(page, 'Still on homepage', 'step-3');
});
```

### 4. Run tests

```bash
npx playwright test
```

## Configuration

### Organization Configuration (`shiplight.config.json`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `organization.apiToken` | string | Yes | API authentication token (identifies the org). **Retiring October 31, 2026** — see the note under Environment Variables |
| `organization.apiBaseUrl` | string | No | API endpoint (default: https://api.shiplight.ai) |
| `webagent.url` | string | No | WebAgent service URL for AI features |
| `webagent.timeout` | number | No | Request timeout in ms (default: 30000) |

### Test Configuration (`<test-name>.config.json`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `environment.id` | number | Yes | Environment ID |
| `environment.url` | string | No | Base URL for the environment |
| `startUrl` | string | No | Initial URL to navigate to |
| `context` | object | No | Variables available in test as `$.variable` |
| `login.type` | string | No | Login method: 'none' or 'agent' |
| `login.config` | object | No | Login configuration when type is 'agent' |

## API Reference

### Test Fixtures

#### `ctx` (or `$`)
The test context object containing configuration and runtime data. Both `ctx` and `$` refer to the same object.

```typescript
test('Example', async ({ ctx }) => {
  // Get context variable
  const value = ctx.get('myVariable');

  // Add context variable
  ctx.add('newVariable', 'value');

  // Add sensitive data (not sent to AI)
  ctx.addSensitive('password', 'secret');
});

// Or use $ for shorter syntax
test('Example with $', async ({ $ }) => {
  const value = $.get('myVariable');
  $.add('newVariable', 'value');
});
```

#### `context`
Playwright BrowserContext for managing browser sessions, cookies, and creating multiple pages.

```typescript
test('Example', async ({ context }) => {
  // Create additional pages/tabs
  const page2 = await context.newPage();
  const page3 = await context.newPage();

  // Access cookies, storage, etc.
  await context.addCookies([{ name: 'token', value: 'abc123', domain: 'example.com', path: '/' }]);
});
```

#### `page`
Root/main page - the first page created for your test. This is a standard Playwright Page object.

```typescript
test('Example', async ({ page }) => {
  await page.goto('https://example.com');
  await page.click('#button');
});
```

#### `agent`
AI-powered agent for intelligent test actions, assertions, and utilities. The agent is tied to the test context and supports multiple pages/tabs. All methods take `page` as the first parameter.

### AI Methods (Agent)

#### `agent.assert(page, statement, stepId)`
Make an AI-powered assertion.

```typescript
await agent.assert(page, 'The login form is visible', 'step-1');
```

#### `agent.run(page, instruction, stepId)`
Perform an AI-powered action.

```typescript
await agent.run(page, 'Click the submit button', 'step-2');
```

#### `agent.evaluate(page, condition, stepId)`
Evaluate a condition using AI.

```typescript
const isValid = await agent.evaluate(page, 'The form has no errors', 'step-3');
```

#### `agent.step(page, instruction, stepId)`
Execute a complex multi-step AI action.

```typescript
const result = await agent.step(page, 'Navigate to settings and enable notifications', 'step-4');
console.log(result.success, result.details);
```

### Utility Methods (Agent)

#### `agent.getFilePath(fileName)`
Get absolute path to a file in the test's files directory.

```typescript
const csvPath = agent.getFilePath('test-data.csv');
```

#### `agent.generate2faCode(secretKey)`
Generate a 2FA/TOTP code from a secret key.

```typescript
const code = await agent.generate2faCode('JBSWY3DPEHPK3PXP');
```

#### `agent.getDOMText(page)`
Get the text content of the page.

```typescript
const pageText = await agent.getDOMText(page);
```

#### `agent.waitUntilStable(page, timeoutMs?)`
Wait for the page to stabilize (network idle).

```typescript
await agent.waitUntilStable(page, 5000);
```

## Environment Variables

For backward compatibility, the package also supports environment variables:

- `ORGANIZATION_ID` - Organization identifier
- `SHIPLIGHT_API_TOKEN` - API token (**retiring October 31, 2026**)
- `API_BASE_URL` - API endpoint
- `WEBAGENT_URL` - WebAgent service URL
- `PLAYWRIGHT_STARTING_URL` - Starting URL
- `PLAYWRIGHT_TEST_USERNAME` - Test account username
- `PLAYWRIGHT_TEST_PASSWORD` - Test account password

> **Shiplight Cloud shuts down on October 31, 2026.** `SHIPLIGHT_API_TOKEN`,
> `organization.apiToken`, and the `https://api.shiplight.ai` endpoint stop
> working then. Configure a provider API key directly instead.


## Advanced Usage

### Programmatic SDK Usage

```typescript
import { createTestContext, createAgent, ConfigLoader } from '@shiplightai/test';
import { chromium } from '@playwright/test';

async function runTest() {
  // Load configurations
  const configs = await ConfigLoader.load('path/to/test.ts');

  // Create test context
  const ctx = createTestContext(configs);

  // Create browser and page
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Create agent with context only (CDP URL determined per-page when needed)
  const agent = createAgent(ctx);

  // Run test logic using agent (pass page as first parameter)
  await page.goto('https://example.com');
  await agent.assert(page, 'Page loaded successfully', 'step-1');

  // Use agent utilities
  const code = await agent.generate2faCode('SECRET_KEY');
  await agent.waitUntilStable(page);

  // Agent supports multiple pages
  const page2 = await browser.newPage();
  await agent.run(page2, 'Navigate to settings', 'step-2');

  await browser.close();
}
```

### Context Variable Usage

Access context variables defined in your test configuration:

```typescript
test('Product search', async ({ page, ctx, agent }) => {
  // Context variables from test config
  const productName = ctx.get('productName');
  const maxPrice = ctx.get('maxPrice');

  await page.goto(ctx.get('startUrl'));
  await page.fill('#search', productName);

  // AI can reference context variables with $ syntax
  await agent.assert(page, 'The product price is less than $maxPrice', 'step-1');
});
```

## Requirements

- Node.js >= 18.0.0
- Playwright >= 1.40.0
- WebAgent service (for AI features)

## License

MIT

## Support

For issues and questions, please visit [GitHub Issues](https://github.com/shiplight/test-runtime/issues)