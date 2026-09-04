# YAML Test Language Specification — Appendix

> This appendix accompanies the [YAML Test Language Specification](./YAML-TEST-LANGUAGE-SPEC.md).

---

## Appendix A: Transpilation Details

## A.1 Pipeline

**Single-test files:**

```
*.test.yaml
    ↓ parseYamlTestFile()
    ├── Extract metadata (name, tags, use, parameters, hooks)
    ├── Expand templates (statements, teardown, hooks)
    └── Parse statements (yamlToTestFlow)
    ↓ transpileTestFlow()
    ├── Generate imports
    ├── Generate test.use() config
    ├── Generate hooks (beforeEach, afterEach)
    ├── Generate test(s) — one per parameter set, or single test
    │   ├── try { statements } finally { teardown }
    │   └── Each statement → appropriate agent method
    └── Output *.yaml.spec.ts
```

**Suite files:**

```
*.test.yaml
    ↓ parseYamlTestFile()
    ├── Extract metadata (name, tags, use)
    ├── Detect suite key → parse suite structure
    ├── Expand templates (hooks, test statements)
    └── Parse each test's statements (yamlToTestFlow)
    ↓ transpileSuiteFile()
    ├── Generate imports
    ├── Generate test.use() config
    ├── Generate test.describe.serial()
    │   ├── Suite hooks (beforeAll, afterAll, beforeEach, afterEach)
    │   └── test() blocks — one per test (× parameter sets if parameterized)
    └── Output *.yaml.spec.ts
```

## A.2 Step ID Hierarchy

Each statement gets a hierarchical step ID for tracing:

| Context | Pattern | Example |
|---|---|---|
| Top-level statement | `main.{index}` | `main.0`, `main.1` |
| Teardown statement | `teardown.{index}` | `teardown.0` |
| Nested in STEP | `main.{parent}.{index}` | `main.2.0`, `main.2.1` |
| IF_ELSE THEN branch | `main.{n}.then.{index}` | `main.3.then.0` |
| IF_ELSE ELSE branch | `main.{n}.else.{index}` | `main.3.else.0` |
| WHILE_LOOP body | `main.{n}.body.{index}` | `main.4.body.0` |
| beforeAll hook | `beforeAll.{index}` | `beforeAll.0` |
| afterAll hook | `afterAll.{index}` | `afterAll.0` |
| beforeEach hook | `beforeEach.{index}` | `beforeEach.0` |
| afterEach hook | `afterEach.{index}` | `afterEach.0` |

## A.3 Caching

Re-transpilation is skipped when all of the following are true:
- The output `.yaml.spec.ts` file exists
- Its version header matches the current transpiler version
- The YAML source file has not been modified since the output was generated
- No referenced template files have been modified since the output was generated

## A.4 Template Expansion Algorithm

1. Parse raw YAML document
2. Walk `statements`, `teardown`, and hook arrays (`beforeAll`, `afterAll`, `beforeEach`, `afterEach`) looking for `template:` references
3. For suite files, also walk `suite.tests[].statements` and `suite.tests[].teardown`
4. For each template reference:
   a. Resolve path relative to the importing file
   b. Read and parse the template YAML
   c. Validate all required params are provided
   d. Substitute `<<paramName>>` with provided values
   e. Recursively expand nested template references
5. Replace the `template:` reference with the inlined statements
6. Pass the expanded document to the core YAML parser

## A.5 Statement → Code Mapping

| Statement Type | Generated Code |
|---|---|
| DRAFT | `agent.run(page, description, stepId)` |
| ACTION (non-AI) | `agent.step(page, async () => { locator.action() }, description, stepId, uid, selfHeal)` |
| ACTION (AI action) | Direct AI action code (no `step` wrapper) |
| STEP | Comment + nested statements (no code wrapper) |
| IF_ELSE (AI) | `if (await agent.evaluate(page, condition, stepId)) { ... }` |
| IF_ELSE (JS) | `if (jsExpression) { ... }` |
| WHILE_LOOP (AI) | Timeout guard + `while (check() && await agent.evaluate(...)) { ... }` |
| WHILE_LOOP (JS) | Timeout guard + `while (check() && jsExpression) { ... }` |
| URL (shorthand) | `page.goto(url)` or `agent.execAction("go_to_url", ...)` |
| Code (`description:` + `js:`) | `agent.step(page, async () => { {code} /* scoped block */ }, description, stepId, uid, false)` — wrapped but **not** self-healing |
| `timeout: N` | `test.setTimeout(N)` inside test body |
| `skip: true` | `test.skip()` inside test body |
| `skip: "reason"` | `test.skip(true, "reason")` inside test body |
| `fail: true` | `test.fail()` inside test body |
| `fail: "reason"` | `test.fail(true, "reason")` inside test body |
| `only: true` | `test.only(...)` replaces `test(...)` |
| `slow: true` | `test.slow()` inside test body |

## A.6 Transpiled Code Examples

**DRAFT transpiles to:**

```typescript
await agent.run(page, "Click the login button", "main.0");
```

**ACTION transpiles to:**

```typescript
await agent.step(page, async () => {
  await page.getByRole('button', { name: 'Login' }).click();
}, "Click the login button", "main.0", "uid", true);
```

**STEP transpiles to:**

