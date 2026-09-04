# Implementation Plan: @shiplightai/mcp UI-Automation Server

**Branch**: `feng/workspace` | **Date**: 2026-08-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-shiplightai-mcp-server/spec.md`

**Note**: Reconstructed from the implementation. `@shiplightai/mcp` ships on npm
today; this plan records what was built and the invariants a change must not break.

## Summary

Give a coding agent a live browser it can hold across turns: open a session,
navigate, inspect, act, and get back replay-ready action entities (FR-001, FR-002).
The server is `apps/mcp-server` — a thin stdio JSON-RPC shell — over
`packages/mcp-tools`, which owns the tools, prompts, resources and session manager.

The organising rule is the **session boundary**: this server owns anything whose
value depends on a page that stays open, and nothing else. Test authoring —
scaffolding, `.test.yaml` validation, transpilation, the YAML language spec —
belongs to 002, because the artifact that validates a test must ship and version
with the artifact that runs it (FR-012). That boundary is enforced by a guard test,
not by review (SC-006).

## Technical Context

**Language/Version**: TypeScript, ESM, Node.js >= 22

**Primary Dependencies**: `@modelcontextprotocol/sdk` (stdio transport), `playwright`, `zod` + `zod-to-json-schema`, the AI SDK provider set, `sharp`, `mammoth`/`pdf-parse`/`html-to-text` for document extraction; `mcp-tools`, `sdk-core` and `shiplight-types` are bundled via tsup `noExternal`

**Storage**: None persistent. Sessions live in memory for the process lifetime; the Chrome relay extension is shipped as files inside the tarball.

**Testing**: `test:unit` for deterministic logic; `packages/mcp-tools/browser-tests` for real-browser tool behaviour; `apps/mcp-server/smoke/` for stdio JSON-RPC over the wire

**Target Platform**: a long-lived stdio child process started by an MCP client (Claude Code, Cursor, and similar)

**Project Type**: MCP server (app) plus a tools library (package)

**Performance Goals**: memory discipline dominates — the process is long-lived, so sessions must be disposed on close (constitution IV). Browser modules load lazily so a non-browser invocation never pays Playwright's start-up.

**Constraints**: **stdout is the JSON-RPC channel** — all logging goes to stderr or the protocol breaks (FR-008). The Chrome relay extension must be present in the tarball (`chrome-extension/` with `manifest.json`, `background.js`, `icons/`); its absence silently shipped once in `0.1.62`.

**Scale/Scope**: `apps/mcp-server` is a 27-file shell; `packages/mcp-tools` is 47 files / ~9.4k lines and has exactly one consumer

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md` v2.0.0.*

| Principle | Status | Evidence |
|---|---|---|
| I. Code Quality & Simplicity | **PASS** | ESM, strict TypeScript. FR-013 is this principle expressed as a requirement: a tool doing no browser work must not drag in the Playwright module graph, and after FR-012's removals that holds by construction. |
| II. Testing Standards | **PASS** | Three lanes with a real browser for tool behaviour and stdio smoke over the wire. SC-006 and SC-007 are guards that must fail on reintroduction, which is the standard this principle asks for. |
| III. User Experience Consistency | **PASS** | Errors are actionable and tool-named — an authoring tool reached in the wrong surface names itself and points at the CLI (FR-012), rather than surfacing a raw failure. |
| IV. Performance Requirements | **PASS** | Memory discipline is the binding clause and sessions are disposed on close (FR-006). Lazy browser imports keep non-browser paths cheap. Constitution 2.0.0 removed the page-load and bundle clauses that never applied to a stdio server. |
| V. Dependency & Code Sharing | **PASS** | `apps/mcp-server` imports only `packages/`; `mcp-tools` imports only `sdk-core` and `shiplight-types`. No app→app edge. `shiplight-tools` was removed from this app's manifest in August 2026 once proven unused. |

**Gate result**: no violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-shiplightai-mcp-server/
└── spec.md, plan.md, research.md, data-model.md, quickstart.md, contracts/, tasks.md
```

### Source Code (repository root)

```text
apps/mcp-server/
├── src/server.ts          # stdio shell; static tool/resource imports, lazy browser imports
├── smoke/                 # stdio JSON-RPC smoke over the wire
└── chrome-extension/      # relay extension, copied from mcp-tools at build time

packages/mcp-tools/
├── src/tools/             # session, browser, relay, debug tool groups
├── src/backends/          # SessionManager, ExtensionRelayServer, election coordinator
├── src/resources/         # action-entity resource, rendered from the live registry
├── src/prompts/           # user-invoked slash commands
└── browser-tests/         # real-browser behaviour lane
```

**Structure Decision**: a deliberately thin app over a substantial package. The split
survives scrutiny because the lazy-import boundary in `server.ts` — the
`await import("mcp-tools")` that keeps Playwright out of start-up until a session opens — is
legible as a package boundary and would be easy to erase accidentally inside one app.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Two packages for one product | The lazy browser-import seam (FR-013) and a separate real-browser test lane both live at that boundary | Folding `mcp-tools` into the app would put ~9.4k lines behind a `require` that must stay dynamic; a future static import would silently reintroduce Playwright into every start-up |
| FR-011 carries an unresolved `[NEEDS CLARIFICATION]` | Whether `PWDEBUG=console` is still required for semantic locator generation is a product question the README asserts but no test pins | Cannot be resolved from the plan — it needs either a test that proves the dependency or a doc correction. Tracked as open work in [tasks.md](./tasks.md) |
