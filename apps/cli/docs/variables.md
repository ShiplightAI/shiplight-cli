# Variables

Variables let you store, pass, and reuse values across test steps. A single **VariableStore** backs every access path described below, so a variable set in one place is immediately visible everywhere else in the same test.

## Declaring initial variables

Seed variables in `playwright.config.ts` via the `use.variables` option. They are loaded into the VariableStore before the first test step runs.

```ts
// playwright.config.ts
import { defineConfig, shiplightConfig } from 'shiplightai';

export default defineConfig({
  ...shiplightConfig(),
  projects: [
    {
      name: 'default',
      use: {
        variables: {
          baseUrl: 'https://staging.example.com',
          adminEmail: 'admin@example.com',
          // Mark sensitive values — they are masked in reports and logs
          adminPassword: { value: 'secret123', sensitive: true },
        },
      },
    },
  ],
});
```

## Using variables in YAML

### Placeholder substitution — `{{ }}`

Actions that accept text (`input_text`, `go_to_url`, `set_date_for_native_date_picker`, `generate_2fa_code`) automatically replace placeholders before execution. No extra syntax needed.

Supported formats (all equivalent):

| Format          | Example            |
| --------------- | ------------------ |
| `{{ varName }}` | `{{ adminEmail }}` |
| `{{varName}}`   | `{{adminEmail}}`   |

```yaml
statements:
  - action: input_text
    locator: '#email'
    text: '{{ adminEmail }}'

  - action: input_text
    locator: '#password'
    text: '{{ adminPassword }}'

  - action: go_to_url
    url: '{{ baseUrl }}/dashboard'
```

> **Tip:** Wrap `{{ }}` values in quotes in YAML. Unquoted `{{VAR}}` is parsed by YAML as a flow mapping and will produce incorrect results.

### Saving variables — `save_variable` action

The AI agent can save values during test execution. Use the `save_variable` action to capture runtime values for later use.

```yaml
statements:
  - Save the displayed order ID into a variable called orderId
  - action: save_variable
    name: orderId
    value: 'ORD-12345'
```

The `$` prefix on the name is optional — `$orderId` and `orderId` are treated identically.

### Reading variables in function calls — `$` prefix

When calling custom functions, prefix an argument with `$` to pass a variable value instead of a literal string.

```yaml
statements:
  - action: function
    call: helpers/auth.ts#loginUser
    args: ['$adminEmail', '$adminPassword']
```

This transpiles to:

```ts
await loginUser(agent.agentServices.readVariable('adminEmail'), agent.agentServices.readVariable('adminPassword'));
```

### Conditions (IF / WHILE) — `js:` with `readVariable`

Use `js:` prefix in conditions to write JavaScript expressions that read variables:

```yaml
statements:
  - IF: "js:(await agent.agentServices.readVariable('isLoggedIn')) === 'true'"
    THEN:
      - VERIFY: Dashboard is visible

  - WHILE: "js:(await agent.agentServices.readVariable('retryCount')) !== 'done'"
    body:
      - Click retry button
```

Without the `js:` prefix, the condition is evaluated by the AI agent as a natural-language question.

## Using variables in JS code blocks

YAML `js:` blocks execute as inline JavaScript within the Playwright test context. Three global aliases point to the same TestContext object:

- **`$`** — shortest, most common
- **`ctx`** — alternative alias
- **`testContext`** — fully explicit

### Read and write with property access

```yaml
- description: 'Set up test data'
  js: |
    $.username = 'alice@example.com';
    $.token = 'abc-123';
```

```yaml
- description: 'Use saved data'
  js: |
    const email = $.username;
    await page.getByLabel('Email').fill(email);
```

### Read and write with methods

```yaml
- description: 'Store a sensitive token'
  js: |
    ctx.set('apiToken', response.headers['x-auth-token'], true);
```

```yaml
- description: 'Read and assert'
  js: |
    const token = ctx.get('apiToken');
    console.log('Token exists:', ctx.has('apiToken'));
```

### Available TestContext API

| Method / Property               | Description                                                |
| ------------------------------- | ---------------------------------------------------------- |
| `$.varName`                     | Read a variable (property access)                          |
| `$.varName = value`             | Write a variable (property access)                         |
| `$.get(key)`                    | Read a variable (method)                                   |
| `$.set(key, value, sensitive?)` | Write a variable, optionally mark as sensitive             |
| `$.has(key)`                    | Check if a variable exists (also works with `in` operator) |
| `$.getAll()`                    | Get all variables as a plain object                        |

### Using variables in VERIFY blocks

```yaml
- VERIFY: 'User email is displayed'
  js: |
    const email = $.adminEmail;
    await expect(page.getByText(email)).toBeVisible();
```

The `js:` code runs first. If it passes, the step succeeds immediately. If it throws, the AI agent takes over and evaluates the VERIFY statement as a fallback.

## Parameters (data-driven tests)

Parameters use `{{paramName}}` syntax — the same as regular variables — and are resolved **at runtime**. Each parameter set generates a separate Playwright test, with the parameter values injected as runtime variables via `saveVariable()` at the start of the test.

```yaml
name: Login test
parameters:
  - name: admin
    values:
      email: admin@example.com
      password: admin-pass
  - name: viewer
    values:
      email: viewer@example.com
      password: viewer-pass

statements:
  - action: input_text
    locator: '#email'
    text: '{{email}}'
  - action: input_text
    locator: '#password'
    text: '{{password}}'
  - action: click
    locator: button[type="submit"]
```

This generates two Playwright tests: `Login test [admin]` and `Login test [viewer]`. Each test begins with `saveVariable()` calls that set the parameter values, and `{{email}}`/`{{password}}` are resolved at runtime from the VariableStore.

### Parameters vs other variables

Parameters are regular variables scoped to a test. The only difference is their source: they come from the `parameters:` block in YAML rather than `use.variables` in config or `save_variable` actions. They use the same `{{paramName}}` syntax and are resolved at the same time (runtime).

## Template parameters

Templates combine `<<param>>` substitution with reusable YAML files:

```yaml
# templates/login.yaml
params:
  - username
  - password
statements:
  - action: input_text
    locator: '#email'
    text: '<<username>>'
  - action: input_text
    locator: '#password'
    text: '<<password>>'
  - action: click
    locator: button[type="submit"]
```

```yaml
# my-test.test.yaml
statements:
  - template: ./templates/login.yaml
    params:
      username: '{{ adminEmail }}'
      password: '{{ adminPassword }}'
  - VERIFY: Dashboard is visible
```

Here `<<username>>` is replaced at transpile time with the literal string `{{ adminEmail }}`, which is then resolved at runtime from the VariableStore.

## Sensitive variables

Variables marked as sensitive are masked in reports, logs, and the debugger UI.

```ts
// In playwright.config.ts
variables: {
  password: { value: 'secret', sensitive: true },
}
```

```yaml
# In JS code blocks
- description: 'Save sensitive token'
  js: |
    $.set('authToken', tokenValue, true);
```

## Variable scope

- Variables are **scoped to a single test**. Each `test()` block gets a fresh VariableStore.
- Variables set in `beforeEach` hooks are available in the test body.
- The agent and TestContext share the same VariableStore instance, so `save_variable` actions and `$.set()` calls are immediately visible to each other.
