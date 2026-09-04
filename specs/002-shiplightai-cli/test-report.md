# Test Report: shiplightai CLI & Playwright Library

**Spec**: [../../specs/002-shiplightai-cli/spec.md](../../specs/002-shiplightai-cli/spec.md)
**Test spec**: [test-spec.md](./test-spec.md)
**Quality map**: [quality-map.yaml](./quality-map.yaml)
**Branch / commit**: `encore` / `315b12363` + uncommitted working tree
**Created**: `2026-06-05`
**Last updated**: `2026-07-21`
**Tester**: `/shiplight cover — authoring-boundary reconciliation`

This pass records the authoring surface this feature absorbed from 003: the
scaffolder (now `apps/cli/src/scaffold/`, with the merge contract and its tests),
`transpile --strict` (replacing MCP `validate_yaml_test`), `create --json`
(replacing MCP `scaffold_project`), `shiplight spec yaml|actions`, dist-tag-free
version pinning, and token-first env guidance. The CLI no longer depends on
`mcp-tools` at all. Unit and logic lanes re-run; the keyless browser lane was NOT
re-run this session (evidence is the 2026-06-09 run).

## Summary

- Overall status: `PASS`
- What this session added or strengthened:
  the authoring boundary is proven CLI-side. New suites: `scaffold/index.test.ts`
  (moved in-package; merge contract, path safety, `toDependencyRange` range policy,
  refuse-before-write on a bad version), `commands/create.test.ts` (real-version
  caret pin in BOTH the fresh-write and agent-merge paths — never a dist-tag;
  `--json` parses with no prose leaked and is non-lossy; env guidance offers both
  credential paths token-first, prose/JSON in lockstep), `commands/transpile.test.ts`
  (`--strict` arg parsing incl. the flag-eaten-as-glob regression),
  `commands/spec.test.ts` (asset resolution; rendered-doc guards: no `element_index`
  YAML kwarg, targeting note present, no `shiplight://` URI in shipped docs — all
  negative-tested), `cliVersion.test.ts` (version resolution in bundle/source
  layouts; skips foreign and malformed package.json), and 6 new
  `isBelowCoverageThreshold` tests in shiplight-types (verdict provably agrees with
  the emitted warning). Lanes: `588` unit (587 pass / 1 platform skip), `209` logic,
  `329` types, `59` tools.
- Blocking findings:
  none in this pass
- Known gaps left for follow-up:
  the keyless browser lane (create/debug/test e2e) not re-run this session; the
  US6 offline authoring loop (container with no MCP server) exercised manually,
  not as a gated e2e; the `spec` doc guards self-skip when `dist/spec` is unbuilt
  (they ran against a built dist here); `--strict` not exercised through the built
  `cli.js`; plus the prior deferrals (network chain, SSE loop, in-gate tsc of a
  transpiled spec, merged-report content, cloud cache path)

## Source Material

- [Feature spec](../../specs/002-shiplightai-cli/spec.md)
- [Project map](../../project-map.yaml)
- [Project proof strategy](../../TESTING.md)
- `apps/cli` (commands, debugger, reporter, transpiler, fixture, cache, dotenvSource, versionCheck)
- `packages/mcp-tools` (shared scaffolder core)
- https://docs.shiplight.ai/local/cli-reference
- [Published package README](../../apps/cli/README.md)

## Tests Added Or Updated

| Type | Files | Tests |
| --- | ---: | ---: |
| Unit | 6 | 62 |
| Contract | 0 | 0 |
| Integration | 1 | 5 |
| E2E | 0 | 0 |
| Agent | 0 | 0 |
| Script / static | 0 | 0 |
| **Total** | **7** | **67** |

### File List

- (this pass) `apps/cli/src/commands/create.test.ts` (NEW, 12) — version pin from the
  REAL running CLI in fresh-write and merge-template paths; no floating dist-tag;
  `--json` single-object/non-lossy/untouched-files; env-guidance both-paths
  token-first lockstep guard (which caught two of its own strings at introduction).
- (this pass) `apps/cli/src/commands/spec.test.ts` (NEW, 17) — topic parsing;
  built-asset-over-source resolution; no source fallback for generated `actions`;
  rendered-doc guards (`element_index` never a YAML kwarg — negative-tested;
  element-targeted annotation present; shipped docs MCP-free per FR-016/SC-008).
