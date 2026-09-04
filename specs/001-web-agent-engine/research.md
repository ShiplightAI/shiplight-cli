# Phase 0 Research: AI Web-Agent Automation Engine

Reconstructed. The spec has no open `NEEDS CLARIFICATION`, because the engine is
already built and every decision below is observable in the code. This file records
what was decided and why, so a future change knows which constraints are load-bearing.

## D1 — Model selection is decided by who pays, not by configuration

**Decision**: A direct provider key (BYOK) auto-selects that provider's default and
honours `WEB_AGENT_MODEL` / an explicit `provider:model`. A Shiplight token with tier
information selects by tier (`WEB_AGENT_TIER` → org default → baked default) and
**ignores** `WEB_AGENT_MODEL`, `WEB_AGENT_FALLBACK_MODELS` and `COMPUTER_USE_MODEL`
(`TIER_IGNORED_ENV_VARS` in `packages/types/src/llmTiers.ts`).

**Rationale**: On the proxy path Shiplight bears the cost, and the proxy rejects
non-permitted models regardless of what the client asks for. Honouring an override
there would produce a confusing failure at the proxy instead of a predictable model.
Adding a direct provider key opts back into full control, so the escape hatch is
always one env var away.

**Alternatives considered**: Always honour `WEB_AGENT_MODEL` — rejected because it
misleads users into thinking a rejected model was selected. A hard error when an
override is set on the proxy path — rejected as hostile to users who set the variable
once and switch credentials.

## D2 — Routing follows credential shape

**Decision**: direct provider key → provider endpoint; `shp_*` token → the cloud service/the Shiplight proxy
proxy; any other token shape → no endpoint; `SHIPLIGHT_API_URL` overrides the base.

The v1 cloud path was removed in August 2026 when that cloud was decommissioned.
`resolveApiBase` returns `null` rather than throwing, so each caller keeps its own
policy: an LLM call fails with an actionable message because it has no degrade
path, while locator caching, tier selection and report upload degrade quietly.

**Rationale**: The credential already encodes the intended path, so no extra
configuration is needed and a key can never be sent to the wrong endpoint by
misconfiguration.

**Alternatives considered**: An explicit `provider`/`endpoint` setting — rejected as
redundant and a way to leak a provider key to a proxy.

## D3 — Vertex AI is out of scope for this engine

**Decision**: Vertex routing lives in the separate cloud service, not here.

**Rationale**: Vertex needs Google ADC/workload-identity credentials that a user's
local machine does not have. Keeping it server-side avoids shipping a second
credential model into the CLI.

**Alternatives considered**: Bundling Vertex support behind a flag — rejected;
`@ai-sdk/google-vertex` stays a dependency for the shared provider surface, but the
routing decision belongs to the service that holds the credentials.

## D4 — Two action-generation strategies, DOM first

**Decision**: Resolve from extracted DOM/accessibility structure by default; fall back
to a coordinates (vision) strategy when extraction is insufficient (FR-009).

**Rationale**: DOM resolution is cheaper and, crucially, yields the semantic locator
that makes model-free replay possible (D5). Vision is the only path that works on
canvas-heavy and shadow-DOM-heavy pages, so it earns its complexity as a fallback.

**Alternatives considered**: Vision-only — rejected: higher token cost and no durable
locator. DOM-only — rejected: fails outright on the pages vision exists to handle.

## D5 — Capture a semantic locator plus an XPath fallback

**Decision**: Every element-targeted action records a `locator` (preferring
`getByRole`/`getByTestId`) and an `xpath`, plus an optional `frame_path`.

**Rationale**: This is the durability promise. A captured action replays with **zero**
model calls (SC-003), which is what makes authored suites fast and stable. The XPath
is the fallback when the semantic locator stops matching.

**Alternatives considered**: XPath only — rejected as brittle under markup change.
Semantic locator only — rejected because it cannot address every element.

## D6 — The engine never reads `process.env`

**Decision**: Provider configuration arrives through the SDK config the host injects
(`src/config.ts`); the engine reads no ambient environment (FR-010).

**Rationale**: The CLI and MCP server have different, auditable environment
allowlists. If the library read `process.env` directly, those allowlists would be
unenforceable and a stray variable in a user's shell could change model routing
inside a server process.

**Alternatives considered**: Reading `process.env` with an internal allowlist —
rejected: it puts the security boundary in the wrong package and duplicates the
hosts' seams.

## D7 — Bound every loop explicitly

**Decision**: Enforce step, self-heal and modal-dismissal budgets; reject
non-positive `maxSteps` (FR-006).

**Rationale**: An agent loop against a live page is unbounded by nature. Budgets cap
worst-case token spend and stop a hung run, which matters most in the long-lived MCP
server process.

**Alternatives considered**: A wall-clock timeout only — rejected: it does not bound
token spend, and it fires unpredictably on slow pages.

## D8 — Deterministic tests mock the model; the live loop is not CI-gated

**Decision**: `test:unit` mocks the LLM via `--experimental-test-module-mocks`;
`test:browser` drives real pages and needs a browser plus an API key, so it stays
outside the default CI gate.

**Rationale**: Constitution II asks for deterministic tests. A live model call is not
deterministic, so the CI claim is scoped to the decision mapping (SC-001) and the
live loop is validated separately.

**Alternatives considered**: Gating CI on the live loop — rejected as flaky and
credential-bound. No live coverage — rejected: the mapping tests cannot prove the
engine works against a real page.
