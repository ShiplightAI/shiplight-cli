# Context Architecture Design

## Overview

This document describes the architecture for TestContext and WebAgentContext, which provide clean separation between user-facing test variables and internal agent execution state.

## Core Principles

**Clean Separation of Concerns:**
- **TestContext** = User-facing variables only (for test writers)
- **WebAgentContext** = Internal execution state (for WebAgent operations)
- **VariableStore** = Shared storage between both contexts

## Architecture Components

### 1. VariableStore (`shiplight-types`)

**Purpose:** Centralized variable storage shared between TestContext and WebAgentContext

**Location:** `/packages/types/src/VariableStore.ts`

**Interface:**
```typescript
class VariableStore {
  get(key: string): any;
  set(key: string, value: any, sensitive?: boolean): void;
  getAll(): Record<string, any>;
  has(key: string): boolean;
  getSensitiveKeys(): Set<string>;
  clear(): void;
}
```

**Responsibilities:**
- Store all test variables
- Track which keys contain sensitive data (passwords, tokens, etc.)
- Provide thread-safe variable access
- Shared instance passed to both TestContext and WebAgentContext

**Key Features:**
- Sensitive key tracking (for masking in logs/reports)
- Simple get/set interface
- Immutable getAll() returns copy of data

---

### 2. TestContext (`@shiplightai/test`)

**Purpose:** User-facing context for test writers

**Location:** `/packages/test-fixtures/src/TestContext.ts`

**Interface:**
```typescript
interface TestContext {
  // Shared variable storage
  variableStore: VariableStore;

  // Test metadata (internal, not for users)
  _internal: {
    testInfo?: any;
    testDir?: string;
    testName?: string;
    testId?: string;
    browserContext?: BrowserContext;
    configs?: RuntimeConfig;
    cdpPort?: number;
    consoleLogs?: Array<{...}>;
    debugInfo?: any;
    error?: string;
  };

  // User-friendly methods
  get(key: string): any;
  set(key: string, value: any, sensitive?: boolean): void;
  add(key: string, value: any): void;
  getVariables(): Record<string, any>;
}
```

**Factory Function:**
```typescript
function createTestContext(options: {
  variableStore: VariableStore;  // Required - shared with WebAgentContext
  configs?: any;
  organizationId?: string;
  organizationSettings?: Record<string, any>;
}): TestContext
```

**Features:**
- **Proxy support** - Allows `testContext.myVar = 'value'` syntax
- **Property-style access** - Read variables like `testContext.email`
- **Method access** - Also supports `testContext.get('email')`
- All variable operations delegate to `variableStore`

**Usage Example:**
```typescript
// Create shared variable store
const variableStore = new VariableStore();

// Create test context
const testContext = createTestContext({ variableStore });

// Set variables (all methods work)
testContext.email = 'test@example.com';           // Proxy style
testContext.set('password', 'secret123', true);   // Method style (sensitive)
testContext.add('userId', 42);                     // Add method

// Get variables (all methods work)
const email = testContext.email;                   // Proxy style
const password = testContext.get('password');      // Method style
const allVars = testContext.getVariables();        // Get all

// Access test metadata
const testDir = testContext._internal.testDir;
const configs = testContext._internal.configs;
```

**Responsibilities:**
- Expose variables to test writers with ergonomic API
- Store test metadata in `_internal`
- Provide Proxy for natural property-style access
- All variable operations delegate to shared VariableStore

**NOT Responsible For:**
- Step tracking (belongs to WebAgentContext)
- Token usage tracking (belongs to WebAgentContext)
- AI action tracking (belongs to WebAgentContext)

---

### 3. WebAgentContext (`sdk-core`)

**Purpose:** Internal execution state for WebAgent

**Location:** `/packages/sdk-core/src/agent/types.ts`

**Interface:**
```typescript
interface WebAgentContext {
  // Shared variable storage
  variableStore: VariableStore;

  // Organization/execution context
  organizationId?: string;
  organizationSettings?: Record<string, any>;
  executionHistory?: Array<[string, string]>;

  // WebAgent API URL (client-side configuration)
  agentApiUrl?: string;

  // CDP port for this test worker (for parallel execution)
  cdpPort?: number;

  // Optional step tracking - if present, step tracking is enabled
  stepTracking?: StepTrackingConfig;

  // Test data directory for file operations
  testDataDir?: string;

  // Download directory for file downloads
  downloadDir?: string;

  // Download tracking
  downloadStatus?: DownloadStatus | null;

  // Self-healing state
  selfHealing?: boolean;

  // Agent note for current step execution
  agentNote?: string;

  // Token usage tracking - collected from LLM calls
  tokenUsages?: TokenUsage[];

  // AI action details - tracks each LLM API call
  aiActionDetails?: AIActionDetail[];

  // Action generator configuration
  useNativeGenerator?: boolean;

  // Page management callback
  setPage?: (page: any) => void;

  // Test data download callback
  downloadTestDataFiles?: (filePaths: string[]) => Promise<void>;
}
```