- (this pass) `apps/cli/src/commands/transpile.test.ts` (NEW, 6) — `--strict`/glob
  arg parsing; guards the leading-`--strict`-swallowed-as-glob failure mode (a
  strict gate that matches zero files exits 0).
- (this pass) `apps/cli/src/cliVersion.test.ts` (NEW, 8) — own-package.json walk-up
  in bundle and source layouts; never returns a foreign package's version; throws
  actionably rather than yielding a placeholder (`^dev` is uninstallable).
- (this pass) `apps/cli/src/scaffold/index.test.ts` (MOVED from mcp-tools, +12) —
  the full merge-contract/path-safety suite now runs in this package's own lane;
  added `toDependencyRange` policy tests (caret pin, prerelease, reject
  latest/next/dev/ranges) and no-write-on-invalid-version.
- (this pass) `packages/types/src/test-flow/validateTestYaml.test.ts` (MODIFIED, +6)
  — `isBelowCoverageThreshold` agrees with the emitted warning; 50% floor passes;
  empty/absent stats are not shortfalls; explicit threshold honored.
- (superseded) Two files previously cited here were deleted with the code they
  covered, not renamed: `standalone-export.test.ts` by `c92335690` ("remove the
  unreachable export surface from shiplight-tools"), and `statementHash.test.ts` by
  `f24fd3dfd` ("remove dead statement-hash and action-entity resolution"). Evidence
  cells above carry live citations only, so a mechanical "does every cited file
  exist" check stays a usable guard against this drift.
- (prior pass) no CLI test code added — map re-scoping only: `exp-debug-server` evidence
  expanded to the real deterministic proofs (`manager.test.ts` promoted to DIRECT
  session-lifecycle, plus `portUtils.test.ts`, `playwrightDebug.test.ts`,
  `routes/testFlow.test.ts`, `services/playwrightSandbox.test.ts`); `exp-transpile`
  gained `tests/conformance/action-parity.test.ts` (CLI transpiler ↔ sdk-core parity).
- (prior pass) `apps/cli/src/fixture.allowlist.runtime.test.ts` — runtime no-leak proof
  for the env allowlist (`exp-env-allowlist`), upgrading the prior STATIC wiring guard.
- (prior pass) `apps/cli/src/fixture.contextOptions.test.ts` — repaired the
  `VIEWPORT_INCOMPATIBLE_OPTIONS` Playwright drift guard (1.58.2 removed `coreBundle.js`).
- (prior pass) migrated quality artifacts to the current contract and re-ran existing evidence

## Commands Run

| Command | Result | Notes |
| --- | --- | --- |
| `cd apps/cli && pnpm test:unit` | `PASS` | `1009 pass / 0 fail / 1 skip` (platform-gated Windows path test) |
| `cd apps/cli && pnpm test:logic` | `PASS` | `226 pass / 0 fail`. This lane is separate from `test:unit` and was the one that caught a broken import during PR #2230 — run both |
| `pnpm --filter shiplight-types test:unit` | `PASS` | `417 pass / 0 fail`; roundtrip (FR-018) + the new `replaceVariables` suite (FR-007) |
| `cd apps/cli && pnpm build` | `PASS` | full build incl. `dist/spec/` render (28 actions, 2 agent-only excluded and named) + debugger assets; `cli.js` 226,150 B vs 219,371 B pre-change despite four new commands (dropping bundled mcp-tools offset it) |
| `node dist/cli.js create <tmp>` / `spec yaml` / `spec actions` | `PASS` | built-bundle smoke: scaffold pins `"shiplightai": "^0.1.93"`; both spec topics print |
| `cd apps/cli && pnpm test:browser` | `NOT RUN` | not re-run this session; create/debug/test e2e evidence is the 2026-06-09 run (`8 pass`) |

Negative-path log lines (`Error:` / `Failed to transpile`) are assertions, not failures.

## Coverage Matrix

Use statuses consistently: `COVERED`, `PARTIAL`, `IMPLICIT`, `NOT COVERED`,
`NOT MEASURED`, `MANUAL`, `BLOCKED`, or `DEFERRED`.

### Testing What

| What | Status | Evidence |
| --- | --- | --- |
| Only allowlisted env vars reach the agent SDK; no `process.env` bypass | `COVERED` | `fixture.allowlist.test.ts` (unit), `fixture.allowlist.wiring.test.ts` (static), `fixture.allowlist.runtime.test.ts` (runtime: polluted `process.env` → `getSdkConfig().env`, mutation-verified) via `pnpm test:unit` |
| Test context + variable overrides resolve into the run | `COVERED` | `fixture.test.ts` plus `test.vars.e2e.test.ts` |
| Per-test context options override project use, with PW drift guard | `COVERED` | `fixture.contextOptions.test.ts` |
| `.env` discovery walks to root with closest-wins precedence | `COVERED` | `dotenvSource.test.ts` |
| YAML transpiles to correct Playwright specs | `COVERED` | `transpile.test.ts`, `transpile-pipeline.test.ts`, `conformance/action-parity.test.ts` (parity vs sdk-core); a transpiled spec is also run end-to-end by `test-run.e2e.test.ts`. Residual: no in-gate tsc type-check of the generated spec |
| Version-behind warning + global-install block | `COVERED` | `versionCheck.test.ts` |
| Action-entity cache self-heals across runs | `PARTIAL` | `actionEntityCacheClient.test.ts`, `actionCache.test.ts`; cloud path only via no-op/error tests |
| `shiplight create` scaffolds a valid runnable project | `PARTIAL` | `create.e2e.test.ts` (06-09 run) + in-package `scaffold/index.test.ts`; full create→install→run network chain not gated |
| `create` never clobbers a populated repo; `--json` non-lossy | `COVERED` | `scaffold/index.test.ts` (merge contract, path safety), `commands/create.test.ts` (payload shape, untouched files) |
| Scaffold pins `^<running version>`, never a dist-tag (both paths) | `COVERED` | `toDependencyRange` unit + `create.test.ts` real-version seam + merge-template assertion |
| `transpile --strict` fails on low coverage with the default mode's figures | `COVERED` | `isBelowCoverageThreshold` unit (verdict = warning), `transpile.test.ts` args; strict-through-built-cli not gated |
| `spec yaml`/`spec actions` resolve and shipped docs are correct | `COVERED` | `spec.test.ts` (resolution + element_index/targeting/MCP-free guards, negative-tested); guards self-skip pre-build |
| Env guidance offers token-first both credential paths, prose↔JSON lockstep | `COVERED` | `create.test.ts` per-state guard over both exported maps |
| TestFlow ↔ YAML roundtrip (moved from 003) | `COVERED` | `yamlRoundtrip.test.ts` via the 329-test shiplight-types lane |
| `shiplight test` real run + exit-code propagation | `PARTIAL` | `test-run.e2e.test.ts`, `test.vars.e2e.test.ts`; non-core flag forwarding only indirect |
| `shiplight debug` server boots + serves session API | `PARTIAL` | `manager.test.ts` (full session lifecycle), `portUtils.test.ts`, `playwrightDebug.test.ts` (inner-process spawn), `routes/testFlow.test.ts` (session-API routing), `playwrightSandbox.test.ts` (inner action-gen/exec), `index.test.ts` (CORS), `debug.e2e.test.ts` (boot); the live SSE statement loop is deferred |
| `shiplight report` merge + cloud routing | `PARTIAL` | `cloudUpload.test.ts` (routing DIRECT); merged-report HTML content not asserted |
| `shiplight inspect` outputs parsed TestFlow JSON | `COVERED` | `inspect.test.ts` |

### Functional Requirements

| FR | Status | Evidence |
| --- | --- | --- |
| `FR-001` | `COVERED` | `test.test.ts`, `test-run.e2e.test.ts`, `transpile.test.ts` |
| `FR-002` | `COVERED` | `create.e2e.test.ts`, `scaffold/index.test.ts` (five conflict cases, each with its merge strategy), `create.test.ts:119` (non-lossy `--json` parity) |
| `FR-003` | `PARTIAL` | `manager.test.ts`, `portUtils.test.ts`, `playwrightDebug.test.ts`, `routes/testFlow.test.ts`, `playwrightSandbox.test.ts`, `debug.e2e.test.ts`; live SSE statement loop deferred |
| `FR-004` | `COVERED` | `create.e2e.test.ts` asserts `shiplightConfig` wiring; `fixture.contextOptions.test.ts` covers the context-option merge |
| `FR-005` | `COVERED` | `report.test.ts`, `cloudUpload.test.ts`, `transpile.test.ts`, `inspect.test.ts` |
| `FR-006` | `COVERED` | `fixture.allowlist.test.ts`, `fixture.allowlist.wiring.test.ts`, `fixture.allowlist.runtime.test.ts` |
| `FR-007` | `COVERED` | `fixture.test.ts`, `test.vars.e2e.test.ts` |
| `FR-008` | `COVERED` | `dotenvSource.test.ts` |
| `FR-009` | `COVERED` | `versionCheck.test.ts` |
| `FR-010` | `PARTIAL` | `cloudUpload.test.ts` proves routing; merged-report content not asserted |
| `FR-011` | `COVERED` | `actionEntityCacheClient.test.ts`, `actionCache.test.ts`, `inlineFingerprintMap.test.ts` |
| `FR-012` | `COVERED` | run-usage-summary sub-spec ([test-spec](./run-usage-summary/test-spec.md)); reporter usage suites |
| `FR-013` | `COVERED` | `isBelowCoverageThreshold` unit (single rule, verdict agrees with warning) + `transpile.test.ts` |
| `FR-014` | `COVERED` | spec ships in-package (`dist/spec/yaml.md` via build render); `spec.test.ts` resolution |
| `FR-015` | `COVERED` | build-time render from the registry (`render-spec-assets.mts`); bundle-weight check (registry-only names absent from `cli.js`); `usesElementIndex` presentation rule |
| `FR-016` | `COVERED` | `spec.test.ts` MCP-free-docs guard; the relocated spec's two `shiplight://` deferrals were caught and repointed this pass |
| `FR-017` | `PARTIAL` | scaffold version stamped from real package.json (`cliVersion.test.ts`); transpiled-spec `vdev` stamp still possible under tsx (see Findings) |
| `FR-018` | `COVERED` | `yamlRoundtrip.test.ts` (evidence relocated from 003 `FR-007`) |
| `FR-019` | `COVERED` | `create.test.ts` (single parseable object, non-lossy vs prose, error-as-JSON path) |

### Success Criteria

| SC | Status | Evidence |
| --- | --- | --- |
| `SC-001` | `COVERED` | `fixture.allowlist.test.ts`, `fixture.allowlist.wiring.test.ts`, `fixture.allowlist.runtime.test.ts` (CI-gated) |
| `SC-002` | `COVERED` | `transpile.test.ts`, `transpile-pipeline.test.ts`, `conformance/action-parity.test.ts` (CI-gated) |
| `SC-003` | `COVERED` | `inspect.test.ts`, `versionCheck.test.ts`, `dotenvSource.test.ts`, `fixture.contextOptions.test.ts` |
| `SC-004` | `COVERED` | `create.e2e.test.ts`, `test-run.e2e.test.ts`, `debug.e2e.test.ts` (keyless browser lane, 06-09 run) |
| `SC-005` | `COVERED` | `create.test.ts` — every conflict in the prose payload appears in `--json` with template/strategy/instructions |
| `SC-006` | `COVERED` | `isBelowCoverageThreshold` agrees-with-warning test — same stats, verdict-only difference |
| `SC-007` | `PARTIAL` | offline authoring loop proven piecewise by unit suites + built-bundle smoke; no container e2e with an absent MCP server |
| `SC-008` | `COVERED` | `spec.test.ts` guards (registry-derived render, MCP-free docs), both negative-tested; self-skip pre-build is the residual |

## Agent Test Evidence

- none in this pass

## Manual Verification Log

### 2026-06-07

- Environment:
  local verification pass in `encore`
- Scenarios checked:
  automated unit, logic, and keyless browser e2e lanes only
- Result:
  all lanes passed
- Anomalies:
  none

### 2026-06-09

- Environment:
  local model-improvement pass in `feng/workspace`
- Scenarios checked:
  re-scoped `exp-debug-server` (cite real deterministic proofs) and `exp-transpile`
  (action-parity); re-ran the unit, logic, and keyless browser lanes
- Result:
  all lanes passed (`305/1-skip` unit, `204` logic, `8` browser, `161` mcp-tools unit)
- Anomalies:
  none

### 2026-07-21

- Environment:
  local `/shiplight cover` reconciliation pass in `encore` (uncommitted working tree)
- Scenarios checked:
  authoring surface absorbed from 003 (create merge/--json/version pin, transpile
  --strict, spec yaml/actions, env guidance); unit + logic + types + tools lanes;
  full build; built-bundle smoke of create/spec. Browser lane intentionally not
  re-run.
- Result:
  all executed lanes passed (`587/1-skip` unit, `209` logic, `329` types, `59`
  tools); built `cli.js` scaffolds with `^0.1.93` and serves both spec topics
- Anomalies (two more caught by external review after the initial pass, both
  fixed and re-verified: `dev:run` lacked the `.tpl` loader the scaffold move
  introduced, so `create` crashed in dev — the built CLI was unaffected; and
  `dist/spec/yaml-appendix.md` shipped with no topic serving it and no inbound
  reference — now not rendered, source kept in docs/):
  `spec actions` initially rendered `act`'s parameter surface — 11 of 28 actions
  advertised `element_index` (required), which the transpiler silently drops; fixed
  via the registry's own `usesElementIndex` flag as a presentation rule, guarded by
  negative-tested doc tests. The relocated YAML spec carried two dangling
  `shiplight://` deferrals; repointed to `npx shiplight spec actions`.

## Findings

List blocking failures first.

- [ ] `INFO env-allowlist-shared-seam`: the env-var allowlist boundary (`FR-006`/
  `SC-001`) is shared with the MCP server (`003`). It is proven on the CLI side by
  `fixture.allowlist*.test.ts`; keep the CLI-side proof explicit rather than assuming
  MCP coverage.

- [ ] `INFO transpiled-spec-version-stamp` (`FR-017`): specs transpiled via tsx
  (no tsup define) stamp `@generated by shiplightai vdev` — observed in this pass's
  scratch output. The built CLI stamps correctly. Consider wiring
  `resolveCliVersion()` into the transpile path so source-run output is stamped too.

## Deferred / Residual Risk

- [ ] `US6-offline-loop` (`SC-007`): the container e2e (install → create → spec →
  write YAML → transpile --strict, with no MCP server configured) is manual-only.
  Retest: scripted container run. Pass criterion: the loop completes offline.
- [ ] `spec-doc-guards-prebuild` (`SC-008`): the rendered-doc guards self-skip when
  `dist/spec` is unbuilt, so a pre-build CI unit lane does not exercise them.
  Retest: run `test:unit` after `pnpm build` in the release lane. Pass criterion:
  guards execute (not skipped) and pass.
- [ ] `exp-transpile`: a transpiled spec is run end-to-end and per-action output is
  pinned against sdk-core, but the generated `.yaml.spec.ts` is not separately
  tsc-type-checked in-gate. Retest: add a gated `tsc --noEmit` over a transpiled spec.
  Pass criterion: the generated spec type-checks.
- [ ] `exp-action-cache`: the cloud cache path is exercised only via the client
  no-op/error tests. Retest:
  add an integration test for the cloud cache path with a stubbed API. Pass
  criterion: a cloud lookup/update round-trips against the stub.
- [ ] `exp-create-scaffold`: the full `create → npm install → run` network chain
  is not gated. Retest:
  a nightly job that `npm install`s and runs the scaffolded example. Pass
  criterion: the example installs and passes.
- [ ] `exp-test-command`: flag forwarding beyond `--config`/`--reporter` is only
  indirect. Retest:
  assert a forwarded `--grep` selects the expected subset end-to-end. Pass
  criterion: only the matching specs run.
- [ ] `exp-debug-server`: the deterministic mechanics are now pinned in isolation, but
  the live interactive loop — create a session and stream one statement over SSE
  through the outer→inner proxy — is not exercised. Retest:
  a keyed e2e that creates a session and runs one statement via the debug server.
  Pass criterion: a statement streams progress and completes.
- [ ] `exp-report-merge`: merged-report file structure / HTML content is not
  asserted (merge delegated to Playwright merge-reports). Retest:
  assert the post-merge report contains the combined test count and copied
  screenshots. Pass criterion: the merged report reflects all shards.

## Cleanup

- Cleanup performed:
  none required; e2e lanes scaffold and tear down in temp dirs
- Resources intentionally left behind:
  re-scoped `quality-map.yaml`
- Follow-up cleanup required:
  none

## Coverage Summary

- Total testing whats:
  `18`
- COVERED:
  `13`
- PARTIAL:
  `5`
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

- This pass re-scoped `exp-debug-server` (the debugger's strongest proof,
  `manager.test.ts`, was mislabeled INDIRECT and four mechanic proofs were uncited)
  and `exp-transpile` (added the action-parity invariant). No production or test code
  changed; evidence framing only.
- Run outcomes, freshness, and confidence live here in `test-report.md`, not in
  `quality-map.yaml`.
