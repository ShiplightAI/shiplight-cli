# Test Spec: @shiplightai/mcp UI-Automation Server

**Scope**: `feature`
**Source material**:
- [Feature spec](../../specs/003-shiplightai-mcp-server/spec.md)
- [Project map feature entry](../../project-map.yaml)
- [Published package README](../../apps/mcp-server/README.md)
- `apps/mcp-server`, `packages/mcp-tools`
**Quality policy**: [../../TESTING.md](../../TESTING.md)
**Test report**: [test-report.md](./test-report.md)

This file defines the durable testing contract for the published `@shiplightai/mcp`
server: the stdio MCP host (`apps/mcp-server`) and the tool registry, backends, and
resources (`packages/mcp-tools`) that expose the shared engine (001) to a coding
agent. It describes what must be trusted about the server and which proof strategies
are worth buying.

## Testing What

### Product Behaviors

- The browser tools (`new_session`, `navigate`, `inspect_page`, `get_locators`,
  `get_page_info`, `act`) drive a real Playwright-backed page so a coding agent can
  open a page, read its actionable elements, act by element index, and assert.
- Every located action returns replay-ready action-entity data (`locator`, `xpath`,
  `frame_path`) an agent embeds into `.test.yaml` statements it authors with the CLI
  (002); this server is the only place that payload can be produced.
- The relay extension lets the server attach to existing Chrome tabs over CDP.
- The registered tool surface is session-bound: no scaffolding, `.test.yaml`
  validation, or YAML→spec transpilation tools. Those are `shiplightai` CLI commands
  (002) so the artifact that validates a test is the one that runs it.

### Implementation / System Invariants

- Sessions are isolated (distinct ids/pages), independently closable, and operations
  on a closed session fail clearly.
- The registered tool surface stays session-bound (a standing guard, not a one-time
  cleanup); TestFlow ↔ YAML conversion is 002's transpiler contract now.
- All server logging goes to stderr; the JSON-RPC stdio channel stays clean (EPIPE
  handled, throwables formatted safely, zero stray stdout bytes).
- Local `template:`/`call:` references resolve with `<<param>>` injection escaping,
  circular-reference detection, and required ids.
- Tool registration is complete (every tool definition has a backing handler) and
  unknown tools error.
- Environment matching by URL is exact (no cross-domain or prefix bleed).
- `new_session` input is validated (viewport, emulation, color scheme, geolocation,
  locale); legacy fields stripped.
- MCP resource URIs resolve, including legacy versioned aliases — EXCEPT
  `shiplight://yaml-test-spec` (and its `-v1.3.0` alias), which MUST no longer
  resolve: the YAML language spec ships in the CLI (`npx shiplight spec yaml`).
- The action-entity resource is generated from the live action registry, documents
  only what this server produces, and references no removed tool or resource.
- The registry's tool↔method mapping is single-sourced: the reverse map is derived
  from the forward map, and neither names an authoring tool.

### Risk-Based Behaviors

- The browser tools are the product surface; a broken handler fails silently until a
  user runs the MCP, so they need real-browser proof in a CI gate.
- The server holds no user credential and makes no outbound call on a user's behalf;
  a cloud tool reappearing must fail a test.
- The action-entity resource documents exactly what the registry supports; drift
  must fail a test rather than become stale documentation an agent trusts.
- The bundled relay extension must reach the published tarball; its absence shipped
  silently once and only manual inspection caught it.
- Reintroducing an authoring tool (tool list OR registry mapping OR resource prose)
  must fail a test, not wait for a reviewer to remember the boundary.

### Operational / Release Behaviors

- Release-critical and P1 logic has at least one deterministic `pr-ci` gate.
- The browser tools, session lifecycle, and log capture are exercised by a keyless
  `test:browser` lane that runs in CI (no secrets required).
- The live `act(verify)` → LLM path is validated locally and self-skips in CI.

### Stakeholder Confidence Goals

- A coding agent can drive a browser through the MCP and trust each tool actually
  acts on the page.
- The server can ship holding no user credential, with the relay extension actually
  present in the tarball and the action docs matching the code that serves them.
- Release reviewers can separate gated structural/behavioral proof from the deferred,
  key- or load-dependent residuals.

## Evidence Strategy

