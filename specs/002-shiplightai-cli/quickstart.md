# Quickstart: Validating the shiplightai CLI

## Prerequisites

- Node.js >= 22, pnpm; `pnpm install` at the repo root
- `pnpm --filter shiplightai build` (tsup + the debugger vite builds via `onSuccess`)
- For live lanes: `npx playwright install chromium` and `GOOGLE_API_KEY` or `ANTHROPIC_API_KEY`

## Lane 1 — Deterministic (CI-gated)

```bash
pnpm --filter shiplightai test:unit
```

`tsx --test` over `src/**/*.test.ts`, including the yaml-transpiler suite folded in
from `shiplight-tools`. ~1,000 tests, no browser, no credential.

**Proves**: SC-001 (allowlist + no-bypass wiring), SC-002 (transpilation), SC-003
(inspect, version/global-install guards, dotenv precedence, context options),
SC-006 (strict vs default agree on coverage), SC-008 (single-source guards).

## Lane 2 — Logic (Playwright, no browser)

```bash
pnpm --filter shiplightai test:logic
```

Conformance tests including action-transpiler parity against the engine registry.

## Lane 3 — Browser

```bash
pnpm turbo run test:browser --concurrency=1
```

Debug-server e2e, `shiplight test` with real spawn and exit codes, extension popup.

**Proves**: SC-004 (`create` to a transpilable project, `test`, `debug`). The `install → run` leg is the publish workflow's public-examples gate, not this lane.

## Lane 4 — Release gate: the public examples suite

```bash
cd ~/Shiplight/examples/yaml-examples
npm ci && npm install --no-save /path/to/shiplightai-<version>.tgz
npx playwright install chromium
GOOGLE_API_KEY=... npx shiplight test
```

~37 live-AI browser tests against external sites. This is a **hard gate** in
`publish-cli.yml` and dogfoods the exact tarball users install.

## Scenario checks mapped to the spec

| Check | How to observe |
|---|---|
| US1 — mixed YAML + `.test.ts`, flags forwarded | Lane 3, then Lane 4 |
| US2 — `create` never overwrites; conflicts reported | Lane 1 scaffold tests; `--json` payload for SC-005 |
| US3 — `debug` launches, ports auto-select | Lane 3 debug-server e2e |
| US4 — `shiplightConfig()` wires an existing project | Lane 4 |
| US5 — report / transpile / inspect | Lane 1 |
| US6 — authoring with **no MCP server** | Lane 1 offline authoring test (SC-007) |
| FR-006 — non-allowlisted env invisible | Lane 1 allowlist tests (SC-001) |
| FR-020 — tier fetch failure policy | Lane 1 tier tests (SC-009) |

## Release checks that are not tests

- `shiplight --version` matches `package.json` — bump **before** building.
- Tarball contains `dist/static/assets` and `dist/static-embedded/assets`.
- Tarball size compared to the previous published version; an **increase** needs
  explicit human approval.

## What "green" does not prove

Lanes 1–3 run against fixtures. Only Lane 4 proves the published tarball works in a
user's project against real sites.
