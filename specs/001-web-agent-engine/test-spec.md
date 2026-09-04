# Test Spec: AI Web-Agent Automation Engine

**Scope**: `feature`
**Source material**:
- [Feature spec](../../specs/001-web-agent-engine/spec.md)
- [Project map feature entry](../../project-map.yaml)
- https://docs.shiplight.ai/local/yaml-tests
- `packages/sdk-core`
**Quality policy**: [../../TESTING.md](../../TESTING.md)
**Test report**: [test-report.md](./test-report.md)

This file defines the durable testing contract for the shared engine bundled
into both published local-tooling products. It describes what must be trusted
about the engine and which proof strategies are worth buying.

## Testing What

### Product Behaviors

- A natural-language step resolves into the correct concrete browser action or
  a clear failure.
- The engine captures durable semantic locators with XPath fallback so actions
  can replay without another model call.
- Provider credentials auto-select the correct model and route calls to the
  right endpoint without extra configuration.

### Implementation / System Invariants

- `verify` steps preserve the original statement as the assertion payload.
- Action timeout precedence stays `statement -> organization -> default`.
- Variable substitution resolves supported syntaxes and propagates sensitive
  flags into the agent context.

### Risk-Based Behaviors

- Step, self-heal, and modal-dismissal budgets prevent runaway loops and spend.
- DOM extraction exposes the actionable page surface the model needs to act.
- Coordinates-based fallback remains available when DOM-based resolution is
  insufficient.

### Operational / Release Behaviors

- Release-critical logic has at least one deterministic `pr-ci` gate.
- User-visible browser behavior has a repeatable fixture-backed proof path.
- Shared engine changes remain provable at the seam that ships in both CLI and
  MCP products.

### Stakeholder Confidence Goals

- Engine changes can ship without silently regressing the core agent loop.
- Captured actions remain replayable and durable after serialization.
- Release reviewers can see which remaining proof gaps are structural versus
  merely deferred live execution.

## Evidence Strategy

| What | Risk | Viable How | Selected How | Why | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| NL step -> concrete action | Release-critical wrong-action regressions | unit, integration, e2e | unit + keyed-browser e2e | deterministic mapping plus real fixture execution buys confidence fastest | keyed browser path depends on provider key availability |
| Self-healing locator capture/replay | Durable regression playback | unit, integration, e2e | unit + keyed-browser e2e | replay logic is cheap to pin in unit tests, generation needs a live fixture | nested iframe frame-path coverage is still missing |
| Provider/model routing | Every run breaks or misroutes keys | unit, contract, integration | unit | routing logic is deterministic and cheap to gate | live endpoint reachability is outside this feature contract |
| DOM extraction | Agent cannot see actionable surface | integration, e2e | fixture-backed e2e | needs a real page surface, but does not need a live provider | custom interactive-class behavior is only local today |
| Bounded execution and timeout precedence | Token burn, hung runs, replay flake | unit, browser fixture | unit first | logic is deterministic and high signal in unit tests | modal-dismiss path lacks executable proof |
| Vision fallback | Hard-page recovery | unit, e2e, live | unit now, opt-in live later | routing and action-shape are deterministic; live trigger is more expensive | repeatable live DOM->vision trigger is still missing |
| Knowledge and sensitive values | Hidden data leaks or weak context | unit, integration | unit | parser/substitution layers are deterministic | prompt-layer masking and injected-knowledge presence are not yet proven |

## Scope

- User stories covered:
  `User Story 1`, `User Story 2`, `User Story 3`, `User Story 4`
- Primary requirements covered:
  `FR-001`, `FR-002`, `FR-003`, `FR-004`, `FR-005`, `FR-006`, `FR-007`,
  `FR-008`, `FR-009`
- Success criteria covered:
  `SC-001`, `SC-002`, `SC-003`, `SC-004`
- Implementation/system invariants covered:
  verify rewrite, locator replay without a model call, timeout precedence,
  variable substitution, bounded modal/self-heal behavior
- Out of scope:
  release-area bundle verification inside the CLI or MCP packages, staging/prod
  observations, observation/evaluation storage design, and the CLI/MCP
  env-allowlist seam captured as `FR-010` in the reconstructed spec

## Test Cases

### 001-WEB-AGENT-ENGINE-T01 Natural-Language Step Resolution

