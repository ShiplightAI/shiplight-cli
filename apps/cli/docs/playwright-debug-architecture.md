# Playwright-Bootstrapped Debugger Architecture

## Overview

When `shiplight debug` detects a `playwright.config.ts` in the project, it bootstraps the debugger **inside a Playwright test context**. This gives the debugger automatic access to all Playwright config features (baseURL, storageState, viewport, auth setup projects, etc.) without replicating them.

## Process Architecture

```
Process 1: VS Code Extension
==============================
  - Finds an available port (e.g., 6174)
  - Spawns CLI as child process: shiplight debug test.yaml --port 6174 --no-open
  - Polls http://localhost:6174/api/test-flow until server is ready (120s timeout)
  - Once ready, loads the debugger SPA in a webview panel
  - Webview sends HTTP requests to http://localhost:6174/api/...
      |
      | child process (stdio piped to "Shiplight Debugger" output channel)
      v
Process 2: CLI (shiplight debug)
==================================
  - Resolves YAML file path
  - Calls findPlaywrightConfig() — walks up from YAML dir looking for playwright.config.ts
  - If found:
      - Calls findMatchingProject() — regex-parses config to find project whose testDir contains the YAML
      - Generates a temporary test file: __shiplight_debug__.spec.ts (placed in YAML's directory)
      - Spawns: npx playwright test --headed --grep __shiplight_debug__ --project <name>
      - Waits for child process to exit
  - If not found:
      - Falls back to standalone debugger (LocalSandboxService) — original path
      |
      | child process (stdio: inherit)
      v
Process 3: Playwright Test Runner
====================================
  - Reads playwright.config.ts (baseURL, storageState, projects, etc.)
  - Runs setup projects first (e.g., auth.setup.ts)
      - Performs AI-driven login
      - Saves storageState to .auth/storage-state.json
  - Runs the debug test: __shiplight_debug__.spec.ts
      - Receives `page` and `agent` from the Playwright fixture (shiplightai/fixture)
      - page already has: baseURL, storageState (cookies/localStorage), viewport, locale, etc.
      - Imports shiplightai/debugger-pw
      - Calls startPlaywrightDebugServer({ yamlFilePath, port, page, agent })
          - Creates PlaywrightSandboxService(page, agent)
          - Starts Express server on the specified port
          - Mounts routes: /api/test-flow, /api/int-runner/*, /api/copilot/*
          - Serves static debugger UI files
      - Awaits forever (keeps the test alive until Ctrl+C)
```

## Key Files

| File | Role |
|------|------|
| `apps/cli/src/commands/debug.ts` | Entry point — detects Playwright config, chooses path |
| `apps/cli/src/debugger/playwrightDebug.ts` | Config detection, project matching, temp test generation, spawns Playwright |
| `apps/cli/src/debugger-pw.ts` | Public entry point (`shiplightai/debugger-pw`) — Express server setup |
| `apps/cli/src/debugger/services/playwrightSandbox.ts` | Sandbox wrapping Playwright's page + agent |
| `apps/cli/src/debugger/routes/intRunner.ts` | HTTP routes for execute-action, run-step, etc. |

## Request Flow (when user clicks "Step")

```
Webview (Debugger UI)
    |
    | POST /api/int-runner/execute-action
    | { session, actionEntity, stepId }
    |
    v
Express Server (Process 3, port 6174)
    |
    | intRunner route → sandbox.executeAction()
    |
    v
PlaywrightSandboxService
    |
    |-- stepId === "prelude" && action_name === "js_code"?
    |     YES → skip (Playwright already handles baseURL + auth)
    |     NO  → agent.step(page, () => agent.execAction(...))
    |
    v
WebAgent (from Playwright fixture)
    |
    | Executes action on the Playwright-managed page
    | (page has baseURL, storageState, viewport, etc.)
    v
Browser (Playwright-managed, headed mode)
```

## Prelude Skip

In standalone mode, the prelude is a `js_code` action that navigates to the starting URL:
```js
await page.goto(process.env.PLAYWRIGHT_STARTING_URL || 'https://example.com')
```

In Playwright mode, this is unnecessary because:
- `baseURL` is set in the browser context — relative URLs like `/inventory.html` resolve automatically
- `storageState` is loaded — the browser is already authenticated
- The page may already be navigated by the fixture or setup