**Factory Function:**
```typescript
function createAgentContext(options: {
  variableStore: VariableStore;  // Required - shared with TestContext
  organizationId?: string;
  organizationSettings?: Record<string, any>;
  executionHistory?: Array<[string, string]>;
  agentApiUrl?: string;
  testDataDir?: string;
  downloadDir?: string;
  useNativeGenerator?: boolean;
  cdpPort?: number;
}): WebAgentContext
```

**Responsibilities:**
- Track step execution results in `stepTracking.results`
- Collect LLM token usage in `tokenUsages[]`
- Record AI action details in `aiActionDetails[]`
- Manage execution history
- Store agent configuration
- Access variables via shared `variableStore`

**NOT Exposed To Users:**
- This is an internal interface
- Users should never directly import or use WebAgentContext
- Only WebAgent and test fixtures should create/access this

---

### 4. WebAgent (`sdk-core`)

**Location:** `/packages/sdk-core/src/agent/webAgent.ts`

**Key Changes:**

#### Constructor
```typescript
constructor(private context: WebAgentContext) {
  this.agentServices = new AgentServices(context);
  if (!this.context.tokenUsages) {
    this.context.tokenUsages = [];
  }
}
```

#### New Method: writeExecutionResults()
```typescript
async writeExecutionResults(
  outputDir: string,
  options?: { tokenUsages?: boolean }
): Promise<void>
```

**Writes:**
- `test-results.json` - Step tracking results (from `context.stepTracking.results`)
- `token-usages.json` - LLM token usage (from `context.tokenUsages`) if enabled
- `ai-actions.json` - Per-step AI calls (from `context.aiActionDetails`)

**Responsibilities:**
- Encapsulate execution state in WebAgentContext
- Track all execution metrics internally
- Provide method to write execution data to files
- Own the responsibility of persisting execution results

**Variable Access:**
All variable operations go through `context.variableStore`:
```typescript
// OLD (removed)
this.context.getVariables()
this.context.sensitiveKeys
this.context.get(key)
this.context.set(key, value)

// NEW
this.context.variableStore.getAll()
this.context.variableStore.getSensitiveKeys()
this.context.variableStore.get(key)
this.context.variableStore.set(key, value, sensitive)
```

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Test Execution                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────┐                              ┌──────────────────┐
│  Test Writer    │                              │   WebAgent       │
│  (User Code)    │                              │   (Internal)     │
└────────┬────────┘                              └────────┬─────────┘
         │                                                │
         │ testContext.email = 'test@example.com'        │
         │ testContext.set('password', 'secret', true)   │
         │                                                │
         ├──────────────┐                                │
         │              ▼                                 │
         │      ┌──────────────────┐                     │
         │      │  VariableStore   │◄────────────────────┼─ agent.execute(...)
         │      │    (Shared)      │                     │  reads variables via
         │      │                  │                     │  context.variableStore
         │      │ - email          │                     │
         │      │ - password (*)   │                     │
         │      │ - userId         │                     │
         │      └──────────────────┘                     │
         │                                                │
         │                                                ▼
         │                                        ┌──────────────────┐
         │                                        │ WebAgentContext  │
         │                                        │                  │
         │                                        │ - tokenUsages[]  │
         │                                        │ - aiActionDetails│
         │                                        │ - stepTracking   │
         │                                        └────────┬─────────┘
         │                                                 │
         │                                                 │
         │                                                 ▼
         │                                    agent.writeExecutionResults()
         │                                                 │
         │                                                 ├─► test-results.json
         │                                                 ├─► token-usages.json
         │                                                 └─► ai-actions.json
         │
         ▼
  fixtures writes console-logs.json
```

---

## Integration: Test Fixtures

**Location:** `/packages/test-fixtures/src/fixtures.ts`

### Agent Fixture Setup

```typescript
// 1. Create test context (creates VariableStore internally)
const testCtx = createTestContext(configs);

// 2. Create WebAgentContext with shared variableStore
const agentContext = createAgentContext({
  variableStore: testCtx.variableStore,  // Share the same store
  organizationId: configs.shiplight.organization.id,
  organizationSettings: configs.shiplight.organization,
  agentApiUrl: webAgentUrl,
  cdpPort: workerCdpPort,
  testDataDir: testCtx._internal.testDir,
  downloadDir: path.join(testCtx._internal.testDir, 'downloads'),
});

// 3. Set up step tracking if screenshots enabled
if (outputConfig?.screenshots) {
  agentContext.stepTracking = {
    results: {},
    screenshotDir: '/path/to/screenshots',
  };
}

