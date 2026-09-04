# Shiplight Test Runtime - Design Document

## Overview

The `@shiplightai/test` package provides a standalone runtime for executing Shiplight tests. It enables tests to run via standard Playwright CLI, as a subprocess, or programmatically through an SDK. This design prioritizes simplicity, portability, and compatibility with existing infrastructure.

## Goals

1. **Standalone Execution**: Run tests without the full monorepo infrastructure
2. **Configuration-Based**: Replace environment variables with structured JSON configs
3. **SDK Support**: Provide programmatic API for int-runner integration
4. **Export Capability**: Enable customers to run tests in their own infrastructure
5. **Backward Compatibility**: Support existing test files with minimal changes

## Non-Goals

1. **Custom CLI Wrapper**: We will use standard Playwright CLI instead
2. **Complex Command Line**: Configuration via files, not CLI arguments
3. **Breaking Changes**: Existing tests must continue to work

## Architecture

### Package Structure

```
packages/test-runtime/
├── src/
│   ├── index.ts                 # Main exports
│   ├── config/
│   │   ├── loader.ts            # Config file loading logic
│   │   ├── schema.ts            # TypeScript interfaces and validation
│   │   └── resolver.ts          # Config resolution and merging
│   ├── context/
│   │   ├── testContext.ts       # Playwright test fixture
│   │   ├── factory.ts           # Context creation logic
│   │   └── augmentation.ts      # Context augmentation (AI, login, etc.)
│   ├── runtime/
│   │   ├── executor.ts          # Core execution engine
│   │   ├── sdk.ts              # SDK API for programmatic use
│   │   └── environment.ts      # Environment setup
│   ├── actions/
│   │   ├── ai.ts               # AI-powered actions
│   │   ├── standard.ts         # Standard Playwright actions
│   │   └── helpers.ts          # Helper functions
│   ├── login/
│   │   ├── strategies.ts       # Login strategy implementations
│   │   └── manager.ts          # Login orchestration
│   ├── utils/
│   │   ├── variables.ts        # Variable replacement
│   │   └── results.ts          # Result collection and reporting
│   └── playwright.config.ts    # Base Playwright configuration
├── dist/                        # Compiled output
├── package.json
├── tsconfig.json
├── DESIGN.md                    # This document
└── README.md                    # Usage documentation
```

## Configuration System

### Two-Part Configuration Design

The configuration is split into two parts to optimize for different use cases:

#### 1. Organization Configuration (`shiplight.config.json`)

**Purpose**: Settings that remain constant across all tests for an organization/user.

```typescript
interface OrgConfig {
  // Organization configuration
  organization: {
    id: string;                    // Organization identifier
    apiToken: string;              // API authentication token
    apiBaseUrl?: string;           // API endpoint (default: https://api.shiplight.ai)
  };
  
  // WebAgent configuration (optional - companion service)
  webagent?: {
    url: string;                   // WebAgent service URL
    timeout?: number;              // Request timeout in ms
    maxRetries?: number;           // Retry attempts for failed requests
  };
  
  // Default settings (can be overridden per test)
  defaults?: {
    timeouts?: {
      step?: number;               // Default step timeout in ms
      test?: number;               // Default test timeout in ms
      navigation?: number;         // Page navigation timeout
    };
    output?: {
      screenshots?: boolean;       // Capture screenshots
      video?: boolean;            // Record video
      trace?: boolean;            // Enable Playwright trace
      resultsDir?: string;        // Output directory
    };
    browser?: {
      headless?: boolean;         // Run in headless mode
      slowMo?: number;           // Slow down operations by ms
      devtools?: boolean;        // Open devtools
    };
  };
  
  // Feature flags
  features?: {
    aiActions?: boolean;          // Enable AI-powered actions
    selfHealing?: boolean;        // Enable self-healing tests
    parallelExecution?: boolean;  // Allow parallel test execution
  };
}
```

**Location Search Order**:
1. Current directory: `./shiplight.config.json`
2. Parent directories (recursively up to root)
3. Home directory: `~/.shiplight/config.json`
4. Environment variable: `SHIPLIGHT_CONFIG_PATH`
5. Fallback to environment variables for backward compatibility

#### 2. Test Configuration (`test.config.json`)

**Purpose**: Test-specific settings that change between tests or test runs.