`PlaywrightSandboxService.executeAction` skips the prelude by checking:
```typescript
if (actionData.action_name === "js_code" && stepId === "prelude") {
  // If still on about:blank, navigate to baseURL from the prelude code
  return {};
}
```

## Standalone Fallback (Local Sandbox)

When no `playwright.config.ts` is found, the debugger falls back to `LocalSandboxService`, which manages its own browser and runs everything in a single CLI process.

### Process Architecture

```
Process 1: VS Code Extension (or CLI directly)
=================================================
  - Spawns: shiplight debug test.yaml --port 6174 --no-open
      |
      v
Process 2: CLI (single process — everything runs here)
========================================================
  - debug.ts: No playwright.config.ts found → standalone path
  - Creates LocalSandboxService
  - Starts Express server on port 6174
  - Mounts routes: /api/test-flow, /api/int-runner/*, /api/copilot/*
```

### LocalSandboxService Internals

> **Outdated.** This section describes a `LocalSandboxService` that delegated to
> the `web-session` package. Neither exists any more — `apps/cli` now uses
> `PlaywrightSandbox` (`src/debugger/services/playwrightSandbox.ts`) and never
> imported `web-session`. Kept for background until this doc is rewritten.

`LocalSandboxService` owned the full browser lifecycle and delegated to `web-session` managers:

```
LocalSandboxService
├── PortManager            — allocates CDP debug ports (9222+)
├── FileCleanupManager     — tracks temp files for cleanup
├── TestDataManager        — manages test data
├── UserFunctionManager    — manages reusable functions
├── LoginManager           — AI-driven login via agent
├── PageManager            — tracks current page across tabs
├── CodeExecutor           — executes JS code on page
├── ActionExecutor         — executes action entities (uses CodeExecutor)
├── AgentManager           — AI agent for generate/runStep/assert
└── BrowserLifecycleManager — launches browser, handles auth
      └── BrowserManager (sdk-core) — Playwright browser/context creation
```

### Session Lifecycle

1. `createSession()` — lightweight session, no browser yet
   - Calls `BrowserLifecycleManager.createLightweightSession()`
   - `apiClient.prepareLogin()` checks for storageState (`findStorageState`) or returns loginConfig for AI login
   - Stores `browserInitData` for deferred browser launch
2. `executeLogin()` — launches browser + performs login
   - Calls `ensureBrowser()` → `BrowserLifecycleManager.initializeBrowser()`
   - `BrowserManager.launchBrowser({ localStorageStatePath, headless: false, debugPort })`
   - `browser.newContext({ storageState, ... })` — loads cookies/localStorage
   - If `session.loginConfig` exists → `LoginManager.executeLogin()` (AI-driven)
   - If no loginConfig (storageState mode) → navigates to starting URL, skips AI login
3. `startDebug()` — returns session/browser connection info
4. `executeAction()` — `ActionExecutor.execute()` on the session
5. `runStep()` — `AgentManager.runStep()` (AI-driven, streaming)
6. `evaluate()` — `AgentManager.assertStatement()`
7. `generateAction()` — `AgentManager.generateAction()`
8. `terminateSession()` — cleanup browser, copilot, temp files

### Key Files

| File | Role |
|------|------|
| `apps/cli/src/debugger/services/localSandbox.ts` | Full sandbox with browser lifecycle |
| `apps/cli/src/debugger/index.ts` | Express server setup for standalone mode |
| `packages/web-session/src/managers/` | Session managers (browser, login, agent, etc.) |
| `packages/sdk-core/src/browser/browserManager.ts` | Browser/context creation via Playwright API |

### Comparison

| | Local Sandbox | Playwright-Bootstrapped |
|---|---|---|
| Browser management | `BrowserManager` creates/owns browser | Playwright test runner owns browser |
| Auth | `LoginManager` (AI login) or storageState | Playwright setup project |
| baseURL | Not supported (URLs must be absolute) | From `playwright.config.ts` |
| Viewport/locale | Hardcoded defaults | From `playwright.config.ts` |
| Process count | 2 (VS Code + CLI) | 3 (VS Code + CLI + Playwright) |
| Server location | CLI process (Process 2) | Playwright test process (Process 3) |
| Copilot | Fully supported | Stubs (not supported yet) |
| Startup time | ~5s (browser launch + optional AI login) | ~30s (auth setup + browser + server) |

## Temp File Cleanup

The generated `__shiplight_debug__.spec.ts` is deleted in a `finally` block after the Playwright test exits, whether it succeeds or fails.