- Testing what:
  The engine maps a user statement into the correct action or explicit error.
- User stories:
  `User Story 1`
- Requirements:
  `FR-001`, `FR-005`
- Success criteria:
  `SC-001`
- Preconditions:
  - Required account / role:
    none
  - Required data:
    local fixture page with stable interactive elements
  - Required external services:
    provider key only for the keyed-browser live path
- Automated checks:
  ```bash
  pnpm --filter sdk-core test:unit
  pnpm --filter sdk-core test:browser
  ```
- Steps:
  1. Run the deterministic `elementBased.generateAction` unit suite.
  2. Run the fixture-backed browser lane and observe the `agent.execute`
     behavior against the test page.
- Optional stronger evidence:
  - Browser / UI automation:
    keyed browser lane with a stable provider key
  - Agent test:
    CLI or MCP verification against the same fixture site
- Pass criteria:
  - The deterministic suite proves click/verify/error-path mapping.
  - The browser lane proves the engine can execute the resolved step against a
    real page.
- Cleanup:
  - none
- If not executable:
  - Mark `SKIPPED` when no provider key is available for the keyed-browser path.
  - Mark `DEFERRED` if only the deterministic layer ran.

### 001-WEB-AGENT-ENGINE-T02 Self-Healing Locator Capture And Replay

- Testing what:
  Generated action entities carry a semantic locator and XPath fallback that can
  replay without another model call.
- User stories:
  `User Story 2`
- Requirements:
  `FR-002`
- Success criteria:
  `SC-003`
- Preconditions:
  - Required data:
    DOM fixture with stable roles/test ids
- Automated checks:
  ```bash
  pnpm --filter sdk-core test:unit
  pnpm --filter sdk-core test:browser
  ```
- Steps:
  1. Run the locator resolution unit suite.
  2. Run the fixture-backed browser lane and inspect generated action entities.
- Optional stronger evidence:
  - Browser / UI automation:
    iframe fixture that requires `frame_path`
- Pass criteria:
  - Replay uses locator/XPath directly.
  - Generated actions include usable locator data on the real fixture.
- Cleanup:
  - none
- If not executable:
  - Mark `DEFERRED` if the iframe-specific proof is not present yet.

### 001-WEB-AGENT-ENGINE-T03 Provider And Model Routing

- Testing what:
  Provider credentials, Shiplight tokens, and explicit model strings resolve to
  the correct provider, model, and endpoint.
- User stories:
  `User Story 3`
- Requirements:
  `FR-003`, `FR-004`
- Success criteria:
  `SC-002`
- Preconditions:
  - Required data:
    isolated environment variables or config objects per credential type
- Automated checks:
  ```bash
  pnpm --filter sdk-core test:unit
  ```
- Steps:
  1. Run the provider routing and model parsing unit suites.
  2. Inspect that direct-provider, `shp_pat_*`, and UUID token paths are all
     covered by deterministic assertions.
- Optional stronger evidence:
  - Script / static:
    config smoke that exercises resolved base URLs in a controlled environment
- Pass criteria:
  - Every credential type resolves to the expected provider/model pair and URL.
- Cleanup:
  - none
- If not executable:
  - Mark `BLOCKED` if the deterministic routing suites cannot run.

### 001-WEB-AGENT-ENGINE-T04 DOM Extraction And Bounded Execution

- Testing what:
  The engine sees the actionable DOM surface and enforces step budgets and
  timeout precedence without runaway behavior.
- User stories:
  `User Story 4`
- Requirements:
  `FR-006`, `FR-007`
- Success criteria:
  `SC-004`
- Preconditions:
  - Required data:
    fixture page with interactive elements and, for stronger proof, a modal
- Automated checks:
  ```bash
  pnpm --filter sdk-core test:unit
  pnpm --filter sdk-core test:browser
  ```
- Steps:
  1. Run the max-steps and timeout unit suites.
  2. Run the fixture-backed browser lane to confirm DOM extraction yields the
     expected interactive element surface.
- Optional stronger evidence:
  - Browser / UI automation:
    modal fixture that proves auto-dismissal stays within cap
- Pass criteria:
  - Non-positive budgets are rejected.
  - The DOM fixture exposes the expected actionable elements.
- Cleanup:
  - none
- If not executable:
  - Mark `DEFERRED` for modal-dismiss proof until the fixture exists.