**Example Configuration**:
```json
{
  "environment": {
    "id": 1,
    "url": "https://app.example.com"
  },
  "login": {
    "method": "agent",
    "config": {
      "site_url": "https://app.example.com/login",
      "account": {
        "type": "password",
        "username": "testuser@example.com",
        "password": "SecurePass123",
        "two_factor_auth_config": {
          "type": "totp",
          "data": "JBSWY3DPEHPK3PXP"
        }
      },
      "additional_prompt": "Click 'Enterprise Login' first",
      "skip_verification": false
    }
  },
  "context": {
    "customerName": "ACME Corp",
    "testDataFile": "test-data.csv"
  },
  "settings": {
    "startingUrl": "https://app.example.com/dashboard",
    "timeout": 300000
  }
}
```

```typescript
interface TestConfig {
  // Target environment
  environment: {
    id: number;                    // Environment ID in Shiplight system
    url?: string;                  // Base URL for the environment
    name?: string;                 // Human-readable name
  };
  
  // Test context variables
  context?: Record<string, any>;   // Variables available in test as $.*
  
  // Login configuration (simplified: none or agent)
  login?: {
    method: 'none' | 'agent';
    
    // When method is 'agent', provide LoginConfig
    config?: {
      site_url?: string;           // Override environment URL for login
      account: {                   // Account details (compatible with the internal LoginConfig)
        type: 'password' | 'oauth2' | 'sso' | 'api';
        username: string;
        password: string;
        two_factor_auth_config?: {
          type: 'sms' | 'email' | 'totp';
          data: string;            // Secret key for TOTP, phone for SMS, etc.
        };
        provider_name?: string;    // For OAuth2
        // Agent automatically handles storage state and action caching
      };
      additional_prompt?: string;  // Additional signin instructions
      verification_hint?: string;  // Hint for verification code generation
      skip_verification?: boolean; // Skip login verification
      num_verification_exprs?: number; // Number of validation expressions
    };
  };
  
  // Test-specific settings
  settings?: {
    startingUrl?: string;          // Override environment URL
    timeout?: number;              // Override default timeout
    retryCount?: number;           // Number of retries on failure
    skipTeardown?: boolean;        // Skip teardown steps
  };
  
  // Test data references
  testData?: {
    files?: string[];              // Paths to data files
    inline?: Record<string, any>;  // Inline data
  };
}
```

**Location Resolution**:
1. Specified path via SDK/parameter
2. Same directory as test file: `<test-name>.config.json`
3. Current directory: `test.config.json`
4. Environment variables for backward compatibility

### Configuration Loading and Resolution

```typescript
// src/config/loader.ts
export class ConfigLoader {
  private static orgConfigCache: OrgConfig | null = null;
  
  static async loadOrgConfig(path?: string): Promise<OrgConfig> {
    // Check cache first
    if (this.orgConfigCache && !path) {
      return this.orgConfigCache;
    }
    
    // Load from file or environment
    const config = await this.findAndLoadConfig('shiplight.config.json', path);
    
    // Validate against schema
    this.validateOrgConfig(config);
    
    // Cache for future use
    this.orgConfigCache = config;
    return config;
  }
  
  static async loadTestConfig(testPath: string, configPath?: string): Promise<TestConfig> {
    // Try multiple locations
    const config = await this.findAndLoadTestConfig(testPath, configPath);
    
    // Merge with environment variables for compatibility
    return this.mergeWithEnvironment(config);
  }
  
  private static async mergeWithEnvironment(config: TestConfig): Promise<TestConfig> {
    // Backward compatibility: merge environment variables
    if (process.env.PLAYWRIGHT_STARTING_URL && !config.settings?.startingUrl) {
      config.settings = { ...config.settings, startingUrl: process.env.PLAYWRIGHT_STARTING_URL };
    }
    // ... more environment variable mappings
    return config;
  }
}
```

## Test Context System

### Context Creation and Lifecycle

The test context is the central object that maintains state throughout test execution.

