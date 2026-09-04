# @shiplightai/sdk

A companion SDK for Playwright that makes your tests resilient to UI changes like dynamic IDs, layout rearrangements, and styling updates.

## Installation

```bash
npm install @shiplightai/sdk playwright
```

## Quick Start

```typescript
import { chromium } from 'playwright';
import { createAgent, configureSdk } from '@shiplightai/sdk';

// Configure SDK with API key (call once at startup)
configureSdk({
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
});

// Create an agent
const agent = createAgent({
  model: 'claude-haiku-4-5',
});

// Use with Playwright
const browser = await chromium.launch();
const page = await browser.newPage();

// Login using the Sauce Labs demo site (public test site)
await agent.login(page, {
  url: 'https://www.saucedemo.com/',
  username: 'standard_user',
  password: 'secret_sauce',
});

// Verify login succeeded
await agent.assert(page, 'Products page is visible');

// Extract data from the page
await agent.extract(page, 'the first product name', 'productName');
console.log('First product:', agent.getVariable('productName'));

await browser.close();
```

## Custom Actions

Extend the agent with custom actions for your specific use case:

```typescript
import { createAgent, z } from '@shiplightai/sdk';

const agent = createAgent({ model: 'claude-haiku-4-5' });

// Register a custom action
agent.registerAction({
  name: 'extract_email_code',
  description: 'Extract verification code from email inbox',
  schema: z.object({
    email_address: z.string().describe('The email address to check'),
    code_type: z.enum(['verification', 'reset']).describe('Type of code'),
  }),
  async execute(args, ctx) {
    // Your custom logic here
    const code = await myEmailService.getCode(args.email_address, args.code_type);

    // Store the result for later use
    ctx.variableStore.set('verification_code', code);

    return { success: true, message: `Found code: ${code}` };
  },
});

// The agent will automatically use your action when needed
await agent.act(page, 'Get the verification code from email');
await agent.act(page, 'Enter {{ verification_code }} in the input field');
```

## API Reference

### `createAgent(options)`

Create a new agent instance.

```typescript
const agent = createAgent({
  // Required: LLM model to use
  model: 'claude-haiku-4-5',

  // Optional: Initial variables
  variables: { username: 'test@example.com' },

  // Optional: Keys to mark as sensitive (masked in logs)
  sensitiveKeys: ['password', 'apiKey'],

  // Optional: Directory for test data files
  testDataDir: './test-data',

  // Optional: Directory for downloads
  downloadDir: './downloads',
});
```

### Supported Models

The SDK supports any model from the following providers. Pass the model name directly or use `provider:model` syntax for explicit routing.

| Provider | Model pattern | Example models | API key |
|----------|--------------|----------------|---------|
| Google | `gemini-*` | `gemini-2.5-pro`, `gemini-2.5-flash` | `GOOGLE_API_KEY` |
| Anthropic | `claude-*` | `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-6` | `ANTHROPIC_API_KEY` |
| OpenAI | `gpt-*`, `o1*`, `o3*`, `o4*`, `chatgpt-*` | `gpt-4o`, `o4-mini` | `OPENAI_API_KEY` |

**Explicit provider routing** — use `provider:model` to bypass auto-detection:

```typescript
// Route through specific provider
const agent = createAgent({ model: 'openai:gpt-4o' });
const agent = createAgent({ model: 'anthropic:claude-sonnet-4-6' });

// Useful for fine-tuned models or cloud-hosted variants
const agent = createAgent({ model: 'openai:ft:gpt-4o:my-org' });
```

### `agent.registerAction(action)`

Register a custom action.

```typescript
agent.registerAction({
  // Unique action name (snake_case recommended)
  name: 'my_action',

  // Description for the agent
  description: 'What this action does and when to use it',

  // Zod schema for parameters
  schema: z.object({
    param1: z.string().describe('Description of the parameter'),
    param2: z.number().optional(),
  }),

  // Execute function
  async execute(args, ctx) {
    // args: validated parameters
    // ctx.page: Playwright page
    // ctx.variableStore: access to variables

    return { success: true, message: 'Optional status message' };
  },
});
```

### `agent.act(page, instruction)`

Perform a single action on the page.

```typescript
await agent.act(page, 'Click the login button');
await agent.act(page, 'Fill the email field with test@example.com');
await agent.act(page, 'Select "Express" from shipping dropdown');
```

### `agent.run(page, instruction, options?)`

Run a multi-step instruction until the goal is achieved.