| What | Risk | Viable How | Selected How | Why | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| Browser tools drive a real page | The product breaks silently | unit, e2e | real-browser e2e (`test:browser`) | schema checks can't prove a handler acts; only a real page can | live `act(verify)` self-skips in CI (no key) |
| Session isolation + teardown | Stale sessions, cross-contamination | e2e | concurrency/isolation browser e2e | needs real browser contexts to prove independence | timeout auto-cleanup not exercised |
| Action-entity replay payload | Captured-as-test promise fails | e2e | browser-lane locator/xpath assertions | only a live page can prove the payload is usable | roundtrip itself is 002's evidence now |
| Session-bound tool surface | Authoring tools quietly return | unit | surface guard + registry-map guard (negative-tested) | the registered surface and mapping tables are deterministic | a new non-browser tool type needs a new guard row |
| Registry↔resource parity | Agents read stale action docs | unit | bidirectional parity guard + named exclusion list | both sides are in-process and deterministic | a registry entry added and excluded in one change still passes |
| Relay-extension packaging | `--chrome-extension-path` points at nothing | unit | manifest/background/icons assertions on source, manifest `files`, and built output | the tarball contract is a filesystem fact | does not pack a tarball; asserts the inputs to it |
| Chrome relay CDP attach | Headline attach feature breaks | unit | loopback-WS relay unit + reconnect | a real WS server pins register/connect/recover | sustained high-concurrency soak unstressed |
| Stdio integrity | Corrupts JSON-RPC, hangs agent | unit | guard + install-pattern unit | zero-stdout-bytes is deterministic and cheap | live MCP-SDK transport smoke not run |
| Local reference resolution | Injection / cycle corrupts a flow | unit | resolver unit (escape + cycles) | escaping/cycle logic is deterministic | path-traversal/abs/Windows cases not added |
| Resource content correctness | Agents follow pointers to removed tools | unit | resource content unit (no removed surfaces; authoring pointer present) | generated content is deterministic | prose quality beyond removed-name checks is unasserted |
| Tool registry dispatch/completeness | Agent silently loses a capability | unit | registry + completeness unit | dispatch is deterministic; completeness guards the table | completeness checks names, not behavior |
| Env URL matching | Wrong environment (prod vs staging) | unit | matcher unit | exact-match logic is deterministic | none significant |
| Console/network log capture | Blunts advertised debugging value | e2e | browser-lane assertion | needs a real page to emit logs | size-limit/truncation not asserted |
| `new_session` schema | Confusing session-start failures | unit | schema unit | input validation is deterministic | options-take-effect proven only via lifecycle |
| MCP resource URIs | Agents lose schema context / stale spec served | unit | resolver unit incl. negative (yaml-test-spec must not resolve) | URI mapping is deterministic | none significant |

## Scope

- User stories covered:
  `User Story 1`, `User Story 2`, `User Story 3`, `User Story 5`
  (`User Story 4` removed with the cloud surface)
- Primary requirements covered:
  `FR-001`, `FR-002`, `FR-003`, `FR-006`, `FR-008`, `FR-010`–`FR-016`
  (`FR-007` moved to 002 as `FR-018`; `FR-009` moved to 002 as `FR-022`;
  `FR-004`/`FR-005` removed with the v1 cloud surface)
- Success criteria covered:
  `SC-001`, `SC-002`, `SC-003`, `SC-005`, `SC-006`, `SC-007`
  (`SC-004` removed with the cloud surface it gated)
- Implementation/system invariants covered:
  session isolation, stdio integrity, registry completeness, registry↔resource
  parity, new_session schema, resource URIs, relay-extension packaging
- Out of scope:
  the shared engine internals (owned by `001`); the CLI surface AND the entire
  authoring boundary — scaffolding, `.test.yaml` validation, transpilation, the
  YAML language spec, `spec yaml`/`spec actions`, and `template:`/`call:`
  resolution (all owned by `002`); and staging/prod observations. The v1 cloud
  surface is gone, not deferred: its tools, the `testflow-json` resource, and the
  tests that covered them were removed in `736d9e973`.

## Test Cases

### 003-SHIPLIGHTAI-MCP-T01 Browser Tools Drive A Real Page

- Testing what:
  `new_session`/`navigate`/`inspect_page`/`get_locators`/`get_page_info`/`act` drive
  a real Playwright-backed page; `act(verify)` evaluates an assertion when a key is
  present.