```typescript
// src/context/factory.ts
export interface TestContext {
  // User-accessible properties (via proxy)
  [key: string]: any;
  
  // Internal properties
  _internal: {
    // Core properties
    organizationId: string;
    apiClient: ApiClient;
    configs: {
      org: OrgConfig;
      test: TestConfig;
    };
    
    // Runtime state
    stepResults: Record<string, StepResult>;
    consoleLogs: ConsoleLog[];
    executionHistory: Array<[string, string]>;
    currentPage: Page | null;
    
    // Augmented methods
    aiAssert: (page: Page, statement: string, stepId: string) => Promise<void>;
    aiAction: (page: Page, statement: string, stepId: string) => Promise<any>;
    aiStep: (page: Page, statement: string, stepId: string) => Promise<any>;
    step: (page: Page, fn: Function, description: string, stepId: string) => Promise<any>;
    
    // Utilities
    getFilePath: (fileName: string) => string;
    replaceSensitiveData: (text: string) => string;
  };
  
  // Sensitive data (not sent to LLM)
  _sensitive: Record<string, any>;
  
  // Methods
  get(key: string): any;
  add(key: string, value: any): void;
  addSensitive(key: string, value: any): void;
  serializableData(): Record<string, any>;
  llmSensitiveData(): Record<string, any>;
}

export function createTestContext(configs: {
  org: OrgConfig,
  test: TestConfig
}): TestContext {
  const context = new TestContextImpl();
  
  // Initialize from configs
  context._internal.organizationId = configs.org.organization.id;
  context._internal.configs = configs;
  
  // Set up API client
  context._internal.apiClient = new ApiClient(
    configs.org.organization.apiToken,
    configs.org.organization.apiBaseUrl
  );
  
  // Merge test context variables
  if (configs.test.context) {
    Object.entries(configs.test.context).forEach(([key, value]) => {
      context.add(key, value);
    });
  }
  
  // Add login account credentials if provided
  if (configs.test.login?.config?.account) {
    const account = configs.test.login.config.account;
    context.addSensitive('username', account.username);
    context.addSensitive('password', account.password);
    if (account.two_factor_auth_config?.type === 'totp') {
      context.addSensitive('totpSecret', account.two_factor_auth_config.data);
    }
  }
  
  return context;
}
```

### Context Augmentation

The context is augmented with various capabilities:

```typescript
// src/context/augmentation.ts
export function augmentTestContext(context: TestContext): void {
  const configs = context._internal.configs;
  
  // Add AI capabilities if enabled
  if (configs.org.features?.aiActions) {
    augmentWithAI(context);
  }
  
  // Add login capabilities
  augmentWithLogin(context);
  
  // Add result tracking
  augmentWithResultTracking(context);
  
  // Add helper methods
  augmentWithHelpers(context);
}

function augmentWithAI(context: TestContext): void {
  context._internal.aiAssert = async (page, statement, stepId) => {
    // Implementation using webagent
    const result = await callWebAgent('assert', {
      page,
      statement,
      context: context.serializableData(),
      organizationId: context._internal.organizationId
    });
    // ... handle result
  };
  
  // ... other AI methods
}
```

## Playwright Test Fixture

### Custom Test Fixture Implementation

```typescript
// src/context/testContext.ts
import { test as base } from '@playwright/test';
import { ConfigLoader } from '../config/loader';
import { createTestContext, augmentTestContext } from './factory';
import { LoginManager } from '../login/manager';

export const test = base.extend<{
  testContext: TestContext;
  ctx: TestContext;  // Alias
  $: TestContext;    // Alias
}>({
  testContext: async ({ page }, use, testInfo) => {
    // Load configurations
    const orgConfig = await ConfigLoader.loadOrgConfig();
    const testConfig = await ConfigLoader.loadTestConfig(testInfo.file);
    
    // Create and augment context
    const context = createTestContext({ org: orgConfig, test: testConfig });
    augmentTestContext(context);
    
    // Handle login if configured
    if (testConfig.login?.method !== 'none') {
      const loginManager = new LoginManager(context);
      await loginManager.performLogin(page);
    }
    
    // Set up page augmentation
    augmentPage(page, context);
    
    // Use context in test
    await use(context);
    
    // Cleanup and save results
    await saveResults(context);
  },
  
  ctx: async ({ testContext }, use) => {
    await use(testContext);
  },
  
  $: async ({ testContext }, use) => {
    await use(testContext);
  }
});
```

## SDK API for Programmatic Use

### SDK Design for Int-Runner Integration

