# YAML Test Language Specification

**Version:** 1.4.0
**Status:** Living document — source of truth for the Shiplight YAML test format

> **Design principle:** This YAML format is designed for **coding agents to read and write**. The syntax is for humans to **read and understand**, not intended for humans to write directly.

---

## Table of Contents

1. [Overview](#1-overview)
2. [File Conventions](#2-file-conventions)
3. [Top-Level Keys](#3-top-level-keys)
4. [Statements](#4-statements)
   - [DRAFT](#41-draft)
   - [ACTION](#42-action)
   - [VERIFY](#43-verify-shorthand)
   - [URL](#44-url-shorthand)
   - [STEP](#45-step)
   - [IF_ELSE](#46-if_else)
   - [WHILE_LOOP](#47-while_loop)
   - [Code](#48-code)
   - [WAIT_UNTIL](#49-wait_until-shorthand)
   - [WAIT](#410-wait-shorthand)
   - [The `js:` Key — One Model](#411-the-js-key--one-model)
5. [Templates](#5-templates)
6. [Functions](#6-functions)
7. [Variables](#7-variables)
8. [Teardown](#8-teardown)
9. [Test Suites](#9-test-suites)
10. [Lifecycle Hooks](#10-lifecycle-hooks)
11. [Parameterized Tests](#11-parameterized-tests)
12. [Complete Examples](#12-complete-examples)

---

## 1. Overview

A Shiplight YAML test file (`.test.yaml`) defines one or more end-to-end tests. A file can be either a **single-test file** (one test) or a **suite file** (multiple tests grouped with shared config and hooks). The transpiler converts it into a Playwright test file (`.yaml.spec.ts`) that uses the `shiplightai` fixture for AI-powered and deterministic browser automation.

**Key concepts:**
- **DRAFT** statements are natural language instructions resolved by AI at runtime (~5-10s each).
- **ACTION** statements are enriched DRAFTs with an `intent` and a cache (`action:`/`locator:`) for deterministic replay (<1s each). When the cache fails, the agent auto-heals using the intent.
- **Suites** group multiple tests in one file with shared hooks and sequential execution.
- **Lifecycle hooks** (`beforeAll`, `afterAll`, `beforeEach`, `afterEach`) handle setup and cleanup.
- **Parameterized tests** generate multiple test instances from data sets using `{{variable}}` runtime variables.
- The transpiler produces standalone Playwright tests — no runtime YAML dependency.

---

## 2. File Conventions

| Convention | Value |
|---|---|
| Test file extension | `*.test.yaml` |
| Generated output | `*.yaml.spec.ts` (sibling of YAML source) |
| Template files | Any `.yaml` — no naming restriction |
| Discovery | `**/*.test.yaml`, excluding `node_modules` |
| Max file size | 1 MB |

---

## 3. Top-Level Keys

A file must be either a **single-test file** (with `goal`/`statements`) or a **suite file** (with `suite`). Having both is an error. The `goal` field is auto-derived from `name` if not explicitly provided.

### Required Keys (Single-Test Files)

| Key | Type | Description |
|---|---|---|
| `goal` | `string` | Test objective. Becomes the Playwright test title if `name` is not set. Auto-derived from `name` if omitted. |
| `statements` | `Statement[]` | Ordered list of test steps. See [Statements](#4-statements). |

### Required Keys (Suite Files)

| Key | Type | Description |
|---|---|---|
| `suite` | `object` | Suite definition. See [Test Suites](#9-test-suites). Mutually exclusive with `goal`/`statements`. |

### Optional Keys

| Key | Type | Default | Description |
|---|---|---|---|
| `base_url` | `string` | — | Base URL for relative `URL:` statements. Maps to Playwright `test.use({ baseURL })`. Applies to single-test **and** suite files. Does **not** auto-navigate — use `URL: /` to navigate. Absolute `URL:` values (`https://…`, `chrome-extension://…`) need no `base_url`. Takes precedence over `use.baseURL`. |
| `test_case_id` | `number` | — | Links to a cloud test case for sync. |
| `name` | `string` | — | Test title override (single-test) or suite name (suite). If set on a single-test file without `goal`, `goal` is auto-derived from `name`. |
| `tags` | `string[]` | — | Playwright tags for `--grep` filtering, emitted as `test('…', { tag: ['@smoke'] }, …)`. Each tag is prefixed with `@` in the **generated Playwright tag**, so `smoke` and `@smoke` both select with `--grep '@smoke'`; blank entries and duplicates are dropped. Cloud reporting stores the tag exactly as written in YAML, so pick one spelling per project if you filter by tag there. On a suite file the tags go on the `describe`, and Playwright applies them to every test inside it; a suite's individual tests may also carry their own `tags`. |
| `use` | `object` | — | Playwright `test.use()` config. Supports all Playwright use options (`baseURL`, `viewport`, `storageState`, `locale`, `timezoneId`, `httpCredentials`, etc.). |
| `teardown` | `Statement[]` | — | Cleanup steps that run in a `finally` block, even if the test fails. Single-test only. |
| `beforeEach` | `Statement[]` | — | Statements to run before each test. Single-test files only. See [Lifecycle Hooks](#10-lifecycle-hooks). |
| `afterEach` | `Statement[]` | — | Statements to run after each test. Single-test files only. See [Lifecycle Hooks](#10-lifecycle-hooks). |
| `parameters` | `ParameterSet[]` | — | Data sets for parameterized test generation. See [Parameterized Tests](#11-parameterized-tests). |
| `timeout` | `number` | — | Per-test timeout in milliseconds. Transpiles to `test.setTimeout()`. |
| `skip` | `boolean \| string` | — | Skip test. `true` skips unconditionally; a string skips with a reason message. Prefer string form (`skip: "Bug #123"`) so reason is visible in reports. |
| `fail` | `boolean \| string` | — | Mark test as expected failure. `true` or a reason string. Prefer string form (`fail: "Known issue"`) so reason is visible in reports. |
| `only` | `boolean` | — | Focus: run only this test. Transpiles to `test.only()`. |
| `slow` | `boolean` | — | Triple the test timeout. Transpiles to `test.slow()`. |
| `final_feedback` | `string` | — | Runtime field. Final execution feedback from the last run. |

---

## 4. Statements

Statements are the building blocks of a test. Each statement has a `type` (inferred from YAML syntax) and a system-generated `uid` (UUID v4, assigned during parsing).

### Core Statement Types

| Type | Enriched? | Description |
|---|---|---|
| `DRAFT` | No | Natural language instruction. Requires AI agent execution at runtime. |
| `ACTION` | Yes | Enriched with a cache (`action:`/`locator:`) for deterministic replay. |
| `STEP` | Yes | A multi-action container — groups multiple child statements (ACTIONs, DRAFTs, etc.). |

A DRAFT is not yet enriched. When the AI agent executes a DRAFT, it enriches into either an ACTION (single action produced) or a STEP (multiple actions produced). ACTIONs and STEPs are already enriched and replay deterministically.

### Statement Type Inference

| YAML Syntax | Inferred Type | Description |
|---|---|---|
| `VERIFY: ...` | `ACTION` | Assertion shorthand |
| `URL: ...` | `ACTION` (go_to_url) | Navigation shorthand (auto-generates `action_entity`) |
| `intent` only | `DRAFT` | Natural language instruction in object form |
| Object with `action` key | `ACTION` | Deterministic browser action |
| `STEP: ...` + `statements:` | `STEP` | Group of related statements |
| `IF: ...` + `THEN: ...` | `IF_ELSE` | Conditional execution |
| `WHILE: ...` + `DO: ...` | `WHILE_LOOP` | Loop with timeout |
| `description:` + `js:` | `ACTION` | Inline JavaScript escape hatch (no self-healing) |
| `WAIT_UNTIL: ...` | `ACTION` (ai_wait_until) | Condition wait with timeout — AI (default), or JS via a sibling `js:` key |
| `WAIT: ...` | `ACTION` (wait) | Fixed duration wait (use sparingly) |
| `template: ...` | *(inlined)* | Expanded before parsing — not a statement type |
| `call: "file#export"` | `ACTION` | Calls a custom function — see [Functions](#6-functions) |

---

### 4.1 DRAFT

A natural language instruction that requires AI agent execution at runtime. The agent interprets the instruction and produces concrete browser actions. After execution, a DRAFT is enriched into an ACTION (single action produced) or a STEP (multiple actions produced).

**Syntax:**

```yaml
statements:
  - intent: Click the login button
```

**Performance:** ~5-10 seconds per DRAFT (AI resolution).

---

### 4.2 ACTION

An enriched browser action that replays deterministically (<1s). Every ACTION has an `intent` that defines _what_ the action does. The `action`/`locator` fields are **caches** of _how_ to do it. When a cache fails (stale locator, changed DOM), the agent self-heals by using the intent to re-inspect the page and regenerate the action.

In YAML, the presence of an `action` key distinguishes an ACTION from a DRAFT — an `intent`-only object is parsed as a DRAFT. (For one-off Playwright code that has no named action, use the [Code](#48-code) escape hatch — but note it does **not** self-heal.)

**Structured format** — named action with parameters. All fields other than `intent`, `action`, `locator`, `xpath` are passed as arguments to the action. Run `npx shiplight spec actions` for available actions and their parameters.

```yaml
statements:
  - intent: Click the login button
    action: click
    locator: "getByRole('button', { name: 'Login' })"

  - intent: Enter email address
    action: input_text
    locator: "getByPlaceholder('Email')"
    text: "user@example.com"

  - intent: Select country
    action: select_dropdown_option
    locator: "getByRole('combobox')"
    option: "United States"
```

**Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `intent` | `string` | Yes | Human-readable intent (used for self-healing). |
| `action` | `string` | Yes | Action name. Run `npx shiplight spec actions` for available actions. |
| `locator` | `string` | No | Playwright locator string. |
| `xpath` | `string` | No | XPath selector. Only needed when an ACTION has neither `locator` nor a named target. |

**Performance:** ~1 second (deterministic replay).

---

### 4.3 VERIFY (Shorthand)

Shorthand for assertions.

**Syntax:**

```yaml
statements:
  # Draft (AI-only, no cache)
  - VERIFY: The dashboard heading is visible
  - VERIFY: Shopping cart shows 3 items

  # Enriched (with JS code cache — quote values containing { } : or other special YAML chars)
  - VERIFY: button ABC is visible
    js: "await expect(page.getByRole('button', { name: 'ABC' })).toBeVisible({ timeout: 2000 })"
```

When the optional `js` sibling key is present, it acts as a code cache for the assertion.

**Execution behavior:**
- **`statement` only (draft):** AI evaluates the natural language assertion (~5-10s).
- **`js` only:** Runs the JS assertion directly (<1s). No AI fallback.
- **Both `js` and `statement` (enriched):** Runs `js` first. If it fails, falls back to AI evaluation of `statement` (self-healing). The `js` cache is written by AI agents during enrichment, not by humans.

**Quoting rules:** Same as `js:` and `IF:`/`WHILE:` — quote the value when it contains special YAML characters (`{`, `}`, `:`, `#`, etc.).

VERIFY is the only `js:` surface with an AI fallback — see [The `js:` Key — One Model](#411-the-js-key--one-model) for the cross-statement comparison.

---

### 4.4 URL (Shorthand)

Shorthand for page navigation.

**Syntax:**

```yaml
statements:
  # Plain URL
  - URL: /inventory.html
  - URL: https://app.example.com/login

  # With optional arguments
  - URL: /dashboard
    new_tab: true
    timeout_seconds: 30
```

**Optional sibling keys:**

| Key | Type | Default | Description |
|---|---|---|---|
| `new_tab` | `boolean` | `false` | Open the URL in a new browser tab. |
| `timeout_seconds` | `number` | — | Navigation timeout in seconds. |

**Notes:**
- Relative URLs (e.g., `/path`) resolve against Playwright's `baseURL` config.

---

### 4.5 STEP

A multi-action container that groups related child statements. A STEP is the enriched form when a DRAFT produces multiple actions, or it can be authored directly to organize logically related statements.

**Syntax:**

```yaml
statements:
  - STEP: Complete checkout
    statements:
      - intent: Enter shipping address
      - intent: Select payment method
      - intent: Click Place Order
```

**Rules:**
- `STEP` (string, required): Description of what this group does.
- `statements` (array, required): Child statements (any type, including nested STEPs).

---

### 4.6 IF_ELSE

Conditional execution with an optional ELSE branch.

**Syntax — AI condition (default):**

```yaml
statements:
  - IF: cookie consent dialog is visible
    THEN:
      - intent: Click Accept All
    ELSE:
      - VERIFY: no cookie dialog blocking
```

**Syntax — JavaScript condition:**

```yaml
statements:
  - IF: "js: (await page.locator('.modal').count()) > 0"
    THEN:
      - intent: Close the modal
```

**Condition types:**

| Prefix | Type | Evaluation |
|---|---|---|
| *(none)* | `AI_MODE` | Natural language, evaluated by the AI agent at runtime |
| `js:` | `JS_CODE` | Inline Playwright expression, evaluated in the test context (Node.js). Must evaluate to truthy/falsy. |

A `js:` condition is a single **expression**, not a statement block — it is inlined verbatim into the transpiled Playwright test (`if (<expr>)`, `while (<expr>)`, or a polled predicate), so it must evaluate to truthy/falsy. It runs in the test context (Node.js) with the same scope as [Code](#48-code) statements (`page`, `expect`, `agent`), and `await` is allowed. Bare `document`/`window` are **not** in scope — use `page.locator(...)` probes, or `page.evaluate()` for browser-side DOM access. This applies to every `js:` condition position: `IF:`, `WHILE:`, and `WAIT_UNTIL:`. See [The `js:` Key — One Model](#411-the-js-key--one-model) for how conditions differ from the other `js:` surfaces.

**Rules:**
- `IF` (string, required): Condition expression.
- `THEN` (array, required): Statements to execute if condition is true.
- `ELSE` (array, optional): Statements to execute if condition is false.

---

### 4.7 WHILE_LOOP

Repeats statements until the condition is false or timeout is exceeded.

**Syntax:**

```yaml
statements:
  - WHILE: there are more pages of results
    DO:
      - intent: Click the Next button
      - VERIFY: new results loaded
    timeout_ms: 60000
```

**Syntax — JavaScript condition:**

```yaml
statements:
  - WHILE: "js: (await page.locator('.item').count()) < 10"
    DO:
      - intent: Scroll down
```

**Rules:**
- `WHILE` (string, required): Condition expression (same `AI_MODE`/`JS_CODE` rules as IF_ELSE).
- `DO` (array, required): Statements to execute each iteration.
- `timeout_ms` (number, optional): Maximum loop duration. Default: `180000` (3 minutes).

---

### 4.8 Code

The escape hatch for inline Playwright code that doesn't map to a named action — network mocking, localStorage manipulation, and other page-level scripting. A code statement is a `js:` body, optionally labeled with a `description:` (what the code does). Always write the `description:` — it's optional only so tools can round-trip code blocks, but it makes reports readable.

**No self-healing.** Unlike an ACTION, a code statement runs its `js` verbatim; if it fails, it fails. The `description` is informational only — it is **not** a re-resolvable intent.

**Syntax — single-line:**

```yaml
statements:
  - description: Abort all API requests
    js: "await page.route('**/api', r => r.abort())"
```

**Syntax — multiline (block scalar):**

```yaml
statements:
  - description: Mock the users API to return a single user
    js: |
      await page.route('**/api/users', (route) => route.fulfill({
        status: 200,
        body: JSON.stringify([{ name: 'John' }]),
      }));
```

**Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `description` | `string` | No | What the code does. Labels the step; informational only (no self-healing). Recommended for readable reports; defaults to a generic label if omitted. |
| `js` | `string` | Yes | Complete, executable Playwright code (single line or block scalar). |

**Execution context:**

Code runs in the Playwright test context (Node.js). Use `page.evaluate()` for browser-context code.

The following are in scope:

| Identifier | Description |
|---|---|
| `page` | Playwright `Page` |
| `expect` | Playwright assertion library |
| `agent` | Shiplight `WebAgent` — see common methods below |
| `testContext` | The runtime variable store (same store as `{{variableName}}` in YAML). Use `.get(key)` / `.set(key, value)` or property-style access. |
| `request` | Playwright `APIRequestContext` — available when any statement in the file passes `request` as a function arg |
| `extensionActionPopup` | Playwright `Page` for the extension's real toolbar action popup. Requires `use: { extensionDir: "..." }`; referencing it opens the popup before the test runs. |

`agent` common methods:

```javascript
await agent.assert(page, "The shopping cart shows 3 items");
await agent.execute(page, "Click the Submit button");
await agent.extract(page, "the order confirmation number", "orderNumber");
await agent.waitForDownloadComplete(page, 10);
const filePath = agent.getRecentDownloadedFilePath();
```

**Importing packages** — use dynamic import (static imports are not supported):

```javascript
const fs = await import("node:fs");
const { v4: uuidv4 } = await import("uuid");
```

**Other notes:**
- `js:` is meaningful only as a standalone code statement (`description:` + `js:`) or as a `VERIFY:` assertion cache. On any other `action:` statement, `js:` is ignored.
- The debugger shows only the `js:` body; `description:` is rendered separately. If you copy a snippet from the debugger into a YAML file, re-add a `description:` — otherwise the label defaults to `Code block`.

### 4.9 WAIT_UNTIL (Shorthand)

Smart wait — repeatedly checks a condition until it's met or the timeout expires. The condition can be **natural language** (checked by the AI agent) or a **JavaScript expression** (checked in-process, no model calls), using the same `js:` prefix convention as [IF_ELSE](#46-if_else) and [WHILE_LOOP](#47-while_loop).

**WAIT_UNTIL synchronizes — it never fails the test.** It is an optimization of a fixed `WAIT:`: when the condition is met the test moves on early; when the timeout expires the test still continues, and the step result records a warning saying the condition was not met (or that the expression never evaluated cleanly). To *assert* that something holds, use `VERIFY:` — a wait is not a correctness gate.

**Syntax — AI condition (default):**

```yaml
statements:
  - WAIT_UNTIL: Dashboard data has finished loading
    timeout_seconds: 10

  - WAIT_UNTIL: Spinner has disappeared
```

**Syntax — JS condition with intent (preferred):**

```yaml
statements:
  - WAIT_UNTIL: The dashboard has finished loading
    js: "(await page.locator('.spinner').count()) === 0"
    timeout_seconds: 10
```

**Syntax — bare JS condition (legacy shorthand, no intent):**

```yaml
statements:
  - WAIT_UNTIL: "js: (await page.locator('.result-row').count()) >= 10"
```

**Semantics:**

| Form | Behavior |
|---|---|
| Natural language only | AI polls the condition. Each check is a model call (~5-15s). |
| Natural language + sibling `js:` | The `js:` expression is polled exclusively, in-process (~4×/second), no model calls. The natural language is the label shown in reports and the source for regenerating a stale expression at authoring time. **No AI fallback at runtime.** |
| `"js: ..."` prefix | Same polling as above, without a label. Readable for round-trips, but discouraged for authoring — prefer the sibling form. |

Unlike `VERIFY:` (where `js:` is a cache and the AI re-checks the assertion when it throws), a WAIT_UNTIL `js:` never falls back: a wait has no failure signal to fall back on — falsy means "keep waiting", and a stale selector turning truthy looks like success. Repair happens at authoring time, from the preserved intent.

It is an error to combine both JS forms (a `"js: ..."`-prefixed condition plus a sibling `js:` key).

| Key | Type | Default | Description |
|---|---|---|---|
| `WAIT_UNTIL` | `string` | *(required)* | The condition. Natural language (the intent when `js:` is present), or a legacy `js:`-prefixed expression. |
| `js` | `string` | — | JavaScript expression polled in place of the AI check. Single expression, must evaluate to truthy/falsy. |
| `timeout_seconds` | `number` | `60` | Maximum seconds to wait before continuing (with a warning in the step result). Capped at 300 (applies to both AI and `js:` waits). |

**Which to use:**
- **Prefer the intent + `js:` form** for simple DOM/state checks — an element appearing or disappearing, a count reaching a threshold, a class toggling. It is polled cheaply with **no model calls**, so it's far faster and cheaper than an AI wait, and the intent keeps the step readable. An AI check takes 5–15 seconds *and* a model call each poll.
- **Use natural language alone** when the condition is semantic ("the order summary looks correct"), when there's no reliable selector, or when the DOM may drift and you want the check to self-heal.

**JavaScript execution context:**
- The expression runs in the Playwright test context (Node.js) with the same scope as [Code](#48-code) statements — `page`, `expect`, `agent` are in scope, and `await` is allowed (e.g. `await page.locator(...).count()`). Use `page.evaluate()` for browser-context code. It must evaluate to truthy/falsy.

**Notes:**
- Each AI condition check can take 5–15 seconds. For short fixed pauses, use `WAIT:` instead.
- **A `js:` wait does not self-heal at runtime.** If its selector goes stale, the expression can turn truthy immediately — the wait ends early without having synchronized anything, and a later step flakes. When a selector may drift, prefer natural language — or use the intent + `js:` form, whose preserved intent lets an agent regenerate the expression at authoring time.
- **A broken expression degrades to a fixed wait.** If the expression throws on every poll (e.g. it references a browser-only global like `document` in the Node test context) or fails to parse, the wait runs the full timeout and continues; the step result's warning names the error (e.g. "never evaluated successfully … document is not defined"). `shiplight transpile` catches syntax errors at authoring time, but only runtime can catch a bad reference.
- **The predicate must return truthy/falsy — not a Playwright wait.** `js: await page.locator('.spinner').waitFor({ state: 'detached' })` resolves to `undefined` (falsy), so the poll loop never sees "met" and waits the full timeout. Use a boolean-returning check instead: `js: (await page.locator('.spinner').count()) === 0`.
- **Use fast, non-retrying probes** — `count()`, `isVisible()`, or a `page.evaluate()` returning a boolean. An `expect()` assertion auto-retries internally (up to ~5s) and *throws* instead of returning a boolean, which fights the poll loop and can overshoot a short `timeout_seconds`.

### 4.10 WAIT (Shorthand)

Fixed duration wait, use for short durations.

**Syntax:**

```yaml
statements:
  - WAIT: Wait for animation to complete
    seconds: 3
```

| Key | Type | Default | Description |
|---|---|---|---|
| `WAIT` | `string` | — | Optional intent describing why the wait is needed |
| `seconds` | `number` | `3` | Number of seconds to wait |

### 4.11 The `js:` Key — One Model

Wherever it appears, `js:` means the same thing: **run this Playwright code in the test context (Node.js) instead of asking the AI.** The scope is always the same — `page`, `expect`, and `agent` are available, `await` is allowed, and `document`/`window` are **not** defined (browser-side state must go through `page.evaluate(() => ...)`). What varies by statement type is the form of the code, the role of the accompanying natural language, and what happens when the JS fails:

| Statement | Natural language is… | `js:` form | When the JS fails | Self-heals at runtime |
|---|---|---|---|---|
| [Code](#48-code) (`description:` + `js:`) | label only | statement block | test fails | No |
| [VERIFY](#43-verify-shorthand) + `js:` | the assertion — AI fallback intent | assertion statement | AI re-evaluates the natural-language assertion | **Yes** |
| [IF](#46-if_else) / [WHILE](#47-while_loop) `"js: ..."` | *(absent)* | single expression | a throw fails the test; falsy just takes the other branch / ends the loop | No |
| [WAIT_UNTIL](#49-wait_until-shorthand) + `js:` | the intent — label + regeneration source (absent in the legacy `"js: ..."` prefix form) | single expression | never fails — warning in the step result, test continues at timeout | No at runtime; regenerate from the intent at authoring time |

**Why only VERIFY falls back to AI:** fallback exists only where failure is detectable at runtime. An assertion *throws* when it is wrong, so the runtime knows to re-check the intent. A wait cannot distinguish "not yet" from "never", and a stale selector can turn a wait predicate truthy instantly — there is no failure signal to fall back on. For waits and conditions, the repair path is authoring-time: fix or regenerate the expression.

---

## 5. Templates

Templates extract reusable statement groups into separate YAML files.

### 5.1 Template File Format

```yaml
params:
  - username
  - password
statements:
  - intent: Enter username
    action: input_text
    locator: "getByPlaceholder('Username')"
    text: "<<username>>"
  - intent: Enter password
    action: input_text
    locator: "getByPlaceholder('Password')"
    text: "<<password>>"
  - intent: Click login
    action: click
    locator: "getByRole('button', { name: 'Log in' })"
```

### 5.2 Using Templates

```yaml
statements:
  - template: ./templates/login.yaml
    params:
      username: admin@test.com
      password: "{{TEST_PASSWORD}}"
  - VERIFY: Dashboard is visible
```

### 5.3 Template Rules

| Rule | Detail |
|---|---|
| Path resolution | Relative to the importing YAML file |
| Required params | All params listed in the template's `params` array must be provided |
| Substitution | `<<paramName>>` in template statements replaced with provided values |
| Nesting | Templates can reference other templates (max depth: **5**) |
| Circular references | Detected and rejected with an error |
| Inlining | Template statements are inlined — the `template:` reference itself is not a statement type |
| Cache invalidation | Changes to template files trigger re-transpilation of importing test files |

---

## 6. Functions

Functions let you call custom TypeScript/JavaScript code from YAML tests. Like templates, functions are a reuse mechanism — but while templates inline YAML statements at compile time, functions import and call code at runtime.

### 6.1 Syntax

```yaml
statements:
  - intent: Greet the user
    call: "helpers/utils.ts#greet_user"
    args: [page, "hello"]
```

The `call` field is all that's needed — no `action: function` required. The transpiler infers it's a function action from the `call` key.

### 6.2 Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `intent` | `string` | Yes | Human-readable intent (used for self-healing). |
| `call` | `string` | Yes | `filePath#exportName` reference. Bare paths (e.g. `helpers/auth.ts`) are resolved relative to the project root; explicitly-relative paths (`./helpers/auth.ts`, `../helpers/auth.ts`) are resolved relative to the YAML file's directory. Absolute paths are rejected with a runtime error. |
| `args` | `string[]` | No | Arguments to pass to the function. Reads like the function's call signature. |

### 6.3 Function File Format

Function names must be **snake_case** (e.g. `clear_cart`, not `clearCart`).

```typescript
// helpers/cart.ts
import { Page } from '@playwright/test';

export async function clear_cart(page: Page): Promise<void> {
  // actual code here
}
```

### 6.4 Argument Value Rules

Each value in `args` is transpiled based on what it looks like:

| Value | Treatment | Example output |
|---|---|---|
| `page`, `request`, `testContext`, `extensionActionPopup` | Passed as the Playwright/system object (unquoted). `extensionActionPopup` requires `use: { extensionDir: "..." }`. | `page` |
| `null`, `undefined`, `true`, `false` | Passed as JavaScript literals | `null` |
| Numeric strings | Passed as numbers | `42` |
| `$variableName` | Resolved from runtime variables | `agent.agentServices.readVariable('variableName')` |
| Anything else | Passed as a quoted string | `"hello"` |

### 6.5 Rules

| Rule | Detail |
|---|---|
| Path resolution | Bare paths (`helpers/auth.ts`) resolve relative to the project root; explicitly-relative paths (`./helpers/auth.ts`, `../helpers/auth.ts`) resolve relative to the YAML file's directory |
| Absolute paths | Rejected with a runtime error — not supported |
| Extension stripping | `.ts`/`.js`/`.mjs` is stripped in the generated import |
| Async | Functions should be `async` — they are always `await`ed |
| Statement type | Parsed as an `ACTION` — not a separate statement type |

---

## 7. Variables

Variables store and reuse dynamic values throughout test execution. They come from pre-defined config or are created dynamically during execution.

### 7.1 Variable Types

| Type | Scope | Description |
|---|---|---|
| Pre-defined | Per-project | Configured in `playwright.config.ts` under `use: { variables: { ... } }`. Loaded at test start. |
| Dynamic | Single test run | Created during execution (e.g., Extract action, `save_variable`, or natural language like "Save the order number to orderId"). Reset each run. |

### 7.2 Configuring Variables

Variables are defined in `playwright.config.ts` in the project's `use` block:

```ts
// playwright.config.ts
export default defineConfig({
  ...shiplightConfig(),
  projects: [{
    name: 'default',
    use: {
      variables: {
        SAUCE_USER: 'standard_user',
        SAUCE_PASS: { value: 'secret_sauce', sensitive: true },
      },
    },
  }],
});
```

Sensitive variables (using `{ value, sensitive: true }`) are masked in logs and screenshots.

### 7.3 Using Variables in YAML

The `{{variableName}}` syntax references a variable. Variables are resolved at runtime — either from the project's pre-defined variables or from values saved during the test run.

```yaml
statements:
  - intent: Enter email
    action: input_text
    locator: "getByPlaceholder('Email')"
    text: "{{userEmail}}"
```

At runtime, `{{userEmail}}` is replaced with the actual value before the action executes.

### 7.4 Template Params vs Runtime Variables

- **Template params** use `<<paramName>>` syntax and are substituted at compile time during template expansion only.
- **Runtime variables** use `{{VAR}}` syntax and are resolved at runtime from the project's variables, parameterized test values, or values saved during the test.
- **Parameterized tests** use `{{VAR}}` syntax (same as runtime variables). Parameter values are set as runtime variables at the start of each test instance.
- The `<<param>>` syntax is reserved for template files only. In all other contexts (including parameterized tests), use `{{VAR}}`.

---

## 8. Teardown

Cleanup statements that execute in a `finally` block, even if the main test fails.

```yaml
goal: Create and verify user
statements:
  - Create a new user named TestUser
  - VERIFY: TestUser appears in the user list
teardown:
  - Delete user TestUser
  - VERIFY: TestUser is removed from the list
```

**Rules:**
- Teardown uses the same statement syntax as `statements` (DRAFT, ACTION, VERIFY, URL, STEP, IF_ELSE, WHILE_LOOP, code (`description:` + `js:`), template).
- Teardown always runs, regardless of test success or failure.
- Teardown is separate from lifecycle hooks (see [Lifecycle Hooks](#10-lifecycle-hooks)).

---

## 9. Test Suites

A suite groups multiple tests in a single file with shared configuration and lifecycle hooks. Suites transpile to a `test.describe()` block.

### 9.1 Suite Structure

```yaml
name: Inventory Browsing Suite
tags: [smoke, suite]

suite:
  tests:
    - name: Sort products by price
      statements:
        - intent: Sort by price low to high
          action: select_dropdown_option
          locator: "getByRole('combobox')"
          option: "Price (low to high)"
        - VERIFY: Products are sorted by price ascending

    - name: View product details
      statements:
        - intent: Click the first product name
          action: click
          locator: "locator('.inventory_item_name').first()"
        - VERIFY: The product detail page is displayed
```

### 9.2 Suite Keys

| Key | Type | Required | Description |
|---|---|---|---|
| `tests` | `SuiteTest[]` | Yes | Array of test definitions (at least one). |
| `base_url` | `string` | No | Alias for the top-level [`base_url`](#optional-keys), written inside `suite:`. Both spellings map to `test.use({ baseURL })`; this one wins if both are present. Prefer the top-level form — the debugger emits this one on save. |
| `beforeAll` | `Statement[]` | No | Runs once before all tests. See [Lifecycle Hooks](#10-lifecycle-hooks). |
| `afterAll` | `Statement[]` | No | Runs once after all tests. |
| `beforeEach` | `Statement[]` | No | Runs before each test. |
| `afterEach` | `Statement[]` | No | Runs after each test. |

### 9.3 Suite Test Keys

| Key | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Test name. Becomes the Playwright `test()` title. |
| `statements` | `Statement[]` | Yes | Ordered list of test steps. |
| `tags` | `string[]` | No | Playwright tags for this test alone, on top of the suite's tags. |
| `teardown` | `Statement[]` | No | Cleanup steps in a `finally` block for this test. |
| `parameters` | `ParameterSet[]` | No | Data sets for parameterized variants. See [Parameterized Tests](#11-parameterized-tests). |
| `timeout` | `number` | No | Per-test timeout in milliseconds. |
| `skip` | `boolean \| string` | No | Skip this test. `true` or a reason string. |
| `fail` | `boolean \| string` | No | Expected failure. `true` or a reason string. |
| `only` | `boolean` | No | Focus: run only this test. |
| `slow` | `boolean` | No | Triple the test timeout. |

### 9.4 Suite Transpilation Notes

- Suites always transpile to `test.describe.serial()` (sequential execution). For parallel tests, use separate test files.
- File-level `tags` go on the describe block as `{ tag: [...] }`; Playwright applies them to every test inside it. A test's own `tags` are added to that test only, and a tag already declared at suite level is not repeated on the test.
- `test.use()` is placed outside the describe block
- Each test gets its own `test()` function with `{ page, agent }` fixtures

### 9.5 Validation Rules

- A file cannot have both `suite` and top-level `goal`/`statements`
- `suite.tests` must be a non-empty array
- Each suite test must have `name` (string) and `statements` (array)

---

## 10. Lifecycle Hooks

> **Note:** `beforeAll`/`afterAll` run without an agent. DRAFT and AI actions are silently skipped.

Hooks run setup/cleanup code around tests. They are available in both single-test and suite files.

### 10.1 Single-Test Hooks

Single-test files support `beforeEach` and `afterEach` at the top level:

```yaml
name: Login test
goal: Verify login flow

beforeEach:
  - URL: https://app.example.com/login

afterEach:
  - URL: https://app.example.com/logout

statements:
  - intent: Enter credentials and submit
  - VERIFY: dashboard is visible
```

### 10.2 Suite Hooks

Suite files support all four hooks inside the `suite` block:

```yaml
name: Cart Management Suite
tags: [e2e, hooks]

suite:
  beforeAll:
    - URL: /inventory.html

  beforeEach:
    - URL: /inventory.html
    - intent: Add item to cart
      action: click
      locator: "locator('[data-test=\"add-to-cart-sauce-labs-backpack\"]')"

  afterEach:
    - intent: Remove item from cart
      action: click
      locator: "locator('[data-test=\"remove-sauce-labs-backpack\"]')"

  afterAll:
    - URL: /inventory.html

  tests:
    - name: Verify cart badge
      statements:
        - VERIFY: The shopping cart badge shows 1 item
```

### 10.3 Hook Fixture Scoping

| Hook | Fixture | Notes |
|---|---|---|
| `beforeEach` | `{ page, agent }` | Same page instance as the test. Full agent available. |
| `afterEach` | `{ page, agent }` | Same page instance as the test. Full agent available. |
| `beforeAll` | `{ browser }` | Worker-scoped. Creates a temporary page via `browser.newPage()`, closes it after hook completes. **No agent available.** |
| `afterAll` | `{ browser }` | Worker-scoped. Creates a temporary page via `browser.newPage()`, closes it after hook completes. **No agent available.** |

### 10.4 beforeAll/afterAll Limitations (noAgent Mode)

Since `beforeAll` and `afterAll` use worker-scoped fixtures without an agent, the following restrictions apply:

- **DRAFT statements** are skipped with a comment (they require the agent)
- **AI actions** (e.g., `verify`) are skipped with a comment
- **Navigation actions** (`go_to_url`, `go_back`, `go_forward`) are transpiled to direct Playwright calls (`page.goto()`, `page.goBack()`, `page.goForward()`)
- **DOM actions** with locators (`click`, `input_text`, `select_dropdown_option`) are transpiled to direct Playwright locator calls

### 10.5 Hook Statement Types

Hook statement arrays use the same syntax as regular `statements`. Templates are expanded in hooks. All statement types (DRAFT, ACTION, VERIFY, URL, STEP, IF_ELSE, WHILE_LOOP, code (`description:` + `js:`), template) are syntactically valid, though DRAFT and AI-based statements are skipped in `beforeAll`/`afterAll`.

---

## 11. Parameterized Tests

Parameters generate multiple test instances from data sets. Each parameter set produces a separate `test()` with its values set as runtime variables. Use `{{variableName}}` syntax in statements to reference parameter values — the same syntax used for runtime variables (see [Variables](#7-variables)).

### 11.1 Single-Test Parameters

```yaml
name: Search and verify product
tags: [e2e, parameterized]

parameters:
  - name: backpack
    values:
      product_name: Sauce Labs Backpack
      expected_price: "$29.99"
  - name: bike light
    values:
      product_name: Sauce Labs Bike Light
      expected_price: "$9.99"

statements:
  - intent: Search for product
    action: input_text
    locator: "getByPlaceholder('Search')"
    text: "{{product_name}}"
  - VERIFY: "{{product_name}} is visible with price {{expected_price}}"
```

### 11.2 Suite Test Parameters

Individual tests within a suite can also have parameters:

```yaml
suite:
  tests:
    - name: Login with role
      parameters:
        - name: admin
          values: { username: admin@test.com }
        - name: editor
          values: { username: editor@test.com }
      statements:
        - intent: "Enter {{username}}"
        - VERIFY: logged in successfully
```

### 11.3 ParameterSet Structure

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Variant name. Appended to test title as `[name]`. |
| `values` | `Record<string, string>` | Yes | Key-value pairs. Keys become runtime variables referenced via `{{key}}`. |

### 11.4 How Parameters Work

- Each parameter set produces a separate test instance
- At the start of each test, parameter values are saved as runtime variables via `agent.agentServices.saveVariable()`
- `{{key}}` placeholders in statements are resolved at runtime from the variable store — the same mechanism used for pre-defined and dynamic variables
- Parameter variables can be overridden by `save_variable` actions during the test, and they coexist with pre-defined variables from `playwright.config.ts`

### 11.5 Validation Rules

- Each parameter set must have `name` (string) and `values` (object)
- `values` must be a non-empty object
- Parameter names should be unique within the `parameters` array

---

## 12. Complete Examples

### 12.1 Single-Test File

```yaml
test_case_id: 303
name: Checkout flow with login
tags: [e2e, checkout, critical]

use:
  storageState: auth/user.json
  viewport: { width: 1280, height: 720 }

goal: Complete checkout for authenticated user

statements:
  # Template: reusable login flow
  - template: ./templates/login.yaml
    params:
      email: "{{TEST_USER_EMAIL}}"
      password: "{{TEST_USER_PASSWORD}}"

  # Assertion
  - VERIFY: Product catalog is visible

  # DRAFT: AI resolves at runtime
  - intent: Click on the first product

  # ACTION: structured format
  - intent: Click Add to Cart
    action: click
    locator: "getByRole('button', { name: 'Add to Cart' })"

  # ACTION: structured format with extra params
  - intent: Enter address
    action: input_text
    locator: "getByPlaceholder('Address')"
    text: 123 Main St

  # STEP: grouped actions
  - STEP: Fill shipping info
    statements:
      - intent: Enter address
        action: input_text
        locator: "getByPlaceholder('Address')"
        text: 123 Main St
      - intent: Select shipping method
        action: select_dropdown_option
        locator: "getByRole('combobox', { name: 'Shipping' })"
        option: Standard Shipping

  # Conditional
  - IF: promo code field is visible
    THEN:
      - intent: Enter promo code
        action: input_text
        locator: "getByPlaceholder('Promo Code')"
        text: SAVE10
      - intent: Click Apply
    ELSE:
      - VERIFY: no promo code field displayed

  # Loop
  - WHILE: there are more items to review
    DO:
      - intent: Scroll down
      - VERIFY: next item is visible
    timeout_ms: 60000

  - intent: Click Place Order
  - VERIFY: Order confirmation page is displayed

teardown:
  - IF: Cancel Order button is visible
    THEN:
      - intent: Click Cancel Order
      - intent: Click Confirm
```

### 12.2 Suite with Hooks

```yaml
name: Cart Management Suite
tags: [e2e, hooks]

suite:
  beforeAll:
    - URL: /inventory.html

  beforeEach:
    - URL: /inventory.html
    - intent: Add Sauce Labs Backpack to cart
      action: click
      locator: "locator('[data-test=\"add-to-cart-sauce-labs-backpack\"]')"

  afterEach:
    - intent: Remove Backpack from cart if present
      action: click
      locator: "locator('[data-test=\"remove-sauce-labs-backpack\"]')"

  afterAll:
    - URL: /inventory.html

  tests:
    - name: Verify cart badge shows item count
      statements:
        - VERIFY: The shopping cart badge shows 1 item

    - name: Verify remove button appears after adding to cart
      statements:
        - VERIFY: A Remove button is visible for Sauce Labs Backpack
```

### 12.3 Parameterized Test

```yaml
name: Search and verify product
tags: [e2e, parameterized]

parameters:
  - name: backpack
    values:
      product_name: Sauce Labs Backpack
      expected_price: "$29.99"
  - name: bike light
    values:
      product_name: Sauce Labs Bike Light
      expected_price: "$9.99"

statements:
  - intent: Search for product
    action: input_text
    locator: "getByPlaceholder('Search')"
    text: "{{product_name}}"

  - intent: Click search button
    action: click
    locator: "getByRole('button', { name: 'Search' })"

  - VERIFY: "{{product_name}} is visible with price {{expected_price}}"
```