### 001-WEB-AGENT-ENGINE-T05 Variables, Sensitive Flags, And Knowledge

- Testing what:
  Variable substitution preserves intended values, sensitive markers stay
  flagged, and retrieved knowledge can support the model prompt.
- User stories:
  Edge case coverage for the engine
- Requirements:
  `FR-008`
- Success criteria:
  contributes to `SC-001`
- Preconditions:
  - Required data:
    sample variables and knowledge fixtures
- Automated checks:
  ```bash
  pnpm --filter sdk-core test:unit
  ```
- Steps:
  1. Run the variable substitution and knowledge service suites.
  2. Inspect that supported variable syntaxes and knowledge parsing paths are
     covered.
- Optional stronger evidence:
  - Integration:
    mocked model call asserting knowledge text and redacted values in the prompt
- Pass criteria:
  - Supported variable syntaxes resolve correctly and preserve sensitive flags.
  - Knowledge retrieval works without corrupting multimodal payload structure.
- Cleanup:
  - none
- If not executable:
  - Mark `DEFERRED` until prompt-layer assertions exist.

### 001-WEB-AGENT-ENGINE-T06 Vision Fallback

- Testing what:
  The engine can hand off to the coordinates-based path when DOM-based
  resolution is insufficient.
- User stories:
  `User Story 4`
- Requirements:
  `FR-009`
- Success criteria:
  contributes to `SC-001`
- Preconditions:
  - Required data:
    page or fixture that forces the DOM path to fail
  - Required external services:
    provider key for a live keyed-browser or opt-in live path
- Automated checks:
  ```bash
  pnpm --filter sdk-core test:unit
  RUN_PURE_VISION_LIVE=1 pnpm --filter sdk-core test
  ```
- Steps:
  1. Run the action-shape and vision-routing unit suites.
  2. When available, run the opt-in live pure-vision spec.
- Optional stronger evidence:
  - Browser / UI automation:
    deterministic keyed fixture that forces DOM insufficiency
- Pass criteria:
  - The deterministic suites prove the coordinates-based path can be selected
    and shaped correctly.
  - The live sweep, when run, yields a valid action rather than a dead end.
- Cleanup:
  - none
- If not executable:
  - Mark `DEFERRED` until a repeatable live fixture exists.

## Fixtures And Environments

### Local Development

- Browser surface:
  local Playwright fixture pages under `packages/sdk-core/tests/specs`
- Accounts / roles:
  none for deterministic unit coverage; provider key only for keyed browser
- External service fixtures:
  optional provider key for live model-backed checks
- Mutation policy:
  `fixture_only`
- Known local limitations:
  keyed-browser tests self-skip without a provider key

### PR CI

- Browser surface:
  keyless fixture-backed browser lane plus deterministic unit suites
- Accounts / roles:
  none
- External service fixtures:
  none by default
- Mutation policy:
  `fixture_only`
- Known limitations:
  live model-backed paths are outside the default gate

### Keyed Browser Lane

- Browser surface:
  same local fixture pages, but with a provider key available
- Accounts / roles:
  none beyond provider access
- External service fixtures:
  provider key and API budget
- Mutation policy:
  `fixture_only`
- Known limitations:
  should stay bounded to stable fixture pages, not arbitrary external sites

### Opt-In Live

- Browser surface:
  live or semi-live pages only when explicitly requested
- Accounts / roles:
  scenario-specific
- External service fixtures:
  provider key and any required downstream services
- Mutation policy:
  `case_by_case`
- Known limitations:
  expensive, non-default, and unsuitable as the only proof for core behavior

## Report Expectations

- Record deterministic gates and keyed-browser results separately so skipped live
  lanes do not blur the structural proof story.
- Put blocking failures before residual risk.
- Distinguish structural proof gaps from run-time skips or environment absence.
- Record exact commands, results, and any self-skip behavior from keyed paths.
- Never include secrets, tokens, or raw provider responses.

## Coverage Notes

- Every expectation in `quality-map.yaml` should map to at least one test case
  in this spec and at least one executable command in the report.
- When a stronger live proof exists only as an opt-in sweep, keep the
  deterministic baseline explicit so reviewers can separate trusted coverage
  from deferred coverage.
- Prefer stable ids and file paths so downstream observation/evaluation systems
  can join without heuristics.