```typescript
// src/runtime/sdk.ts
export class TestRuntime {
  private orgConfig: OrgConfig;
  private testConfig: TestConfig;
  private context: TestContext | null = null;
  
  constructor(options?: {
    orgConfigPath?: string;
    testConfigPath?: string;
    orgConfig?: OrgConfig;
    testConfig?: TestConfig;
  }) {
    // Initialize with provided configs or load from files
  }
  
  /**
   * Create a test context for execution
   */
  async createContext(overrides?: Partial<TestConfig>): Promise<TestContext> {
    const mergedTestConfig = { ...this.testConfig, ...overrides };
    this.context = createTestContext({
      org: this.orgConfig,
      test: mergedTestConfig
    });
    augmentTestContext(this.context);
    return this.context;
  }
  
  /**
   * Execute code in the test context
   */
  async execute(page: Page, code: string): Promise<any> {
    if (!this.context) {
      throw new Error('Context not initialized. Call createContext() first.');
    }
    
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const fn = new AsyncFunction('page', 'testContext', '$', 'expect', code);
    return await fn(page, this.context, this.context, expect);
  }
  
  /**
   * Execute a test file
   */
  async runTest(testPath: string, options?: RunOptions): Promise<TestResult> {
    // Implementation for running a complete test file
  }
  
  /**
   * Get current execution results
   */
  getResults(): TestResults {
    if (!this.context) {
      throw new Error('No context available');
    }
    return {
      stepResults: this.context._internal.stepResults,
      consoleLogs: this.context._internal.consoleLogs,
      data: this.context.serializableData()
    };
  }
}

// Usage in int-runner
const runtime = new TestRuntime({
  orgConfigPath: './shiplight.config.json'
});

const context = await runtime.createContext({
  environment: { id: 1 },
  login: {
    method: 'agent',
    config: {
      site_url: 'https://app.example.com',
      account: {
        type: 'password',
        username: 'test@example.com',
        password: 'password123'
      }
    }
  }
});

await runtime.execute(page, `
  await page.goto('https://example.com');
  await page.aiAssert('Page loaded successfully', 'step-1');
`);

const results = runtime.getResults();
```

## Login System

### Simplified Login System

```typescript
// src/login/manager.ts
export interface LoginManager {
  performLogin(page: Page, context: TestContext): Promise<void>;
}

export class AgentLoginManager implements LoginManager {
  async performLogin(page: Page, context: TestContext): Promise<void> {
    const loginConfig = context._internal.configs.test.login?.config;
    if (!loginConfig) {
      throw new Error('Login config required for agent login');
    }
    
    // Agent login automatically:
    // 1. Checks for cached storage state and uses it if valid
    // 2. Performs login if no valid cache exists
    // 3. Caches the storage state for future runs
    // 4. Handles 2FA, OAuth, SSO transparently
    const result = await agentLogin(page, loginConfig);
    
    if (!result.success) {
      throw new Error(`Login failed: ${result.error}`);
    }
  }
}
```

## Export System

### Test Export for Customer Self-Hosting

```typescript
// src/export/exporter.ts
export class TestExporter {
  async export(testPath: string, outputDir: string): Promise<void> {
    // 1. Copy test file
    await this.copyTestFile(testPath, outputDir);
    
    // 2. Generate sanitized configs
    await this.generateConfigs(outputDir);
    
    // 3. Copy test data
    await this.copyTestData(outputDir);
    
    // 4. Create package.json
    await this.createPackageJson(outputDir);
    
    // 5. Generate README
    await this.generateReadme(outputDir);
  }
  
  private async generateConfigs(outputDir: string): Promise<void> {
    // Create sanitized org config (remove sensitive data)
    const orgConfig = {
      organization: {
        id: 'customer-org',
        apiToken: 'TO_BE_PROVIDED',
        apiBaseUrl: 'https://api.customer.com'  // Customer's API
      },
      defaults: { /* ... */ }
    };
    
    await fs.writeFile(
      path.join(outputDir, 'shiplight.config.json'),
      JSON.stringify(orgConfig, null, 2)
    );
  }
  
  private async createPackageJson(outputDir: string): Promise<void> {
    const packageJson = {
      name: 'exported-test',
      version: '1.0.0',
      dependencies: {
        '@shiplightai/test': '^1.0.0',
        '@playwright/test': '^1.40.0'
      },
      scripts: {
        'test': 'playwright test',
        'test:headed': 'playwright test --headed'
      }
    };
    
    await fs.writeFile(
      path.join(outputDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
  }
}
```

