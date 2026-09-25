# shiplightai

AI-powered end-to-end testing for Playwright. Write tests as YAML with natural-language steps, run them alongside your existing `.test.ts` files, get self-healing locators and a visual debugger. One package ships both the `shiplight` CLI and the library you wire into `playwright.config.ts`.

**Full documentation: [docs.shiplight.ai](https://docs.shiplight.ai)**

## Quick start

Scaffold a new test project in under a minute:

```bash
npx shiplightai@latest create ./my-tests
cd my-tests
cp .env.example .env
$EDITOR .env                        # required: every key in the template is commented out
npm install
npx playwright install chromium
npx shiplight test                  # runs the scaffolded starter test
```

> Any one provider key works — `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`,
> `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` together with `WEB_AGENT_MODEL`.
> Without one, `shiplight test` exits with `No AI model configured`.
> `SHIPLIGHT_API_TOKEN` also works today but stops on **October 31, 2026**,
> when Shiplight Cloud shuts down.

The scaffolder writes `package.json`, `playwright.config.ts`, `.env.example`, `.gitignore`, and a runnable `tests/example.test.yaml` that exercises a live site. Open `shiplight-report/index.html` after the run to see per-step screenshots, videos, and traces.

Or add Shiplight to an existing Playwright project:

```bash
npm install shiplightai
```

## CLI

Every command is invoked via `npx shiplight <command>` from inside a project that has `shiplightai` installed.

| Command                      | Purpose                                                                                                                                                                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shiplight setup-api-token`  | **Retiring October 31, 2026** — authenticate with Shiplight and write `SHIPLIGHT_API_TOKEN` to the current project's `.env`. Use a provider API key instead; see [self-hosting](./docs/self-hosting.md)                                                                                                                                                                                       |
| `shiplight create <path>`    | Scaffold a new test project                                                                                                                                                                                                                                                       |
| `shiplight test [args]`      | Run your YAML and Playwright test suite (forwards all Playwright flags)                                                                                                                                                                                                           |
| `shiplight debug <file>`     | Launch the interactive visual debugger for a YAML test. The server picks a free port automatically; the chosen URL is printed on startup. Pass `--port N` for a stable URL (CI, bookmarks). Multiple concurrent `shiplight debug` invocations work without any port coordination. |
| `shiplight report [folder]`  | Regenerate or merge HTML reports                                                                                                                                                                                                                                                  |
| `shiplight transpile [glob]` | Transpile YAML tests to `.yaml.spec.ts` (usually automatic). `--strict` fails while statements are still unenriched drafts (no captured `action`/`js`)                                                                                                                            |
| `shiplight spec <topic>`     | Print an authoring reference: `yaml` (the test language spec) or `actions` (every action and its parameters)                                                                                                                                                                      |

Full reference with flags, options, and troubleshooting: **[docs.shiplight.ai/local/cli-reference](https://docs.shiplight.ai/local/cli-reference)**.

## Library

Wire up YAML support and the Shiplight reporter in `playwright.config.ts`:

```ts
import { defineConfig, shiplightConfig } from 'shiplightai';

export default defineConfig({
  ...shiplightConfig(),

  testDir: './tests',
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
});
```

`shiplightConfig()` returns a partial Playwright config that wires in YAML transpilation, auto-discovered `.env` files, and the HTML reporter. Spread it into your own `defineConfig` and override whatever you need.

### Chrome extensions

Point `extensionDir` at an unpacked extension. Use Playwright's standard
`launchOptions.args` for test-only Chromium switches, including capture-source
selection flags:

```ts
export default defineConfig({
  ...shiplightConfig(),
  use: {
    extensionDir: './dist',
    headless: false,
    launchOptions: {
      args: ['--auto-select-screen-capture-source'],
    },
  },
});
```

Playwright does not include a Chrome action popup in `context.pages()`. Import
Shiplight's `test` fixture and request `extensionActionPopup` to open the real
toolbar popup and receive it as a standard Playwright `Page`:

```ts
import { test, expect } from 'shiplightai/fixture';

test('starts from the real extension popup', async ({ extensionActionPopup }) => {
  await extensionActionPopup.getByRole('button', { name: 'Start recording' }).click();
});
```

This requires Chrome 127 or newer because it uses `chrome.action.openPopup()`.
The extension/profile/debugging transport switches remain fixture-owned and
cannot be overridden through `launchOptions.args`.

For the YAML statement language, authentication, variables, templates, and custom functions: **[docs.shiplight.ai/local](https://docs.shiplight.ai/local/yaml-tests)**.

## Environment variables

Set at least one provider API key in `.env` before running tests:

```
GOOGLE_API_KEY=...
# or ANTHROPIC_API_KEY=sk-ant-...
# or OPENAI_API_KEY=sk-...
# or OPENROUTER_API_KEY=sk-or-v1-...  # also set WEB_AGENT_MODEL=openrouter:<provider>/<model>
```

> **Shiplight Cloud shuts down on October 31, 2026.** After that date
> `SHIPLIGHT_API_TOKEN` stops working — the hosted LLM proxy, the cloud action
> cache, and report upload all go with it. Set a provider API key instead and
> keep the action cache local: see [self-hosting](./docs/self-hosting.md).

The AI model is auto-selected from the first key set. Override with `WEB_AGENT_MODEL=<model>`.
OpenRouter requires an explicit upstream-qualified model, for example
`WEB_AGENT_MODEL=openrouter:openai/gpt-4o`.

Shiplight uses an **explicit env var allowlist**: only the vars it forwards into its internal SDK config are accessible to the agent. Any env var not on the list is invisible to the SDK by design. Full list (`OPENAI_BASE_URL`, Vertex AI routing, Mailgun keys, etc.): **[docs.shiplight.ai/local/cli-reference#environment-variables](https://docs.shiplight.ai/local/cli-reference)**.

## Telemetry

The CLI sends one anonymous event per invocation: the subcommand name (`test`,
`debug`, …), the CLI version, your OS, CPU architecture, Node version, and
whether the run looks like CI. Nothing else — no arguments, file paths, URLs,
test content, or account data. Commands we do not ship are reported as
`unknown` rather than by name, so a mistyped path never leaves your machine.
Runs are grouped by a one-way SHA-256 hash of host, user, platform and
architecture; the inputs to that hash are never transmitted.

Opt out with either:

```
SHIPLIGHT_TELEMETRY=0
DO_NOT_TRACK=1
```

## Requirements

- **Node.js >= 22**
- **`@playwright/test` 1.60.0** — declared as a peer dependency and installed automatically by `npm install`
- **Chromium** — install on demand with `npx playwright install chromium`

## Links

- **Documentation:** [docs.shiplight.ai](https://docs.shiplight.ai)
- **VS Code extension:** [github.com/ShiplightAI/vscode-extension](https://github.com/ShiplightAI/vscode-extension)
- **Cloud platform:** [shiplight.ai](https://www.shiplight.ai) — shutting down October 31, 2026
