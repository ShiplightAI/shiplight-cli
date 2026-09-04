# Quickstart: Validating the MCP Server

## Prerequisites

- Node.js >= 22, pnpm; `pnpm install` at the repo root
- Build the chain in order — the server bundles `mcp-tools`' **dist**, not its source:

```bash
pnpm --filter sdk-core build && pnpm --filter mcp-tools build && pnpm --filter @shiplightai/mcp build
```

A ~30ms `mcp-server` build means nothing was picked up; rebuild `mcp-tools` first.

- For browser lanes: `npx playwright install chromium`

## Lane 1 — Deterministic (CI-gated)

```bash
pnpm --filter mcp-tools test:unit
pnpm --filter @shiplightai/mcp test:unit
```

**Proves**: SC-005 (stdio integrity, relay CDP target
management, reference resolution, registration completeness), SC-006 (the
session-bound guard), SC-007 (resource matches the live registry).

## Lane 2 — Real browser

```bash
pnpm turbo run test:browser --concurrency=1
```

`packages/mcp-tools/browser-tests` drives the tools against real Chromium.

**Proves**: SC-001 (navigate / inspect / get_locators / get_page_info / act-click),
SC-002 (create→use→close and two-session isolation), SC-003 (a located action carries
a usable locator or xpath plus frame path).

## Lane 3 — stdio smoke over the wire

```bash
pnpm --filter @shiplightai/mcp test
```

`apps/mcp-server/smoke/` speaks JSON-RPC to the built server. This is the lane that
catches a stray `console.log` on stdout, which no unit test will.

## Scenario checks mapped to the spec

| Check | How to observe |
|---|---|
| US1 — an agent verifies a UI change | Lane 2 |
| US2 — isolation and cleanup | Lane 2, two-session test (SC-002) |
| US3 — replay-ready entities | Lane 2 (SC-003) |
| US5 — attach to existing Chrome | Lane 1 relay tests; manual with `--chrome-extension-path` |
| FR-012 — no authoring tools registered | Lane 1 guard (SC-006) |
| FR-013 — no Playwright graph for non-browser tools | Lane 1 |

## Manual check: the relay extension

```bash
tar -tzf shiplightai-mcp-<version>.tgz | grep chrome-extension | head
```

Must list `manifest.json`, `background.js` and `icons/`. This silently regressed in
`0.1.62`; `--chrome-extension-path` points at nothing without it.

## What "green" does not prove

FR-011 (`PWDEBUG=console` required for semantic locator generation) is asserted by the
README and pinned by no test. Green lanes do not tell you whether locator quality
degrades without it — see research D6.