```typescript
await agent.run(page, 'Complete the checkout process');
await agent.run(page, 'Fill out the entire registration form');
await agent.run(page, 'Add 3 items to cart', { maxSteps: 10 });
```

### `agent.assert(page, statement)`

Assert a condition (throws on failure).

```typescript
await agent.assert(page, 'Login button is visible');
await agent.assert(page, 'Cart contains 3 items');
```

### `agent.evaluate(page, statement)`

Evaluate a condition (returns boolean, doesn't throw).

```typescript
const isLoggedIn = await agent.evaluate(page, 'User is logged in');
if (!isLoggedIn) {
  await agent.run(page, 'Click the login button');
}
```

### `agent.extract(page, description, variableName)`

Extract data from the page and store in a variable.

```typescript
await agent.extract(page, 'the order total', 'orderTotal');
await agent.run(page, 'Verify {{ orderTotal }} is displayed on receipt');
```

### `agent.step(page, action, description, options?)`

Wrap Playwright code with self-healing. If `action` throws, the agent analyzes the page and attempts to accomplish the goal described in `description`.

```typescript
// Single action with self-healing
await agent.step(
  page,
  async () => await page.click('#submit-btn'),
  'Click the submit button'
);

// Code block with multiple actions
await agent.step(
  page,
  async () => {
    await page.fill('#email', 'user@example.com');
    await page.fill('#password', 'secret');
    await page.click('#login');
  },
  'Fill login form and submit'
);

// Control recovery depth with maxSteps (default: 5)
await agent.step(
  page,
  async () => await page.click('.dynamic-button'),
  'Click the dynamic button that appears after loading',
  { maxSteps: 3 }
);
```

### `agent.setVariable(name, value, sensitive?)`

Set a variable. Variables can be referenced in instructions using `$variableName`.

```typescript
agent.setVariable('couponCode', 'SAVE20');
await agent.act(page, 'Enter $couponCode in the promo field');

// Sensitive values are masked in logs
agent.setVariable('apiKey', 'secret123', true);
```

### `agent.getVariable(name)`

Get a variable value.

```typescript
await agent.extract(page, 'the order total', 'orderTotal');
console.log('Order total:', agent.getVariable('orderTotal'));
```

### `agent.waitUntil(page, condition, timeoutSeconds?)`

Wait until a condition becomes true.

```typescript
await agent.waitUntil(page, 'Loading spinner is no longer visible');

const appeared = await agent.waitUntil(page, 'Table shows at least 5 rows', 30);
if (!appeared) {
  throw new Error('Data did not load in time');
}
```

## Custom Action Context

The `execute` function receives a context object:

```typescript
interface IActionExecutionContext {
  // Playwright page instance
  page: Page;

  // Variable store for reading/writing variables
  variableStore: VariableStore;
}
```

### Using Variables

```typescript
async execute(args, ctx) {
  // Read a variable
  const email = ctx.variableStore.get('email');

  // Set a variable
  ctx.variableStore.set('result', 'some value');

  // Set a sensitive variable (masked in logs)
  ctx.variableStore.set('token', secretToken, true);

  return { success: true };
}
```

## SDK Configuration

Configure SDK-wide settings before creating agents:

```typescript
import { configureSdk, getSdkConfig, LogLevel } from '@shiplightai/sdk';

configureSdk({
  // Log level: DEBUG, INFO, WARN, ERROR
  logLevel: LogLevel.INFO,

  // Enable detailed agent logging
  debugAgent: false,

  // Environment variables (API keys — provide the key for your chosen model's provider)
  env: {
    GOOGLE_API_KEY: 'your-google-api-key',       // for gemini-* models
    // ANTHROPIC_API_KEY: 'your-anthropic-key',   // for claude-* models
    // OPENAI_API_KEY: 'sk-...',                  // for gpt-*, o1*, o3*, o4* models
  },

  // Optional: paths for logs and results
  agentLogPath: './logs/agent.log',
  testResultsJsonPath: './results.json',
});

// Read current config
const config = getSdkConfig();
```

## API Keys

API keys must be passed via `configureSdk({ env })` — the SDK does not read `process.env` directly.

| Key | Required | Description |
|-----|----------|-------------|
| `GOOGLE_API_KEY` | Yes* | Google AI API key for `gemini-*` models |
| `ANTHROPIC_API_KEY` | Yes* | Anthropic API key for `claude-*` models |
| `OPENAI_API_KEY` | Yes* | OpenAI API key for `gpt-*`, `o1*`, `o3*`, `o4*` models |

*Provide the key for the provider matching your chosen model.

## License

MIT
