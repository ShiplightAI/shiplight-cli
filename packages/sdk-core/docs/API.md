# Shiplight Test Runtime - SDK API Design

## Overview

This document defines the public API surface of `@shiplightai/test`. It focuses on the interfaces exposed to users, not implementation details.

## Primary Use Cases

1. **Running tests via Playwright CLI** (most common)
2. **Running tests programmatically** (for int-runner and automation)
3. **Exporting tests for self-hosting** (for customers)

## Public API

### 1. Test Fixture API (for Playwright tests)

```typescript
import { test } from '@shiplightai/test';

// The test fixture provides these fixtures to test functions
test('My test', async ({ 
  page,           // Standard Playwright Page object
  context,        // Standard Playwright BrowserContext
  testContext,    // Shiplight test context
  $,              // Alias for testContext
  ctx             // Alias for testContext
}) => {
  // Test code here
});
```

#### TestContext Interface

```typescript
interface TestContext {
  // User data access (via proxy)
  [key: string]: any;  // User can set/get any values: $.myVar = 5
  
  // Methods available on context
  get(key: string): any;
  set(key: string, value: any): void;
  addSensitive(key: string, value: any): void;  // Add data that won't be sent to LLM
  
  // Serialization
  toJSON(): object;  // Get serializable data
}
```

#### Page Augmentation

When using `@shiplightai/test`, the Playwright Page object is augmented with additional methods:

```typescript
interface AugmentedPage extends Page {
  // AI-powered actions
  aiAssert(statement: string, stepId: string): Promise<void>;
  aiAction(statement: string, stepId: string): Promise<any>;
  aiStep(statement: string, stepId: string): Promise<{success: boolean, details?: string}>;
  
  // Step execution with self-healing
  step<T>(
    fn: () => Promise<T>, 
    description: string, 
    stepId: string,
    options?: { canSelfHeal?: boolean }
  ): Promise<T>;
  
  // Utilities
  waitUntilStable(timeoutMs?: number): Promise<void>;
  getFilePath(fileName: string): string;
  generate2faCode(secret: string): Promise<string>;
  getDOMText(): Promise<string>;
}
```

### 2. Configuration API

```typescript
// Config types users will work with
interface ShiplightConfig {
  organization: {
    id: string;
    apiToken: string;
    apiBaseUrl?: string;
  };
  webagent?: {
    url: string;
    timeout?: number;
  };
  defaults?: {
    timeouts?: {
      step?: number;
      test?: number;
    };
    output?: {
      screenshots?: boolean;
      video?: boolean;
      trace?: boolean;
    };
  };
}

interface TestConfig {
  environment: {
    id: number;
    url?: string;
    name?: string;
  };
  
  context?: Record<string, any>;
  
  login?: {
    method: 'none' | 'agent';
    config?: LoginConfig;  // Required when method is 'agent'
    // Agent login automatically handles storage state caching
  };
  
  settings?: {
    startingUrl?: string;
    timeout?: number;
  };
}
```

### 3. Programmatic Runtime API