```typescript
// Step: Complete checkout
// main.0.0: Enter shipping address
page = agent.agentServices.validatePage(page);
await agent.run(page, "Enter shipping address", "main.0.0");

// main.0.1: Select payment method
page = agent.agentServices.validatePage(page);
await agent.run(page, "Select payment method", "main.0.1");
```

**IF_ELSE transpiles to (AI):**

```typescript
if (await agent.evaluate(page, "cookie consent dialog is visible", "main.0")) {
  // THEN branch
} else {
  // ELSE branch
}
```

**WHILE_LOOP transpiles to:**

```typescript
const loop_start = Date.now();
const loop_timeout = 60000;
const loop_check = () => {
  if (Date.now() - loop_start > loop_timeout) {
    throw new Error('While loop exceeded timeout of 60s');
  }
  return true;
};
while (loop_check() && await agent.evaluate(page, "there are more pages", "main.0")) {
  // DO body
}
```

**Code (`description:` + `js:`) transpiles to:**

```typescript
// main.0: Abort all API requests
page = agent.agentServices.validatePage(page);
await agent.step(page, async () => {
  {
    await page.route('**/api', r => r.abort());
  }
}, "Abort all API requests", 'main.0', 'uid', false);
```

The trailing `false` is the self-heal flag — a code statement runs its `js` verbatim and does not re-resolve on failure. (Compare to a structured ACTION above, which passes `true`.)

**Teardown transpiles to:**

```typescript
test('Create and verify user', async ({ page, agent }) => {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  try {
    // Test steps
    await agent.run(page, "Create a new user named TestUser", "main.0");
    // ...
  } finally {
    // Teardown
    await agent.run(page, "Delete user TestUser", "teardown.0");
    // ...
  }
});
```

**Suite transpiles to:**

```typescript
// @generated by shiplightai v{VERSION}+fmt{FORMAT_REVISION}
import { test, expect } from 'shiplightai/fixture';

test.use({ /* use config */ });

test.describe.serial('Inventory Browsing Suite', { tag: ['@smoke', '@suite'] }, () => {
  // hooks (if any)...

  test('Sort products by price', async ({ page, agent }) => {
    // statements...
  });

  test('View product details', async ({ page, agent }) => {
    // statements...
  });
});
```

**beforeAll/afterAll transpiles to:**

```typescript
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  // Direct Playwright calls (no agent wrapper)...
  await page.goto("https://www.saucedemo.com/inventory.html", { waitUntil: 'domcontentloaded' });
  await page.close();
});
```

**Parameterized test transpiles to:**

```typescript
test('Add product to cart [backpack]', { tag: ['@e2e', '@parameterized', '@backpack'] }, async ({ page, agent }) => {
  // main.0: Add product to cart
  await agent.step(page, async () => {
    await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
  }, "Add product to cart", "main.0", "uid", true);
  // ...
});

test('Add product to cart [bike light]', { tag: ['@e2e', '@parameterized', '@bike light'] }, async ({ page, agent }) => {
  // Same structure with "bike light" values substituted...
});
```

---

## Appendix B: Document Structure Quick Reference

A test file is a single YAML document. There are two formats: **single-test** and **suite**.

### B.1 Single-Test File

```yaml
# Metadata (optional)
name: Human-readable test title
tags: [smoke, auth]

# Playwright config (optional)
use:
  storageState: auth/admin.json
  viewport: { width: 1280, height: 720 }

# Test definition (required)
goal: Verify login works for admin users

# Test body (required)
statements:
  - URL: https://app.example.com/login
  - intent: Enter admin@example.com into the email field
  - intent: Click login
  - VERIFY: dashboard is visible

# Cleanup (optional)
teardown:
  - intent: Click logout

# Hooks (optional)
beforeEach:
  - intent: Navigate to login page
afterEach:
  - intent: Clear cookies

# Parameters (optional)
parameters:
  - name: admin
    values: { username: admin@test.com }
  - name: editor
    values: { username: editor@test.com }
```

### B.2 Suite File

```yaml
# Metadata (optional)
name: Login Suite
tags: [smoke, auth]

# Playwright config (optional)
use:
  storageState: auth/admin.json

# Suite definition (required — mutually exclusive with goal/statements)
suite:
  # Lifecycle hooks (optional)
  beforeAll:
    - intent: Seed test data
      call: "./helpers/seed.ts#seedData"
  beforeEach:
    - URL: https://app.example.com/dashboard
  afterEach:
    - intent: Take a screenshot
  afterAll:
    - intent: Clean up test data

  # Tests (required, at least one)
  tests:
    - name: Valid login
      statements:
        - intent: Enter valid credentials
        - VERIFY: dashboard is visible
    - name: Invalid login
      statements:
        - intent: Enter invalid credentials
        - VERIFY: error message is shown
```

### B.3 Execution Control Annotations

Both single-test and suite-test files support execution control annotations that map directly to Playwright test modifiers.

**Single-test file:**

```yaml
name: Slow checkout test
skip: "Blocked by bug #123"
timeout: 60000
slow: true

goal: Complete checkout
statements:
  - URL: https://app.example.com/cart
  - Click checkout
  - VERIFY: order confirmed
```

**Suite test:**

```yaml
suite:
  tests:
    - name: Known failing test
      fail: true
      statements:
        - Do something that is expected to fail
    - name: Focused test
      only: true
      timeout: 30000
      statements:
        - This test runs exclusively during development
```
