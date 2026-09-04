# Feature Specification: AI Web-Agent Automation Engine

**Feature Branch**: `001-web-agent-engine`
**Created**: 2026-06-07
**Status**: Draft (reconstructed from implementation)
**Input**: Brownfield reconstruction of `packages/sdk-core` (+ `shiplight-types`) — the shared engine bundled into both the `shiplightai` CLI (002) and the `@shiplightai/mcp` server (003). The YAML transpiler that was `shiplight-tools` now lives in `apps/cli/src/yaml-transpiler/` and is specified by 002; `sdk-internal` was removed as a pure re-export shim.

## Reconstruction Note

This spec was reconstructed from current code and the public docs, not authored
up front. Requirement source types:

- **[SOURCE]** — endorsed by public docs (https://docs.shiplight.ai/local/yaml-tests) or the published package READMEs.
- **[IMPL]** — observed from current implementation; accepted as behavior but not independently endorsed.

Quality evidence: [.quality/evidence/001-web-agent-engine/](../../.quality/evidence/001-web-agent-engine/quality-map.yaml).
Do not promote `[IMPL]` requirements to `[SOURCE]` without a product decision.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Resolve a natural-language step into a browser action (Priority: P1)

A test author (or a coding agent) gives a plain-language instruction such as
"click the Login button" or "verify the dashboard is visible" against a live web
page. The engine inspects the page, decides the single concrete action that
satisfies the instruction, executes it, and reports success or a clear failure.

**Why this priority**: This is the engine's entire reason to exist; every product
on top of it (CLI runs, MCP `act`, the debugger) depends on this loop.

**Independent Test**: Drive `generateAction`/`execute` with a known page and
instruction and confirm the produced action (type + target) matches intent.
Deterministically covered by mocking the LLM (`elementBased.generateAction.test.ts`);
end-to-end behavior covered by the live browser specs.

**Acceptance Scenarios**:

1. **Given** a page with a clearly labelled button and the instruction "click the Login button", **When** the engine resolves the step, **Then** it produces a `click` action targeting that element.
2. **Given** the instruction is a verification ("verify X"), **When** the engine resolves it, **Then** it produces a `verify` action carrying the original statement as the assertion.
3. **Given** the model returns no usable action / signals "done" / cannot complete in one step, **When** the engine resolves the step, **Then** it returns a clear error rather than a wrong action.

### User Story 2 — Generate self-healing locators (Priority: P1)

When the engine acts on an element, it records a durable, semantic locator
(preferring `getByRole`/`getByTestId`) plus an XPath fallback, so the same step
can later be replayed deterministically without re-asking the model.

**Why this priority**: Self-healing locators are the durability promise that makes
captured/authored tests fast and stable on replay.

**Independent Test**: Resolve an action that targets a DOM element and confirm the
returned action entity carries both a semantic locator and an XPath.

**Acceptance Scenarios**:

1. **Given** an action targets an element by index, **When** the engine builds the action entity, **Then** it attaches the element's semantic locator and XPath.
2. **Given** a previously captured action with a concrete locator, **When** it is replayed, **Then** execution uses the locator/XPath directly (no model call).

### User Story 3 — Auto-select the model from the available provider key (Priority: P1)

The operator sets exactly one provider API key (Google, Anthropic, or OpenAI), or
a Shiplight token. The engine selects an appropriate model and routes requests to
the correct endpoint without further configuration.

**Why this priority**: Zero-config model selection is a stated onboarding promise;
mis-routing breaks every run or sends a key to the wrong endpoint.

**Independent Test**: Set each key in isolation and confirm provider/model
resolution and endpoint routing.

**Acceptance Scenarios**:

1. **Given** only `GOOGLE_API_KEY` is set, **When** the engine resolves a model, **Then** it selects the Google default and routes directly to Google.
2. **Given** a `shp_pat_*` token, **When** the engine resolves routing, **Then** it routes through the Shiplight the Shiplight proxy proxy; a legacy token of any other shape resolves to no endpoint and fails with an actionable message naming the fix.
3. **Given** an explicit `provider:model` string, **When** parsed, **Then** the named provider+model is used; unknown prefixes are preserved as the model id.
4. **Given** only `SHIPLIGHT_API_TOKEN` (no provider key) and tier information (`WEB_AGENT_TIER` or an injected org-settings map), **When** the engine resolves a model, **Then** it uses the tier's primary and ignores `WEB_AGENT_MODEL`; adding a direct provider key opts back into scenario 1's behavior.

### User Story 4 — Degrade gracefully and stay bounded (Priority: P2)

When the DOM is insufficient, the engine can fall back to a vision (coordinates)
strategy; it never loops unbounded (step, self-heal, and modal-dismissal budgets
are enforced) and it can dismiss intrusive modals to make progress.

**Why this priority**: Reliability margin on hard pages and protection against
runaway token spend / hung runs.

**Independent Test**: Force DOM extraction to be insufficient and confirm the
vision path yields a valid action; assert budget limits reject invalid values and
cap retries.

**Acceptance Scenarios**:

1. **Given** `maxSteps <= 0`, **When** execution starts, **Then** it is rejected.
2. **Given** a single-step instruction, **When** executed, **Then** the single-step path runs; multi-step instructions run the task loop with the configured budget.

### Edge Cases

- Variables in instructions (`{{var}}`, `${var}`, `$var`, `<secret>var</secret>`) MUST be substituted before use; unmatched variables are preserved verbatim.
- Sensitive-flagged values MUST be treated as sensitive in the agent context.
- Actions referencing a negative/invalid element index MUST error, not act.
- Per-statement timeout overrides organization and default timeouts.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 [SOURCE]**: The engine MUST resolve a natural-language step plus a live page into a single concrete browser action (or an explicit error).
- **FR-002 [SOURCE]**: The engine MUST produce self-healing semantic locators with an XPath fallback for element-targeted actions.
- **FR-003 [SOURCE/IMPL]**: The engine MUST resolve the model by who bears the cost. **[SOURCE]** With a direct provider key (BYOK), it auto-selects from that key, overridable via `WEB_AGENT_MODEL`/explicit `provider:model`. **[IMPL]** With only a Shiplight token and tier information present, it selects by tier (`WEB_AGENT_TIER` → org default → baked default) and **ignores** `WEB_AGENT_MODEL`/`WEB_AGENT_FALLBACK_MODELS`/`COMPUTER_USE_MODEL` (the proxy rejects non-permitted models regardless); model ids normalize to `provider:model`. Tier selection is gated on the org-settings endpoint — see `docs/design/llm-tier-selection.md`.
- **FR-004 [IMPL]**: The engine MUST route LLM calls to the correct endpoint by credential type (direct provider key → provider; `shp_*` token → the Shiplight proxy proxy), honoring `SHIPLIGHT_API_URL`. Any other token shape MUST resolve to no endpoint: an LLM call MUST fail with an actionable message rather than address a host, and callers that can degrade — locator caching, tier selection, report upload — MUST do so instead of failing the run.
- **FR-005 [IMPL]**: `verify` actions MUST carry the original natural-language statement as the assertion.
- **FR-006 [IMPL]**: The engine MUST enforce step, self-heal, and modal-dismissal budgets and reject non-positive `maxSteps`.
- **FR-007 [IMPL]**: The engine MUST apply per-statement → organization → default timeout precedence to actions.
- **FR-008 [IMPL]**: The engine MUST substitute supported variable syntaxes and respect sensitive flags.
- **FR-009 [IMPL]**: The engine MUST support a vision (coordinates-based) fallback when DOM-based resolution is insufficient.
- **FR-010 [SOURCE]**: The engine MUST NOT read arbitrary process environment; it consumes provider configuration only from the SDK config it is given (see the CLI/MCP allowlist seam in 002/003).

### Key Entities

- **ActionEntity**: a resolved action — action name + kwargs, a human-readable description, and (for element actions) a semantic locator + XPath + optional frame path.
- **AgentContext**: per-run state — model, variable store (with sensitive flags), execution history, token usage.
- **TestFlow / Statement**: the YAML-addressable representation of steps (DRAFT, ACTION, STEP, control flow) shared with the CLI and MCP.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The NL→action decision mapping (incl. verify rewrite and the no-action/done/cannot-complete/negative-index error paths) is proven by CI-gated tests.
- **SC-002**: Provider/model selection and endpoint routing are proven by CI-gated tests for each supported credential type, including the tier-selected path (tier resolution precedence, ignored env vars, and the who-pays gate) and the unsupported-token failure.
- **SC-003**: A captured action's concrete locator/XPath survives serialization and replays without a model call.
- **SC-004**: No engine run exceeds its configured step budget.

## Assumptions

- Exactly one provider credential is configured per run (or an explicit model override) — or, on the Shiplight-proxy path, only `SHIPLIGHT_API_TOKEN`, with the model chosen by tier.
- Vertex AI routing is **out of scope** for this engine and lives in the separate cloud service (see [[project-llm-proxy-chain]] in project notes).
- The only Shiplight-proxied path is the hosted proxy, reached with a `shp_*` token. There is no legacy cloud endpoint.
- The live, full NL→action loop against real pages is validated by browser specs that require a browser + API key. Only `engine-fixture.spec.ts` is CI-gated (`test:browser`, run by `browser-tests.yml`). The remaining specs in `tests/specs/` — `agent-execute-verify`, `copy-paste`, `generateAction`, `interactive-class-names`, `logger`, `pure-vision`, `registry` — are **manual**, run with `pnpm --filter sdk-core test:browser:all`. This is accepted residual risk: they make live model calls, so gating CI on them would trade determinism (constitution II) for coverage. SC-001's CI claim covers the mocked decision mapping only.