```typescript
import { TestRuntime } from '@shiplightai/test';

class TestRuntime {
  // Constructors
  constructor(options?: RuntimeOptions);
  static fromFiles(orgConfigPath?: string, testConfigPath?: string): TestRuntime;
  static fromConfigs(orgConfig: ShiplightConfig, testConfig: TestConfig): TestRuntime;
  
  // Test execution
  async runTest(testPath: string, options?: RunOptions): Promise<TestResult>;
  async runCode(code: string, options?: RunOptions): Promise<TestResult>;
  
  // Context management (for int-runner use case)
  async createContext(overrides?: Partial<TestConfig>): Promise<RuntimeContext>;
  async executeInContext(
    context: RuntimeContext,
    page: Page,
    code: string
  ): Promise<any>;
  
  // Results
  getResults(context: RuntimeContext): TestResults;
}

// Supporting types
interface RuntimeOptions {
  orgConfigPath?: string;
  testConfigPath?: string;
  orgConfig?: ShiplightConfig;
  testConfig?: TestConfig;
}

interface RunOptions {
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  timeout?: number;
  env?: Record<string, string>;
}

interface RuntimeContext {
  id: string;  // Unique context ID
  getTestContext(): TestContext;
  getPage(): Page | null;
  destroy(): Promise<void>;
}

interface TestResult {
  success: boolean;
  duration: number;
  error?: Error;
  stepResults: StepResult[];
  artifacts: {
    video?: string;
    trace?: string;
    screenshots: string[];
  };
}

interface TestResults {
  stepResults: Record<string, StepResult>;
  consoleLogs: Array<{message: string, type: string}>;
  data: Record<string, any>;
}

interface StepResult {
  stepId: string;
  description: string;
  status: 'success' | 'failure' | 'skipped';
  duration: number;
  error?: string;
  screenshot?: string;
}
```

### 4. Export API

```typescript
import { TestExporter } from '@shiplightai/test/export';

class TestExporter {
  // Export a single test
  async exportTest(
    testPath: string,
    outputDir: string,
    options?: ExportOptions
  ): Promise<void>;
  
  // Export multiple tests as a suite
  async exportSuite(
    tests: TestExportSpec[],
    outputDir: string,
    options?: ExportOptions
  ): Promise<void>;
  
  // Validate exported test
  async validate(exportDir: string): Promise<ValidationResult>;
}

interface ExportOptions {
  includeData?: boolean;  // Include test data files
  includeVideos?: boolean;  // Include recorded videos
  sanitizeSecrets?: boolean;  // Remove sensitive data
  targetPlatform?: 'local' | 'docker' | 'cloud';
}

interface TestExportSpec {
  testPath: string;
  configPath?: string;
  dataFiles?: string[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
```

## Usage Examples

### Example 1: Simple Test File

```javascript
// test.spec.js
import { test } from '@shiplightai/test';

test('Login and verify dashboard', async ({ page, $ }) => {
  // Context variables are available via $
  await page.goto($.startingUrl || 'https://app.example.com');
  
  // AI-powered assertion
  await page.aiAssert('Login page is displayed', 'step-1');
  
  // Self-healing action
  await page.step(async () => {
    await page.fill('#username', $.username);
    await page.fill('#password', $.password);
    await page.click('button[type="submit"]');
  }, 'Fill login form and submit', 'step-2');
  
  // Wait for page to stabilize
  await page.waitUntilStable();
  
  // Verify dashboard
  await page.aiAssert('Dashboard is loaded with user profile', 'step-3');
});
```

### Example 2: Programmatic Execution

```typescript
// run-test.ts
import { TestRuntime } from '@shiplightai/test';

async function runTests() {
  // Create runtime from config files
  const runtime = TestRuntime.fromFiles(
    './shiplight.config.json',
    './test.config.json'
  );
  
  // Run a test file
  const result = await runtime.runTest('./tests/login.spec.js', {
    headless: false,
    timeout: 60000
  });
  
  console.log(`Test ${result.success ? 'passed' : 'failed'}`);
  console.log(`Duration: ${result.duration}ms`);
  
  if (!result.success) {
    console.error(result.error);
  }
}
```

### Example 3: Int-Runner Integration

```typescript
// int-runner integration
import { TestRuntime } from '@shiplightai/test';
import { chromium } from 'playwright';

class InteractiveRunner {
  private runtime: TestRuntime;
  private context: RuntimeContext;
  private browser: Browser;
  private page: Page;
  
  async initialize() {
    this.runtime = TestRuntime.fromFiles();
    this.browser = await chromium.launch({ headless: false });
    this.page = await this.browser.newPage();
    
    // Create runtime context with specific config
    this.context = await this.runtime.createContext({
      environment: { id: 1 },
      login: { method: 'dynamic', testAccountId: 123 }
    });
  }
  
  async executeStep(code: string) {
    // Execute code in the runtime context
    const result = await this.runtime.executeInContext(
      this.context,
      this.page,
      code
    );
    
    // Get current state
    const results = this.runtime.getResults(this.context);
    return { result, state: results };
  }
  
  async cleanup() {
    await this.context.destroy();
    await this.browser.close();
  }
}
```

