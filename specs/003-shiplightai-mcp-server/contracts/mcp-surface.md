# Contract: MCP Server Surface

Published as `@shiplightai/mcp`; MCP clients depend on these.

## C1 — Transport

- stdio JSON-RPC. **stdout carries the protocol and nothing else** (FR-008).
- Logging goes to stderr; EPIPE is handled; throwables are formatted safely.

## C2 — Session lifecycle

- `new_session` → active session; `close_session` disposes it.
- Sessions are isolated and independently closable (FR-006).
- Operations on a closed session fail clearly.
- `generate_html_report` accepts only a **closed** session id.

## C3 — Located actions are replay-ready

Every located action returns `locator`, `xpath` and `frame_path` sufficient to author
a deterministic `.test.yaml` statement (FR-002). This server does not transpile or
validate that YAML — that is 002's transpiler.

## C4 — The session-bound boundary

The registered tool surface MUST contain no tool that performs project scaffolding,
`.test.yaml` validation, or YAML→spec transpilation (FR-012). Enforced by a guard that
must fail on reintroduction (SC-006).

Corollary (FR-013): a tool doing no browser work MUST NOT require the
Playwright/session module graph to initialize.

## C5 — Single-source rendering

- The action-entity resource is generated from the live registry (FR-014) and renders
  every action in it and no others (SC-007).
- It documents only what this server produces and points at `npx shiplight spec yaml`
  for the YAML contract (FR-015).
- `ActionEntity` has exactly one authored definition, in `packages/types` (FR-016).

## C7 — Packaging invariants

- The tarball MUST contain `chrome-extension/` with `manifest.json`, `background.js`
  and `icons/`. Its absence silently shipped in `0.1.62` and breaks
  `--chrome-extension-path`.
- `mcp-tools` is bundled via tsup `noExternal`, so **`mcp-tools` must be rebuilt
  before `mcp-server`** — the server bundles its `dist`, not its source. A ~30ms
  build is the tell that nothing was picked up.
