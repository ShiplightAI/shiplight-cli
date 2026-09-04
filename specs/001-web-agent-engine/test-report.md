# Test Report: AI Web-Agent Automation Engine

**Spec**: [../../specs/001-web-agent-engine/spec.md](../../specs/001-web-agent-engine/spec.md)
**Test spec**: [test-spec.md](./test-spec.md)
**Quality map**: [quality-map.yaml](./quality-map.yaml)
**Branch / commit**: `feng/workspace` / `859fda683`
**Created**: `2026-06-07`
**Last updated**: `2026-06-09`
**Tester**: `quality-evidence model-improvement pass`

This pass reconciled the report with the current map: the secret-redaction and
knowledge-injection gaps are now closed by prior-added proofs, `exp-dom-extraction`'s
custom-class evidence was calibrated to WEAK, and the engine lanes were re-run.

## Summary

- Overall status: `PASS`
- Main confidence gained:
  the engine lanes passed in this environment: `255/255` unit tests (`62` suites) and
  `4/4` fixture-backed browser tests, including the keyed live NL-step execution path.
  Two previously-open prompt-layer gaps are now closed in the map: sensitive-value
  redaction (`sensitiveRedaction.test.ts`) and retrieved-knowledge injection
  (`knowledgeInjection.test.ts`).
- Blocking findings:
  none in this pass
- Residual release risk:
  concentrated in proof gaps around live DOM→vision fallback, modal auto-dismissal,
  browser execution of transpiled actions, and gated proof for custom
  interactive-class DOM extraction (now explicitly WEAK, local-only)

## Source Material

- [Feature spec](../../specs/001-web-agent-engine/spec.md)
- [Project map](../../project-map.yaml)
- [Project proof strategy](../../TESTING.md)
- `packages/sdk-core`
- https://docs.shiplight.ai/local/yaml-tests

## Tests Added Or Updated

| Type | Files | Tests |
| --- | ---: | ---: |
| Unit | 0 | 0 |
| Contract | 0 | 0 |
| Integration | 0 | 0 |
| E2E | 0 | 0 |
| Agent | 0 | 0 |
| Script / static | 0 | 0 |
| **Total** | **0** | **0** |

### File List

- (this pass) no engine test code added — report reconciliation + map calibration only.
  The map already cites the prior-added `sensitiveRedaction.test.ts` (closes the
  `exp-variable-substitution` prompt-redaction gap) and `knowledgeInjection.test.ts`
  (closes `exp-knowledge-injection`); `exp-dom-extraction`'s `interactive-class-names`
  evidence was recalibrated MODERATE → WEAK (local-only, non-gated).