### Example 4: Test Export

```typescript
// export-tests.ts
import { TestExporter } from '@shiplightai/test/export';

async function exportForCustomer() {
  const exporter = new TestExporter();
  
  // Export a single test with its dependencies
  await exporter.exportTest(
    './tests/checkout-flow.spec.js',
    './exported-tests',
    {
      includeData: true,
      sanitizeSecrets: true,
      targetPlatform: 'docker'
    }
  );
  
  // Validate the export
  const validation = await exporter.validate('./exported-tests');
  if (!validation.valid) {
    console.error('Export validation failed:', validation.errors);
  }
}

// Exported structure:
// exported-tests/
// ├── shiplight.config.json       # Organization config
// ├── tests/
// │   ├── checkout-flow.spec.js   # Test file
// │   ├── checkout-flow.config.json  # Test-specific config (paired)
// │   ├── login.spec.js
// │   └── login.config.json       # Each test has its own config
// ├── data/                       # Shared test data files (org-level)
// │   ├── products.csv
// │   └── users.json
// ├── package.json
// └── README.md
```

### Example 5: Using with Standard Playwright Config

```javascript
// playwright.config.js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Use the test fixture from @shiplightai/test
  testMatch: '**/*.spec.js',
  use: {
    // Standard Playwright options work normally
    headless: false,
    video: 'on',
    trace: 'on-first-retry',
  },
  // The runtime will automatically load configs from:
  // - ./shiplight.config.json
  // - ./test.config.json (or <test-name>.config.json)
});
```

## Key Design Principles

1. **Minimal API Surface**: Only expose what users need
2. **Playwright Compatible**: Works with standard Playwright CLI and config
3. **Progressive Disclosure**: Simple things are simple, complex things are possible
4. **Type Safe**: Full TypeScript support with proper types
5. **Backward Compatible**: Can read environment variables if config files don't exist

## Configuration Loading Rules

1. **Organization Config** (`shiplight.config.json`):
   - Search: current dir → parent dirs → `~/.shiplight/` → env var `SHIPLIGHT_CONFIG_PATH`
   - Cached after first load
   - Shared across all tests in a project

2. **Test Config** (per-test pairing):
   - Primary: `<test-basename>.config.json` in same directory as test file
   - Example: `checkout-flow.spec.js` looks for `checkout-flow.config.json`
   - Example: `login.test.js` looks for `login.config.json`
   - The config must use the same base name as the test file
   - No fallback to generic `test.config.json` to avoid conflicts
   - Can be overridden programmatically
   - Each test must have its own config with matching name

3. **Environment Variable Fallback**:
   - All configs can fall back to env vars for backward compatibility
   - Existing env vars are mapped to config structure

## Error Handling

All API methods that can fail will:
1. Throw typed errors with clear messages
2. Include context about what failed
3. Provide actionable error messages

```typescript
// Error types
class ConfigurationError extends Error {
  constructor(message: string, public configPath?: string);
}

class TestExecutionError extends Error {
  constructor(message: string, public stepId?: string, public cause?: Error);
}

class ExportError extends Error {
  constructor(message: string, public file?: string);
}
```

## Questions for Discussion

1. **Async Config Loading**: Should config loading be async to support remote configs (S3, etc.)?
2. **Plugin System**: Should we expose a plugin API for extending functionality?
3. **Event Emitters**: Should the runtime emit events for test lifecycle hooks?
4. **Streaming Results**: Should we support streaming results for long-running tests?
5. **Config Validation**: Should we provide a CLI tool to validate configs?