### Exported Test Structure

```
exported-test/
├── package.json              # Dependencies
├── playwright.config.js      # Playwright configuration
├── shiplight.config.json    # Sanitized org config
├── tests/
│   ├── checkout-flow.spec.js      # Test file
│   ├── checkout-flow.config.json  # Test-specific config (paired with test)
│   ├── login.spec.js              # Another test
│   └── login.config.json         # Its paired config
├── data/                    # Shared test data files
│   ├── users.csv
│   └── products.json
└── README.md               # Instructions
```

## Migration Strategy

### Phase 1: Core Package Development
- Create package structure with no dependencies on the internal shared package
- Copy and adapt necessary code from existing packages
- Implement config loading system
- Build test context factory
- Create Playwright test fixture
- Ensure backward compatibility with env vars

### Phase 2: Export Capability (Early Validation)
- Implement export system to generate standalone test packages
- Export existing tests from production as validation suite
- Test exported packages in clean environment (no monorepo dependencies)
- Validate that exported tests run successfully with only `@shiplightai/test`
- This provides real-world test cases to validate the core package

### Phase 3: Integration with Test-Runner
- Update test-runner to use `@shiplightai/test`
- Convert env var usage to config files
- Validate with the same test suite used in Phase 2
- Performance testing

### Phase 4: SDK Implementation
- Build SDK API for programmatic use
- Integrate with int-runner
- Remove duplicate code
- Create SDK documentation

### Phase 5: Cleanup
- Mark deprecated code in the internal shared package
- Remove obsolete implementations from test-runner and int-runner
- Update all imports
- Clean up dependencies

## Backward Compatibility

### Environment Variable Mapping

For backward compatibility, the runtime will map environment variables to configuration:

```typescript
const ENV_TO_CONFIG_MAP = {
  'PLAYWRIGHT_STARTING_URL': 'test.settings.startingUrl',
  'PLAYWRIGHT_TEST_CONTEXT': 'test.context',
  'ORGANIZATION_ID': 'org.organization.id',
  'API_TOKEN': 'org.organization.apiToken',
  'PLAYWRIGHT_TEST_USERNAME': 'test.testAccount.username',
  'PLAYWRIGHT_TEST_PASSWORD': 'test.testAccount.password',
  'PLAYWRIGHT_DISABLE_AUTO_LOGIN': 'test.login.method=none',
  // ... more mappings
};
```

## Testing Strategy

### Unit Tests
- Config loading and validation
- Context creation and augmentation
- Variable replacement
- Result collection

### Integration Tests
- Full test execution with mock services
- Login strategies
- AI action simulation
- Export functionality

### E2E Tests
- Run actual tests against test environment
- Validate exported tests
- Performance benchmarks

## Performance Considerations

1. **Config Caching**: Organization config cached in memory
2. **Lazy Loading**: Load AI/login modules only when needed
3. **Parallel Execution**: Support for parallel test runs
4. **Resource Cleanup**: Proper cleanup of browser contexts

## Extensibility

The package is designed with clean interfaces that allow for future extensibility:
- WebAgent is a companion service (AI provider selection happens there)
- Login system can be extended with new strategies
- Config loading supports multiple sources
- Test context is extensible via augmentation

## Security Considerations

1. **Credential Storage**: Never store plain passwords in configs
2. **Config Validation**: Strict schema validation
3. **Sanitized Exports**: Remove sensitive data from exports
4. **API Token Management**: Secure token handling
5. **Provider API Keys**: Support for environment variables and secure stores

## Open Questions

1. **Config Format**: Should we support YAML in addition to JSON?
2. **Plugin System**: Should we support plugins for custom actions?
3. **Versioning**: How to handle config schema versioning?
4. **Cloud Storage**: Should configs support remote storage (S3, etc.)?
5. **Test Discovery**: Should we support test discovery patterns?

## Next Steps

1. Review and refine this design
2. Create package.json and initial structure
3. Implement config system
4. Build test context
5. Create MVP for validation