# Phase 0 Research: @shiplightai/mcp UI-Automation Server

Reconstructed. One open `NEEDS CLARIFICATION` remains (D6); the rest are decisions
observable in the code.

## D1 — The session is the boundary

**Decision**: The server owns anything whose value depends on a page that stays open
across agent turns, and nothing else (FR-012).

**Rationale**: The dividing question is "does this need a live browser session?", not
"is this test-related". Authoring tools that lived here shipped on a different cadence
than the parser that consumes their output, so an agent could validate green against
one schema and fail at runtime against another.

**Alternatives considered**: Keeping scaffolding and validation for agent convenience —
rejected as the cause of the skew. Duplicating validation in both — rejected outright.

**Consequence**: `generate_html_report` stays, because it reports on a closed
*session's* recording rather than a Playwright test run.

## D2 — Enforce the boundary with a guard, not review

**Decision**: A test asserts over the registered tool surface that no tool performs
scaffolding, YAML validation or transpilation (SC-006).

**Rationale**: Boundaries stated in prose get re-crossed. A guard fails on
reintroduction; a cleanup is a one-time event.

**Alternatives considered**: Documentation and code review — rejected; the spec calls
this out explicitly as "a guard, not a one-time cleanup".

## D3 — Render the action-entity resource from the live registry

**Decision**: The resource is generated from the same registry `act` dispatches
through (FR-014), documents only what this server produces (FR-015), and derives the
`ActionEntity` shape from the type rather than transcribing it (FR-016).

**Rationale**: A hand-maintained resource can describe an action the server does not
support, or omit one it does. Registry drift should surface as a failing test
(SC-007), not stale documentation an agent then trusts.

**Alternatives considered**: An authored markdown resource — the prior state, and the
reason FR-014 exists.

## D4 — Lazy browser imports

**Decision**: `server.ts` statically imports the registry, resources and prompts, but
`await import("mcp-tools")` for the browser classes.

**Rationale**: An invocation that never opens a page should not pay
Playwright's start-up. FR-013 makes this a requirement rather than an optimisation:
after the FR-012 removals it holds by construction and must not be reintroduced.

**Alternatives considered**: Static imports throughout — simpler, but every start-up
loads Playwright.

## D5 — stdout belongs to the protocol

**Decision**: All logging goes to stderr; EPIPE is handled and throwables are
formatted safely (FR-008).

**Rationale**: stdout is the JSON-RPC channel. A stray `console.log` corrupts the
stream and the client sees a protocol error rather than a message.

**Alternatives considered**: A log level that silences stdout — one missed call still
breaks the channel; the invariant has to be absolute.

## D6 — `PWDEBUG=console` requirement is unverified — OPEN

**Decision**: Not resolved. The README asserts `PWDEBUG=console` is required for
semantic locator generation (FR-011), but no test pins the dependency.

**Why it matters**: If it is required and unset, locator quality silently degrades. If
it is not, the README teaches an unnecessary step.

**Next step**: either a test that fails without it, or a documentation correction.
Tracked as open work; it is a product question, not a code question.

## D7 — The server has no cloud surface

**Decision**: The server holds no user credential and makes no outbound call on a
user's behalf. Every tool it registers acts on a local browser session.

**Rationale**: There is no Shiplight endpoint for this server to call. A
`shp_pat_*`/`shp_org_*` token reaches the Shiplight proxy, which serves LLM inference and does not
implement test-storage endpoints. Adding a credential here would also widen the
blast radius of a long-lived stdio process that a coding agent spawns
automatically.

**Alternatives considered**: Register storage tools and gate them on a token —
rejected, gating a tool whose endpoint does not exist still puts it in the agent's
surface, where it is discovered and fails late instead of never being offered.
Persisting test cases from the server against a new endpoint — rejected, that is a
capability with its own product spec, and it belongs where the parser lives (002),
not where the browser lives.