// 4. Create agent with WebAgentContext
const agent = new Agent(agentContext);

// 5. Store testCtx reference for $ fixture
(agent as any)._testContext = testCtx;
```

### $ Fixture (TestContext Access)

```typescript
$: async ({ agent }, use) => {
  const testContext = (agent as any)._testContext as TestContext;
  await use(testContext);
}
```

### Output Writing (Teardown)

```typescript
async function writeOutputFiles(testCtx: TestContext, agent: Agent) {
  // fixtures.ts only writes console logs
  if (outputConfig.consoleLogs) {
    await fs.writeFile('console-logs.json',
      JSON.stringify(testCtx._internal.consoleLogs));
  }

  // Agent writes its own execution results
  await agent.writeExecutionResults(outputPath, {
    tokenUsages: outputConfig.tokenUsages
  });
}
```

---

## Migration Guide

### For WebAgent Code

**OLD:**
```typescript
this.context.getVariables()
this.context.sensitiveKeys
this.context.get(key)
this.context.set(key, value, sensitive)
```

**NEW:**
```typescript
this.context.variableStore.getAll()
this.context.variableStore.getSensitiveKeys()
this.context.variableStore.get(key)
this.context.variableStore.set(key, value, sensitive)
```

### For Test Fixtures

**OLD:**
```typescript
// fixtures.ts accessed tokenUsages from testCtx
const tokenUsages = testCtx.tokenUsages;
const aiActions = testCtx.aiActionDetails;
```

**NEW:**
```typescript
// Agent owns and writes its execution data
await agent.writeExecutionResults(outputPath, options);
```

### For Test Writers (User Code)

**No changes needed!** The user-facing API remains the same:
```typescript
// All of these still work
testContext.email = 'test@example.com';
testContext.set('password', 'secret', true);
const email = testContext.get('email');
```

---

## Benefits

✅ **Clear Separation** - User context vs internal execution context
✅ **Shared Variables** - Both contexts access same VariableStore
✅ **Encapsulation** - WebAgent owns and writes its execution data
✅ **Simplified Fixtures** - No need to access WebAgentContext internals
✅ **Better DX** - Proxy support for natural variable access
✅ **Type Safety** - Proper TypeScript types for each context
✅ **Single Source of Truth** - VariableStore is the only place variables are stored
✅ **Clean Responsibilities** - Each component has a clear, focused purpose

---

## Files Modified

### Created:
- `/packages/types/src/VariableStore.ts` - New shared storage class
- `/packages/types/CONTEXT_ARCHITECTURE.md` - This document

### Modified:
1. `/packages/types/src/index.ts` - Export VariableStore
2. `/packages/sdk-core/src/agent/types.ts` - WebAgentContext uses variableStore
3. `/packages/sdk-core/src/agent/agentContextFactory.ts` - Creates context with variableStore
4. `/packages/sdk-core/src/agent/webAgent.ts` - Added `writeExecutionResults()` method
5. `/packages/test-fixtures/src/TestContext.ts` - Refactored to factory pattern with Proxy
6. `/packages/test-fixtures/src/testContextFactory.ts` - Creates shared VariableStore
7. `/packages/test-fixtures/src/fixtures.ts` - Creates both contexts, simplified output writing

### Pending Updates:
- `/packages/sdk-core/src/agent/webAgent.ts` - Replace old context methods with variableStore
- `/packages/sdk-core/src/agent/agentServices.ts` - Replace old context methods with variableStore
- `/packages/sdk-core/src/agent/__tests__/*.test.ts` - Update unit tests

---

## Implementation Checklist

- [x] Create VariableStore class in shiplight-types
- [x] Export VariableStore from types package
- [x] Update WebAgentContext to use variableStore
- [x] Update createAgentContext to require variableStore
- [x] Refactor TestContext to factory pattern with Proxy
- [x] Update testContextFactory to create shared VariableStore
- [x] Add writeExecutionResults() method to WebAgent
- [x] Update fixtures.ts to create both contexts with shared store
- [x] Simplify fixtures.ts writeOutputFiles to use agent method
- [x] Replace context.get/set in webAgent.ts with variableStore
- [x] Replace context.get/set in agentServices.ts with variableStore
- [ ] Update unit tests for new API
- [ ] Test full integration with sample test case
- [ ] Update other call sites (40 files found using createAgentContext/createTestContext)

---

## Future Considerations

1. **Thread Safety**: If parallel test execution becomes an issue, consider adding mutex/locking to VariableStore
2. **Variable Validation**: Could add schema validation to VariableStore.set()
3. **Variable History**: Could track variable change history for debugging
4. **Immutable Variables**: Could add support for read-only variables
5. **Variable Namespaces**: Could add namespacing for better organization
