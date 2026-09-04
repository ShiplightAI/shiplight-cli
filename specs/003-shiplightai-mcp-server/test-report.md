# Test Report: @shiplightai/mcp UI-Automation Server

**Spec**: [../../specs/003-shiplightai-mcp-server/spec.md](../../specs/003-shiplightai-mcp-server/spec.md)
**Test spec**: [test-spec.md](./test-spec.md)
**Quality map**: [quality-map.yaml](./quality-map.yaml)
**Branch / commit**: `main` / `6d6556abd`
**Created**: `2026-06-05`
**Last updated**: `2026-08-11`
**Tester**: `/shiplight cover — v1-cloud removal reconciliation`

This pass reconciles the report with the v1 cloud removal (PR #2230) and repairs
citation drift that predates it.

Five test files cited as evidence here no longer exist. They were **not** wrong when
written — `cloudTokenGating.test.ts`, `resolveLocalReferences.test.ts`,
`matchEnvironmentByUrl.test.ts` and `saveFunction.test.ts` were deleted by
`736d9e973` ("browser-only server, drop the v1 cloud surface") and
`scaffold-mcp-wrapper.test.ts` by `5b0ed8eeb` ("move test authoring from MCP into
CLI"). The code they covered went with them; nobody reconciled this report, so the
rows survived as evidence for requirements that no longer exist. Every remaining
citation in this file has been verified to resolve to a file on disk.

Unit lanes were re-run this session. The browser lane was NOT re-run (its evidence
remains the 2026-06-09 run).

## Summary

- Overall status: `PASS`
- What this session added or strengthened:
  the session-bound boundary is now a standing, negative-tested guard —
  `sessionBoundToolSurface.test.ts` pins the registered surface to exactly
  `generate_html_report`/`upload_html_report` and covers the registry mapping
  tables (whose hand-written reverse map had already drifted once; it is now
  derived from the forward map). `getResource.test.ts` proves
  `shiplight://yaml-test-spec` and its legacy alias no longer resolve and that the
  action-entity resource references no removed tool.

  This pass closes SC-007 and FR-014: `actionEntityResourceMatchesRegistry.test.ts`
  asserts the resource renders exactly the advertised actions and that every
  registered tool is either advertised or on a named exclusion list, so registry
  drift now fails a test. Contract C7 gains a packaging guard
  (`chromeExtensionPackaging.test.ts`) in the lane the publish workflow gates on.
  FR-011 moves from `DEFERRED` to `COVERED` — the `PWDEBUG=console` dependency is
  confirmed and pinned by `getActionEntityLocatorInfo.test.ts`.

  Lanes green this session: `76/76` mcp-tools unit, `29/29` mcp-server unit,
  `14/14` for the two new sdk-core files backing FR-011.
- Blocking findings:
  none in this pass
- Known gaps left for follow-up:
  the browser lane (`test:browser`) was not re-run this session — FR-001/FR-006 and
  the FR-002 action-entity framing rest on the 2026-06-09 run; plus the prior
  environment-dependent deferrals (live `act(verify)`, timeout auto-cleanup,
  `attach_to_browser` handler wrapper, cookie/IndexedDB capture). The
  reference-traversal deferral is retired, not closed: `template:`/`call:`
  resolution left this feature with `FR-009` and is now 002's `FR-022`

## Source Material

- [Feature spec](../../specs/003-shiplightai-mcp-server/spec.md)
- [Project map](../../project-map.yaml)
- [Project proof strategy](../../TESTING.md)
- `apps/mcp-server` (server, stdioGuards, telemetry)
- `packages/mcp-tools` (tools, backends/SessionManager + ExtensionRelayServer, registry, resources; the scaffolder moved to `apps/cli/src/scaffold/`)
- `packages/types` (validation threshold shared with 002's `transpile --strict`)
- `packages/shiplight-tools` (YAML transpile engine — now solely 002's authoring surface)
- [Published package README](../../apps/mcp-server/README.md)

## Tests Added Or Updated

| Type | Files | Tests |
| --- | ---: | ---: |
| Unit | 2 | 15 |
| Contract | 0 | 0 |
| Integration | 0 | 0 |
| E2E | 0 | 0 |
| Agent | 0 | 0 |
| Script / static | 0 | 0 |
| **Total** | **2** | **15** |

### File List

- `packages/mcp-tools/src/tools/__tests__/sessionBoundToolSurface.test.ts` (NEW, 13
  tests) — the FR-012/FR-013 standing guard: registered surface is exactly
  `generate_html_report`/`upload_html_report`; no authoring tool in the registry's
  forward map; no authoring method reachable; reverse map derived from the forward
  map (the hand-written inverse had kept two dead rows after the tool removal).
  Negative-tested: reintroducing `scaffold_project` trips it.
- `packages/mcp-tools/src/resources/__tests__/getResource.test.ts` (MODIFIED, +2
  tests) — `shiplight://yaml-test-spec` and its `-v1.3.0` alias return undefined and
  are not advertised (FR moved-spec guard); action-entity content names no removed
  tool/resource and carries a CLI authoring pointer (FR-015).
- DELETED with their tools: `validateTestYaml.test.ts` (envelope now lives in 002 as
  `transpile --strict`), `scaffold-mcp-wrapper.test.ts` (scaffolder + suite moved to
  `apps/cli/src/scaffold/`).
- (prior passes) storage-state browser round-trip; quality-artifact migration

## Commands Run

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm --filter mcp-tools test:unit` | `PASS` | `76 pass / 0 fail`, incl. the new `actionEntityResourceMatchesRegistry` parity guard (3/3). The count fell from 115 as the v1 cloud suites went with their code in `736d9e973`. |
| `pnpm --filter @shiplightai/mcp test:unit` | `PASS` | `29 pass / 0 fail`, incl. the new `chromeExtensionPackaging` guard (4/4) |
| `node --test src/llm_tools/getActionEntityLocatorInfo.test.ts src/dom/utils/locator.test.ts` (sdk-core) | `PASS` | `14 pass / 0 fail`; the FR-011 proof |
| `pnpm --filter @shiplightai/mcp typecheck` | `PASS` | typecheck clean |
| `pnpm --filter mcp-tools test:browser` | `NOT RUN` | not re-run this session; browser-surface evidence is the 2026-06-09 run (`11 pass`) |

> Note: mcp-tools no longer needs a `.tpl` loader — the templates moved to
> `apps/cli` with the scaffolder, and the package's `test:unit` is now plain
> `node --test --import tsx`. (The loader note from the 06-09 pass is obsolete.)

Negative-path log lines (`[ERROR]` / `Failed to ...`) emitted by the tools are
assertions, not failures.

## Coverage Matrix

Use statuses consistently: `COVERED`, `PARTIAL`, `IMPLICIT`, `NOT COVERED`,
`NOT MEASURED`, `MANUAL`, `BLOCKED`, or `DEFERRED`.

### Testing What

| What | Risk | Status | Evidence |
| --- | --- | --- | --- |
| Browser tools (navigate/act/inspect/get_locators) drive a real page | 5 | `PARTIAL` | `browserTools.behavior.test.ts` via `test:browser` (deterministic tools gated); live `act(verify)` self-skips in CI |
| Sessions are created, isolated, and cleaned up | 4 | `PARTIAL` | `browserTools.behavior.test.ts` (create→use→close + 2-session isolation); timeout auto-cleanup deferred |
| `save_storage_state` persists + `new_session` restores session auth state | 3 | `PARTIAL` | `browserTools.behavior.test.ts` round-trip (localStorage capture asserted in the saved file + read back after restore); cookie/IndexedDB capture not separately asserted |
| Located actions return replay-ready entities (locator/xpath/frame_path) | 4 | `IMPLICIT` | exercised by the 06-09 `browserTools.behavior.test.ts` run (act/get_locators drive real elements); no dedicated payload-shape assertion yet — roundtrip evidence moved to 002 |
| Registered surface is session-bound (no authoring tools, incl. registry maps) | 4 | `COVERED` | `sessionBoundToolSurface.test.ts` (13 assertions, negative-tested at introduction) |
| Server holds no credential and calls no Shiplight endpoint | 4 | `COVERED` | `sessionBoundToolSurface.test.ts` — the registered surface is exactly the session-bound set, so a cloud tool cannot reappear without failing it. The credential itself is gone: no `SHIPLIGHT_API_TOKEN` read remains outside tests |
| Chrome relay attaches existing tabs over CDP | 4 | `COVERED` | `ExtensionRelayServer.test.ts` (loopback WS + disconnect→reconnect); `RelayTools` tool-handler wrapper covered only transitively |
| Stdio guards keep the JSON-RPC channel clean | 4 | `COVERED` | `stdioGuards.test.ts` (+ install-pattern zero-stdout integrity) |
| Resources: yaml-test-spec gone; action-entity clean + CLI pointer | 3 | `COVERED` | `getResource.test.ts` (negative resolution + content guards) |
| Tool registry dispatch + completeness | 3 | `COVERED` | `toolRegistry.test.ts`, `toolRegistrationCompleteness.test.ts` |
| Console / network log capture | 3 | `PARTIAL` | `browserTools.behavior.test.ts`; size-limit/truncation not asserted |
| `new_session` validates/normalizes options | 2 | `PARTIAL` | `newSessionSchema.test.ts` (schema-level); options-take-effect via lifecycle |
| MCP resource URIs resolve (incl. legacy aliases; yaml-test-spec MUST NOT) | 2 | `COVERED` | `getResource.test.ts` |
| Action-entity resource matches the live registry | 3 | `COVERED` | `actionEntityResourceMatchesRegistry.test.ts` (parity both directions + honest-exclusion check; negative-tested) |
| Relay extension reaches the published tarball | 3 | `COVERED` | `chromeExtensionPackaging.test.ts` (source completeness, manifest background target, `files` entry, built output; negative-tested by removing `manifest.json`) |
| Semantic locators require `PWDEBUG=console`; XPath otherwise | 3 | `COVERED` | `getActionEntityLocatorInfo.test.ts` (mutually exclusive `locator`/`xpath`) |

### Functional Requirements

| FR | Status | Evidence |
| --- | --- | --- |
| `FR-001` | `PARTIAL` | `browserTools.behavior.test.ts` (deterministic browser tools gated); live `act(verify)` self-skips in CI |
| `FR-002` | `IMPLICIT` | re-framed to the action-entity replay payload; exercised by the 06-09 browser run, no dedicated payload assertion (see Deferred) |
| `FR-003` | `COVERED` | `ExtensionRelayServer.test.ts` (CDP attach + reconnect) |
| `FR-006` | `PARTIAL` | `browserTools.behavior.test.ts` (isolation/teardown); timeout auto-cleanup deferred |
| `FR-007` | `DEFERRED` | `[MOVED]` to 002 `FR-018`; evidence (`yamlRoundtrip.test.ts`, 329-test types lane) now recorded there |
| `FR-008` | `COVERED` | `stdioGuards.test.ts` (stderr routing + zero-stdout install-pattern) |
| `FR-010` | `COVERED` | `toolRegistry.test.ts`, `toolRegistrationCompleteness.test.ts` |
| `FR-011` | `COVERED` | `getActionEntityLocatorInfo.test.ts` — with the flag the entity carries a semantic `locator` and omits `xpath`; without it the reverse. The two are mutually exclusive, so an entity is unambiguous on replay. `locator.test.ts` covers the module's own null/fallback paths |
| `FR-012` | `COVERED` | `sessionBoundToolSurface.test.ts` (surface exactly generate/upload report; authoring tools absent) |
| `FR-013` | `COVERED` | `sessionBoundToolSurface.test.ts` (no authoring tool/method in the registry maps; reverse map derived) |
| `FR-014` | `COVERED` | `actionEntityResourceMatchesRegistry.test.ts` — rendered headings equal the advertised set, catching `generateToolDocumentation`'s silent `if (!tool) continue` skip |
| `FR-015` | `COVERED` | `getResource.test.ts` content guard (no removed surface; CLI authoring pointer present) |
| `FR-016` | `PARTIAL` | the hand-written `ActionEntity` prose block remains in `resources/index.ts`; flagged for derivation or deletion |

### Success Criteria

| SC | Status | Evidence |
| --- | --- | --- |
| `SC-001` | `COVERED` | `browserTools.behavior.test.ts` (real headless browser, CI-gated `test:browser` lane) |
| `SC-002` | `COVERED` | `browserTools.behavior.test.ts` (create→use→close + two-session isolation/teardown + storage-state round-trip) |
| `SC-003` | `IMPLICIT` | re-framed to the replay payload; 06-09 browser run exercises it, dedicated assertion deferred |
| `SC-005` | `COVERED` | `stdioGuards.test.ts`, `ExtensionRelayServer.test.ts`, `toolRegistrationCompleteness.test.ts`. The local-reference cases that kept this `PARTIAL` left with `FR-009` (now 002 `FR-022`) |
| `SC-006` | `COVERED` | `sessionBoundToolSurface.test.ts` — standing guard, fails on reintroduction (negative-tested) |
| `SC-007` | `COVERED` | `actionEntityResourceMatchesRegistry.test.ts` asserts parity in both directions plus an honest-exclusion check; negative-tested by adding an unregistered action, which fails the parity assertion |

## Agent Test Evidence

- none in this pass

## Manual Verification Log

### 2026-06-07

- Environment:
  local verification pass in `encore`
- Scenarios checked:
  automated mcp-tools unit, mcp-server unit, shiplight-types unit, and keyless
  mcp-tools browser e2e lanes only
- Result:
  all lanes passed (`158`, `10`, `284`, `9`)
- Anomalies:
  none

### 2026-06-09

- Environment:
  local model-improvement pass in `feng/workspace`
- Scenarios checked:
  re-scoped the quality map to the real surface; added `validate_yaml_test` handler
  unit proof and a `save_storage_state` browser round-trip; re-ran all mapped lanes
- Result:
  all lanes passed (`161` mcp-tools unit, `10` mcp-server unit, `289` shiplight-types,
  `48` shiplight-tools, `11` mcp-tools browser)
- Anomalies:
  none

### 2026-07-21

- Environment:
  local `/shiplight cover` reconciliation pass in `encore` (uncommitted working tree)
- Scenarios checked:
  authoring-boundary removal guards (tool surface, registry maps, resources);
  re-ran mcp-tools/types/tools unit lanes; mcp-server typecheck + build. Browser
  lane intentionally not re-run.
- Result:
  all executed lanes passed (`115` mcp-tools unit, `329` types, `59` tools)
- Anomalies:
  the registry's hand-written reverse map had retained two dead authoring rows
  after the tool removal (caught by external review, fixed by deriving the map);
  the relocated YAML spec had kept two `shiplight://` deferrals (caught by this
  pass, fixed in 002)

## Findings

List blocking failures first.

- [ ] `INFO env-allowlist-shared-seam`: the env-var allowlist boundary that protects
  what the agent SDK sees is owned and proven by the CLI (`002`,
  `fixture.allowlist*.test.ts`). This feature relies on it but does not re-prove it;
  keep the proof explicit on the CLI side.
- [x] `LOW exp-local-references`: retired, not fixed. `resolveLocalReferences` was
  deleted with the authoring surface in `736d9e973`; `template:`/`call:` resolution
  now lives in the CLI transpiler and is 002's `FR-022`. The path-traversal,
  absolute-path and Windows-separator cases remain unwritten **there** — carry them
  into 002's test-spec rather than treating them as closed.

## Deferred / Residual Risk

- [ ] `exp-browser-tools-behavior`: the live `act(verify)` → LLM assertion path runs
  locally but self-skips in CI (no key). Retest:
  a keyed CI job that exercises `act(verify)` against a fixture page. Pass criterion:
  the assertion is evaluated against the live page in CI.
- [ ] `exp-session-lifecycle`: timeout-driven auto-cleanup of idle sessions is not
  exercised. Retest:
  a fast-timeout SessionManager test. Pass criterion: idle sessions are auto-reaped.
- [ ] `exp-storage-state`: the round-trip is proven for localStorage only; cookie and
  IndexedDB capture/restore are not separately asserted. Retest:
  extend the fixture to set a cookie + an IndexedDB record and assert both survive the
  save → restore round-trip. Pass criterion: all three state types persist.
- [ ] `exp-validate-yaml`: flat statement flows are proven through the handler; the
  suite/hooks/params/template inputs the tool also accepts are exercised only at the
  engine layer. Retest: a handler case for a suite YAML (hooks + params). Pass
  criterion: the same valid/invalid envelope holds for a suite.
- [ ] `exp-yaml-export`: the roundtrip is proven on the shared `shiplight-types`
  primitives, not the MCP save/export tool wiring. Retest:
  an MCP-layer test that captures a short session and exports via the save tool. Pass
  criterion: the exported YAML replays equivalently.
- [ ] `exp-cloud-token-gating`: enforcement is proven at the client-method layer; the
  registration-time conditional (exactly the 7-tool subset registers iff a token
  exists) is only indirect. Retest:
  export a pure cloud-tool-selection helper from `server.ts` and unit-test the
  registered set. Pass criterion: the registered set matches token presence.
- [ ] `exp-chrome-relay`: the backend is proven, but the `RelayTools.attachToBrowser`/
  `getRelayStatus` tool-handler wrapper is not separately driven. Retest:
  a handler-level test calling `attach_to_browser` against a stub relay server. Pass
  criterion: the handler returns the attached page/targets and a clear no-relay error.
- [ ] `exp-stdio-guards`: a full live stdio transport with the real MCP SDK is not
  separately exercised. Retest:
  an end-to-end stdio transport smoke. Pass criterion: a real JSON-RPC exchange stays
  uncorrupted.
- [ ] `exp-log-capture`: the documented log size-limit/truncation behavior is not
  asserted. Retest:
  assert the documented log-limit/truncation. Pass criterion: capture respects the
  limit.

## Cleanup

- Cleanup performed:
  the storage-state browser test removes its temp state file in `after()`; the browser
  lane creates and tears down sessions and temp scaffolds
- Resources intentionally left behind:
  re-scoped `quality-map.yaml` and the two new/updated test files
- Follow-up cleanup required:
  none

## Coverage Summary

- Total testing whats:
  `16`
- COVERED:
  `9`
- PARTIAL:
  `6`
- IMPLICIT:
  `1`
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

- This pass re-scoped the checked-in quality map to the real behavioral surface
  (debugger/transpile evidence captured, cloud-gating scope corrected, weak proof
  calibrated) and modeled `save_storage_state` + `validate_yaml_test` with new proof.
  Both new tests flow to Quality Center via existing emission lanes (the unit-JUnit
  glob and the browser-tests lane) — no workflow change required.
- Run outcomes, freshness, and confidence live here in `test-report.md`, not in
  `quality-map.yaml`.