- User stories:
  `User Story 1`
- Requirements:
  `FR-001`
- Success criteria:
  `SC-001`
- Preconditions:
  - Required data:
    a local fixture site and an installed Chromium
  - Required external services:
    none for the deterministic tools; a provider key only for `act(verify)`
- Automated checks:
  ```bash
  pnpm --filter mcp-tools test:browser
  ```
- Steps:
  1. Run the browser lane: `new_session` → `get_page_info` → `inspect_page` →
     `get_locators` → `act(click)` against the fixture and assert real page state.
  2. Observe `act(verify)` runs live locally and self-skips without a key.
- Optional stronger evidence:
  - Browser / UI automation:
    a keyed CI job that exercises `act(verify)` against a fixture page
- Pass criteria:
  - Each tool acts on the real page; `act(click)` navigates; results report success.
- Cleanup:
  - the lane closes sessions and tears down browsers
- If not executable:
  - Mark `BLOCKED` if Chromium is unavailable.

### 003-SHIPLIGHTAI-MCP-T02 Session Isolation And Teardown

- Testing what:
  Concurrent sessions have distinct ids/pages; closing one does not affect the other;
  operations on a closed session fail.
- User stories:
  `User Story 2`
- Requirements:
  `FR-006`
- Success criteria:
  `SC-002`
- Preconditions:
  - Required data:
    a local fixture site and an installed Chromium
- Automated checks:
  ```bash
  pnpm --filter mcp-tools test:browser
  ```
- Steps:
  1. Open two sessions at different pages and assert distinct ids and independent
     pages.
  2. Close one; assert the other still works and operations on the closed one fail.
- Optional stronger evidence:
  - Integration:
    a fast-timeout SessionManager test asserting idle sessions are auto-reaped
- Pass criteria:
  - Sessions are isolated and independently torn down.
- Cleanup:
  - the lane closes all sessions
- If not executable:
  - Mark `BLOCKED` if the browser lane cannot run.

### 003-SHIPLIGHTAI-MCP-T03 Sessions Yield Replay-Ready Action Entities

- Testing what:
  A located action performed against a real page returns an entity carrying a usable
  Playwright locator (or xpath) plus any frame path — the payload an agent embeds
  into `.test.yaml` statements so they replay deterministically. (The TestFlow↔YAML
  roundtrip itself moved to 002 with the transpiler; see 002 FR-018.)
- User stories:
  `User Story 3`
- Requirements:
  `FR-002`
- Success criteria:
  `SC-003`
- Preconditions:
  - Required data:
    a local fixture site and an installed Chromium
- Automated checks:
  ```bash
  pnpm --filter mcp-tools test:browser
  ```
- Steps:
  1. Drive a located action (e.g. `act(click)` by element index) against the fixture.
  2. Assert the returned action entity carries a locator (or xpath) and frame path,
     and that `get_locators` reports the same element consistently.
