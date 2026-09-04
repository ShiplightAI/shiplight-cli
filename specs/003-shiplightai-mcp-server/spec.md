# Feature Specification: @shiplightai/mcp UI-Automation Server

**Feature Branch**: `003-shiplightai-mcp-server`
**Created**: 2026-06-07
**Status**: Draft (reconstructed from implementation)
**Input**: Brownfield reconstruction of `apps/mcp-server` + `packages/mcp-tools` — the published `@shiplightai/mcp` MCP server. Depends on the engine (001).

## Reconstruction Note

Reconstructed from current code + the package README. Source types:

- **[SOURCE]** — endorsed by `apps/mcp-server/README.md`.
- **[IMPL]** — observed from current implementation.

Quality evidence: [.quality/evidence/003-shiplightai-mcp-server/](../../.quality/evidence/003-shiplightai-mcp-server/quality-map.yaml).

## Scope Boundary

This server owns **live browser sessions** — anything whose value depends on a
page that stays open across agent turns. It does **not** own test authoring.

The dividing question is *"does this need a live browser session?"*, not *"is this
test-related"*:

- **In scope**: session lifecycle, page interaction, inspection, locator capture,
  console/network logs, Chrome relay attach, and evidence reports over a session's
  recording (`generate_html_report` reports on a closed *session*, not on a
  Playwright test run — it is session-bound and stays).
- **Out of scope, owned by 002**: project scaffolding, `.test.yaml` validation,
  YAML→spec transpilation, and the normative YAML language spec. These are
  filesystem and parser concerns that MUST ship and version with the parser that
  consumes them (`shiplightai`), so that the artifact which validates a test is
  the same artifact, at the same version, that runs it.

This boundary describes the entire server: every registered tool is session-bound,
and the only resource it serves is `shiplight://schemas/action-entity`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A coding agent verifies its own UI changes (Priority: P1)

A coding agent (Claude Code, Cursor, Windsurf, …) connects the MCP server and uses
its browser tools — `new_session`, `navigate`, `inspect_page`, `get_locators`,
`get_page_info`, `act` — to open a page, read its actionable elements, perform
actions by element index, and assert conditions, closing the build-verify loop.

**Why this priority**: This is the product — the tools the agent calls to drive a
browser. If any handler silently breaks, the agent loses that capability with no error.

**Independent Test**: Against a fixture site, run new_session → get_page_info →
inspect_page → get_locators → act(click) and assert real page state; run
act(verify) live when a key is present.

**Acceptance Scenarios**:

1. **Given** a session at a fixture page, **When** `inspect_page` runs, **Then** it returns a DOM file with element indices the agent can act on.
2. **Given** an element index, **When** `act` clicks it, **Then** the real page changes (e.g. navigates) and the result reports success.
3. **Given** a natural-language assertion, **When** `act(verify)` runs with a model configured, **Then** it evaluates the assertion against the live page.

### User Story 2 — Sessions are isolated and cleaned up (Priority: P1)

Multiple browser sessions can run concurrently without cross-contamination; each
has a distinct id and its own page, and closing one does not affect others.

**Why this priority**: Leaks/races cause stale sessions, memory growth, and
cross-session contamination in long-running agent use.

**Independent Test**: Open two sessions at different pages, assert distinct
ids/pages, close one, assert the other still works and the closed one errors.

**Acceptance Scenarios**:

1. **Given** two open sessions, **When** one is closed, **Then** the session count drops by one, operations on the closed session fail, and the other session still works.

### User Story 3 — Sessions yield replay-ready action entities (Priority: P1)

Every located action a session performs returns concrete replay data — `locator`,
`xpath`, `frame_path` — that an agent embeds into `.test.yaml` statements so the
test replays deterministically instead of re-detecting elements with the model.

**Why this priority**: "Every interaction becomes a regression test" is a core
promise, and this server is the only place that data can be produced — it requires
a live page. Authoring, validating, and transpiling the resulting YAML belong to
002; this feature owns the enrichment payload those steps consume.

**Independent Test**: Drive a located action against a fixture page and assert the
returned action entity carries a usable locator (or xpath) and frame path, and
that `get_locators` reports the same element consistently.

**Acceptance Scenarios**:

1. **Given** a click performed by element index, **When** the result is returned, **Then** it carries a Playwright locator (or an xpath when no semantic locator exists) plus any frame path needed to reach the element.
2. **Given** an agent has that payload, **When** it writes a `.test.yaml` with its own file tools and validates it with `shiplight transpile --strict` (002), **Then** the statement is accepted as an enriched ACTION rather than a DRAFT.

### User Story 5 — Attach to existing Chrome tabs (Priority: P2)

Via the relay extension, the server can control existing Chrome tabs over CDP
without recreating login state.

**Acceptance Scenarios**:

1. **Given** the relay extension registers tabs, **When** Playwright connects over CDP, **Then** those tabs appear as controllable pages and disappear when unregistered.

### Edge Cases