## Commands Run

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm --filter sdk-core test:unit` | `PASS` | `255 pass / 0 fail / 0 skip`, `62` suites |
| `pnpm --filter sdk-core test:browser` | `PASS` | `4 pass / 0 fail / 0 skip`; keyed live agent tests executed (a provider key is present locally; self-skip in CI without one) |
| `RUN_PURE_VISION_LIVE=1 pnpm --filter sdk-core test` | `DEFERRED` | opt-in live vision sweep was not part of this verification pass |
| `pnpm --filter sdk-core test -- tests/specs/interactive-class-names.spec.ts` | `DEFERRED` | local-only browser proof for custom interactive classes was not re-run in this pass |

## Coverage Matrix

Use statuses consistently: `COVERED`, `PARTIAL`, `IMPLICIT`, `NOT COVERED`,
`NOT MEASURED`, `MANUAL`, `BLOCKED`, or `DEFERRED`.

### Testing What

| What | Status | Evidence |
| --- | --- | --- |
| Provider credential routing chooses the correct endpoint | `COVERED` | `providerProxy.test.ts`, `proxy.test.ts` via `pnpm --filter sdk-core test:unit` |
| Model identifiers parse and provider auto-detects | `COVERED` | `parseModel.test.ts` via `pnpm --filter sdk-core test:unit` |
| Natural-language step resolves into the correct action or explicit error | `COVERED` | `elementBased.generateAction.test.ts` plus `engine-fixture.spec.ts` |
| Generated action entities carry durable locator + XPath replay data | `COVERED` | `utils.test.ts` plus `engine-fixture.spec.ts` |
| Action timeout precedence and transpilation hold at runtime | `PARTIAL` | unit coverage exists (`timeout.test.ts`, `go_to_url.test.ts`, `js_action.test.ts`, `ai_assert.test.ts`); generated Playwright code is not yet executed in a browser fixture |
| DOM extraction exposes the actionable page surface | `PARTIAL` | fixture-backed DOM extraction passed (`engine-fixture.spec.ts`, STRONG); custom `interactive_class_names` rests on a WEAK local-only spec (not a CI gate) |
| Budgets prevent runaway execution and modal churn | `PARTIAL` | max-step behavior is unit-covered; modal auto-dismiss cap still lacks executable proof |
| Variable substitution preserves data and sensitive flags | `COVERED` | `agentContextUtils.test.ts`, `agentContextFactory.test.ts`, `sensitiveRedaction.test.ts` (no secret value reaches the serialized prompt or masked logs) |
| Coordinates-based fallback remains available when DOM resolution is insufficient | `PARTIAL` | deterministic routing/action-shape proof passed; repeatable live DOM→vision trigger remains deferred |
| Retrieved knowledge reaches the final prompt | `COVERED` | `knowledgeService.test.ts` (parse/retrieve) + `knowledgeInjection.test.ts` (content injected under `<retrieved_knowledge>` in the constructed prompt) |

### Functional Requirements

| FR | Status | Evidence |
| --- | --- | --- |
| `FR-001` | `COVERED` | `elementBased.generateAction.test.ts`, `engine-fixture.spec.ts` |
| `FR-002` | `COVERED` | `utils.test.ts`, `engine-fixture.spec.ts` |
| `FR-003` | `COVERED` | `parseModel.test.ts`, `providerProxy.test.ts` |
| `FR-004` | `COVERED` | `providerProxy.test.ts`, `proxy.test.ts` |
| `FR-005` | `COVERED` | `elementBased.generateAction.test.ts` |
| `FR-006` | `PARTIAL` | `webAgent.maxSteps.test.ts`, `executor.maxSteps.test.ts`; modal-dismiss branch still lacks proof |
| `FR-007` | `COVERED` | `timeout.test.ts`, `go_to_url.test.ts`, `js_action.test.ts`, `ai_assert.test.ts` |
| `FR-008` | `COVERED` | `agentContextUtils.test.ts`, `agentContextFactory.test.ts`, `sensitiveRedaction.test.ts` |
| `FR-009` | `PARTIAL` | `openaiActionShape.test.ts`, `elementBased.generateAction.test.ts`; live trigger remains deferred |
| `FR-010` | `DEFERRED` | owned by the CLI/MCP allowlist seam (`002` / `003`), not by this engine-only verification pass |

### Success Criteria

| SC | Status | Evidence |
| --- | --- | --- |
| `SC-001` | `COVERED` | `elementBased.generateAction.test.ts` covers mapping and error paths in the default gate |
| `SC-002` | `COVERED` | `providerProxy.test.ts`, `parseModel.test.ts`, `proxy.test.ts` |
| `SC-003` | `COVERED` | `utils.test.ts` plus fixture-backed locator resolution in `engine-fixture.spec.ts` |
| `SC-004` | `COVERED` | `webAgent.maxSteps.test.ts`, `executor.maxSteps.test.ts` |

## Agent Test Evidence

- none in this pass

## Manual Verification Log

### 2026-06-07

- Environment:
  local verification pass in `encore`
- Scenarios checked:
  automated unit and fixture-backed browser lanes only
- Result:
  both lanes passed
- Anomalies:
  none

### 2026-06-09

- Environment:
  local model-improvement pass in `feng/workspace`
- Scenarios checked:
  reconciled the report with the current map (redaction + knowledge-injection gaps
  closed; dom-extraction custom-class calibrated to WEAK); re-ran the unit + browser lanes
- Result:
  both lanes passed (`255` unit, `4` browser)
- Anomalies:
  none

## Findings

List blocking failures first.

- [ ] `INFO fr-010-cross-feature-seam`: `FR-010` in the reconstructed 001 spec is
  not proven by `sdk-core` lanes. The allowlist / no-bypass seam belongs to the
  CLI and MCP product boundaries and should be grounded by feature `002` / `003`
  evidence, not overstated here. Follow-up: keep feature 001 scoped to engine-local proof.

## Deferred / Residual Risk

- [ ] `exp-action-execution-config`: transpiled Playwright code is shape-tested
  but not executed against a browser fixture. Retest:
  add a fixture-backed browser spec for one transpiled action. Pass criterion:
  generated code executes successfully end to end.
- [ ] `exp-vision-fallback`: deterministic handoff to coordinates-based actions
  is covered, but the live DOM→vision trigger remains deferred. Retest:
  `RUN_PURE_VISION_LIVE=1 pnpm --filter sdk-core test` or a new keyed fixture.
  Pass criterion: the engine emits and executes a coordinates-based action when
  DOM resolution is insufficient.
- [ ] `exp-dom-extraction`: custom `interactive_class_names` behavior is still
  backed only by a WEAK local-only browser spec (not a CI gate). Retest:
  extend the CI fixture to assert a custom interactive class name is discoverable.
  Pass criterion: the custom interactive element is present in the extracted DOM
  tree and selector map within the gate.
- [ ] `exp-step-budgets`: modal auto-dismissal is implemented but unproven.
  Retest: add a dismissible-modal fixture and run a browser spec. Pass
  criterion: progress stops within `MAX_MODAL_DISMISSAL_STEPS`.

## Cleanup

- Cleanup performed:
  none
- Resources intentionally left behind:
  calibrated `quality-map.yaml` (dom-extraction evidence reliability)
- Follow-up cleanup required:
  none

## Coverage Summary

- Total testing whats:
  `10`
- COVERED:
  `6`
- PARTIAL:
  `4`
- IMPLICIT:
  `0`
- NOT COVERED:
  `0`
- NOT MEASURED:
  `0`
- MANUAL:
  `0`
- BLOCKED:
  `0`
- DEFERRED:
  `0`

## Notes

- This pass reconciled the report with the current map: two prompt-layer gaps
  (`exp-variable-substitution` redaction, `exp-knowledge-injection`) are now closed by
  proofs already cited in the map, and `exp-dom-extraction`'s custom-class evidence was
  calibrated to WEAK. No production or test code changed.
- Run outcomes, freshness, and confidence live here in `test-report.md`, not in
  `quality-map.yaml`.