- Optional stronger evidence:
  - Integration:
    author a YAML statement from the captured payload and validate it with
    `npx shiplight transpile --strict` (002's command) — proving the cross-feature
    handshake end to end
- Pass criteria:
  - The returned payload is sufficient to write an enriched ACTION statement.
- Cleanup:
  - the lane closes sessions and tears down browsers
- If not executable:
  - Mark `BLOCKED` if the browser lane cannot run.


### 003-SHIPLIGHTAI-MCP-T05 Infrastructure Integrity: Relay, Stdio, References, Registry, Env, Resources, Logs, Schema, File I/O

- Testing what:
  The chrome-extension CDP relay (incl. reconnect), stdio cleanliness, local
  tool-registry dispatch/completeness, registry↔resource parity, MCP resource
  URIs, console/network log capture, and `new_session` schema all behave as
  specified.
- User stories:
  `User Story 5`
- Requirements:
  `FR-003`, `FR-008`, `FR-010`, `FR-014`
- Success criteria:
  `SC-005`
- Preconditions:
  - Required data:
    a loopback WS server (relay), sample references, sample URLs, sample resource
    URIs, and a fixture page (log capture)
- Automated checks:
  ```bash
  pnpm --filter mcp-tools test:unit
  cd apps/mcp-server && pnpm test:unit
  pnpm --filter mcp-tools test:browser
  ```
- Steps:
  1. Run the relay, resolver, registry, env-match, resource, schema, and file-I/O
     unit suites (mcp-tools) and the stdio-guard suite (mcp-server).
  2. Run the browser lane's log-capture assertion (console marker + network entries).
- Optional stronger evidence:
  - Script / static:
    a relay soak test; an end-to-end stdio transport smoke with the real MCP SDK;
    path-traversal/abs/Windows reference cases
- Pass criteria:
  - Each infrastructure invariant is proven by a deterministic gated assertion (relay
    and log capture via the browser lane).
- Cleanup:
  - none beyond lane teardown
- If not executable:
  - Mark `BLOCKED` if a lane cannot run.

### 003-SHIPLIGHTAI-MCP-T06 Session-Bound Surface And Resource Guards

- Testing what:
  The registered tool surface exposes no authoring tool (scaffold/validate/export) in
  the tool lists OR the registry mapping tables; the reverse tool↔method map is
  derived, not hand-written; the yaml-test-spec resource (and legacy alias) no longer
  resolves; the action-entity resource references no removed surface and points
  authoring at the CLI. These are standing guards — they must fail on reintroduction.
- User stories:
  `User Story 3`
- Requirements:
  `FR-012`, `FR-013`, `FR-014`, `FR-015`, `FR-016`
- Success criteria:
  `SC-006`, `SC-007`
- Preconditions:
  - Required data:
    none — deterministic unit assertions over the registered surface and resources
- Automated checks:
  ```bash
  pnpm --filter mcp-tools test:unit
  ```
- Steps:
  1. Run `sessionBoundToolSurface.test.ts` (surface exactly
     `generate_html_report`/`upload_html_report`; no authoring tool in the forward
     map; no authoring method reachable; reverse map derived).
  2. Run `getResource.test.ts` (yaml-test-spec + alias return undefined and are not
     advertised; action-entity content names no removed tool/resource and carries a
     CLI authoring pointer).
- Optional stronger evidence:
  - Script / static:
    a lint rule rejecting `shiplight://yaml-test-spec` anywhere in mcp-tools source
- Pass criteria:
  - Both suites pass, and injecting a removed tool name into either surface makes
    them fail (negative-tested at introduction).
- Cleanup:
  - none
- If not executable:
  - Mark `BLOCKED` if the unit lane cannot run.

## Fixtures And Environments

### Local Development

- Browser surface:
  keyless headless Chromium against a local fixture site for the `test:browser` lane
- Accounts / roles:
  none; a provider key only enables the live `act(verify)` path
- External service fixtures:
  a loopback WS server for the relay
- Mutation policy:
  `fixture_only`
- Known local limitations:
  the live `act(verify)` path needs a provider key

### PR CI

- Browser surface:
  deterministic unit suites plus the keyless `test:browser` lane (browser-tests.yml
  installs Chromium; needs no secrets)
- Accounts / roles:
  none
- External service fixtures:
  none by default
- Mutation policy:
  `fixture_only`
- Known limitations:
  the live `act(verify)` LLM path self-skips (no key); session timeout auto-cleanup
  and relay soak are outside the gate

### Keyed / Live (Deferred)

- Browser surface:
  a keyed `act(verify)` job and a real MCP-SDK stdio transport smoke
- Accounts / roles:
  a provider key for `act(verify)`
- External service fixtures:
  provider API only — the server calls no Shiplight endpoint
- Mutation policy:
  `case_by_case`
- Known limitations:
  expensive and non-default; unsuitable as the only proof for core behavior

## Report Expectations

- Record gated unit/browser results separately from the deferred key/load/network
  residuals so the structural and behavioral proof story stays clear.
- Put blocking failures before residual risk.
- Distinguish structural proof gaps from environment-dependent deferrals.
- Record exact commands and results; negative-path log lines are not failures.
- Never include secrets, tokens, or raw provider/cloud responses.

## Coverage Notes

- Every expectation in `quality-map.yaml` should map to at least one test case here
  and at least one executable command in the report.
- The browser tools are the product surface; keep their real-browser proof gated
  rather than relying on schema-level validation.
- The env-var allowlist security seam shared with the CLI (`002`) is owned and proven
  there; this feature relies on it but does not re-prove it.
- Prefer stable ids and file paths so downstream observation/evaluation systems can
  join without heuristics.