- Stray writes to stdout MUST never corrupt the JSON-RPC stdio transport (all logs go to stderr).
- Environment matching by URL MUST be exact (no cross-domain or prefix bleed).
- `new_session` input MUST be validated (viewport, emulation, color scheme, geolocation, locale); legacy fields stripped.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 [SOURCE]**: The server MUST expose browser tools (new_session, navigate, inspect_page, get_locators, get_page_info, act, console/network logs) that drive a real Playwright-backed page.
- **FR-002 [SOURCE]**: Every located action MUST return replay-ready action-entity data (`locator`, `xpath`, `frame_path`) sufficient for an agent to author a deterministic `.test.yaml` statement. Transpiling and validating that YAML is 002's, not this server's.
- **FR-003 [SOURCE]**: The server MUST attach to existing Chrome tabs via the relay extension over CDP.
- **FR-006 [IMPL]**: Sessions MUST be isolated (distinct ids/pages) and independently closable; operations on a closed session MUST fail clearly.
- **FR-008 [IMPL]**: All server logging MUST go to stderr; the JSON-RPC stdio channel MUST stay clean (EPIPE handled, throwables formatted safely).
- **FR-010 [IMPL]**: Tool registration MUST be complete (every tool definition has a backing handler) and unknown tools MUST error.
- **FR-011 [SOURCE]**: `PWDEBUG=console` MUST be set for semantic locator generation. Playwright injects `playwright.generateLocator` into the page only under that flag; without it the engine returns no semantic locator and the action entity carries an XPath instead. Actions still replay — it is locator durability that degrades, not correctness.
- **FR-012**: The registered tool surface MUST be session-bound. The server MUST NOT expose project scaffolding, `.test.yaml` validation, or YAML→spec transpilation tools; those are 002's CLI commands. `generate_html_report` is session-bound (it requires a closed session id and reports on that session's recording) and remains in scope.
- **FR-013**: A tool that performs no browser work MUST NOT require the Playwright/session module graph to initialize. After FR-012 this holds by removal, and MUST NOT be reintroduced.
- **FR-014**: The action-entity resource MUST be **generated** from the live action registry (the same registry `act` dispatches through), never hand-maintained, so it cannot describe an action the server does not support or omit one it does.
- **FR-015**: The action-entity resource MUST document only what this server produces — the action vocabulary, their parameters, and the shape `get_locators`/`act` return. It MUST NOT teach `.test.yaml` authoring or reference tools this server no longer exposes; it MUST point at the CLI (`npx shiplight spec yaml`) for the YAML contract.
- **FR-016**: The `ActionEntity` structure MUST have exactly one authored definition. Where the resource describes it, that description MUST be derived from the type/schema rather than transcribed by hand.

### Key Entities

- **Session**: a browser context + page + agent + logs, addressed by session id, with lifecycle (create/use/close/timeout).
- **Tool registry**: name → handler map driving `handleToolCall`.
- **Action registry**: the engine-owned set of supported browser actions and their parameter schemas. It is the single source for both this server's action-entity resource and the CLI's `shiplight spec actions` output — two renderers, one source, no second copy.
- **ActionEntity**: the replay payload a located action returns (`action_description`, `action_data.action_name`, `kwargs`, `locator`, `xpath`, `frame_path`). This server owns *what it emits*; 002's YAML spec owns *what the parser accepts*.
- **Relay (ExtensionRelayServer)**: tracks extension-registered tabs and exposes them as CDP targets/pages.
- **Relay election lease**: the single-writer claim on the relay role, so concurrent server instances do not both bind it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Browser tools (navigate/inspect/get_locators/get_page_info/act-click) are proven against a real headless browser in a CI-gated lane.
- **SC-002**: Session create→use→close and two-session isolation/teardown are proven.
- **SC-003**: A located action's returned entity is proven to carry a usable locator (or xpath) and frame path against a real page.
- **SC-005**: stdio integrity, relay CDP target management, reference resolution, and registration completeness are proven.
- **SC-006**: The session-bound boundary is proven by a test over the registered tool surface: no tool performs filesystem scaffolding, YAML validation, or transpilation. This is a guard, not a one-time cleanup — it must fail if such a tool is reintroduced.
- **SC-007**: The action-entity resource is proven to render every action in the live registry and no others, so registry drift surfaces as a failing test rather than stale documentation.

## Assumptions

- At least one provider key is configured for `act(verify)`; the deterministic browser tools need no key.
- The live `act(verify)` LLM path is validated locally and self-skips in CI (no secret in the browser CI lane).
- Session timeout auto-cleanup, console/network log capture, and relay-under-load remain to be covered (tracked in the quality map).
- Losing `scaffold_project`'s tool description costs the always-visible "you MUST scaffold before writing `.test.yaml`" nudge that every agent saw whether or not a skill was loaded. This is an accepted trade: discovery moves to the `/shiplight` skill and the CLI. It is a deliberate decision, not an oversight.
