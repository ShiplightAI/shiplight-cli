# Tasks: shiplightai CLI & Playwright Library

**Input**: Design documents from `/specs/002-shiplightai-cli/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included — the spec's success criteria demand CI-gated proof and guards.

**Organization**: Grouped by user story (US1..US6 from spec.md).

## Reconstruction convention — read before running `/speckit-implement`

`shiplightai` **is published**. `[X]` records work that exists today, with the file
holding it; `[ ]` is genuinely open. `/speckit-implement` MUST skip `[X]` items.
Run `/speckit-converge` to surface gaps this list does not name.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 ESM + CJS dual build with seven entry points in `apps/cli/tsup.config.ts`
- [X] T002 [P] Peer-pin `@playwright/test` to the devDependency version in `apps/cli/package.json`
- [X] T003 [P] Four test lanes (unit / logic / browser / e2e) in `apps/cli/package.json`
- [X] T004 Build the debugger UI during tsup `onSuccess` in `apps/cli/scripts/build-debugger-ui.mts`

---

## Phase 2: Foundational (Blocking Prerequisites)

- [X] T005 Env allowlist assembled by `buildSdkEnv()` — the enforcement point for 001 FR-010 (FR-006, contract C3) in `apps/cli/src/`
- [X] T006 `.env` walk-up discovery with closest-wins precedence (FR-008) in `apps/cli/src/dotenvSource.ts`
- [X] T007 [P] `shiplightConfig()` wiring transpilation, `.env` and the reporter (FR-004) in `apps/cli/src/config.ts`
- [X] T008 [P] The `agent` Playwright fixture that generated specs import (contract C2) in `apps/cli/src/fixture.ts`
- [X] T009 argv dispatch forwarding unknown flags verbatim (FR-001, research D4) in `apps/cli/src/cli.ts`

---

## Phase 3: User Story 1 — Run YAML + Playwright tests with one command (P1)

- [X] T010 [US1] `shiplight test` spawning Playwright with flags forwarded (FR-001) in `apps/cli/src/commands/`
- [X] T011 [US1] YAML → spec transpilation with mtime caching and version stamp (FR-017, research D5) in `apps/cli/src/transpile.ts`
- [X] T012 [P] [US1] Statement, action and control-flow emitters in `apps/cli/src/yaml-transpiler/statements.ts`
- [X] T013 [P] [US1] Suite flattening (`beforeEach`/`afterEach`/named tests) in `apps/cli/src/yaml-transpiler/yamlParser.ts`
- [X] T014 [US1] Variable overrides `--vars`/`--vars-file`/`SHIPLIGHT_VARS_OVERRIDE` with sensitive-flag semantics (FR-007) in `apps/cli/src/`
- [X] T015 [P] [US1] Action-entity locator cache — no-op without a token, keyed by statement hash (FR-011) in `apps/cli/src/cache/`
- [X] T016 [P] [US1] Transpilation tests (SC-002) in `apps/cli/src/yaml-transpiler/pipeline.test.ts`
- [X] T017 [P] [US1] Action-transpiler parity against the engine registry in `apps/cli/tests/conformance/action-parity.test.ts`

---

## Phase 4: User Story 2 — Scaffold a runnable project (P1)

- [X] T018 [US2] `shiplight create` scaffolding, never modifying an existing file (FR-002) in `apps/cli/src/scaffold/`
- [X] T019 [P] [US2] Project templates in `apps/cli/src/scaffold/templates/`
- [X] T020 [US2] `--json` conflict payload — path, template, merge strategy, instructions (FR-019) in `apps/cli/src/scaffold/`
- [X] T021 [P] [US2] Scaffold tests in `apps/cli/src/scaffold/index.test.ts`; non-lossy JSON parity with the human output (SC-005) in `apps/cli/src/commands/create.test.ts:119`

---

## Phase 5: User Story 3 — Debug a YAML test interactively (P1)

- [X] T022 [US3] Outer express debug server with auto port selection (FR-003, research D7) in `apps/cli/src/debugger/index.ts`
- [X] T023 [US3] Inner server inside `npx playwright test` holding the live page in `apps/cli/src/debugger/manager.ts`
- [X] T024 [P] [US3] HTTP reverse proxy from the outer server to the inner Playwright process in `apps/cli/src/debugger/serverRoutes.ts`, with SSE streamed chunk-by-chunk in `apps/cli/src/debugger/routes/intRunner.ts`
- [X] T025 [P] [US3] `PlaywrightSandbox` executing statements against the live page in `apps/cli/src/debugger/services/playwrightSandbox.ts`
- [X] T026 [P] [US3] Debug routes — test flow, int-runner, email forwarding — in `apps/cli/src/debugger/routes/`
- [X] T027 [P] [US3] Debug-server e2e (SC-004) in `apps/cli/src/**/*.e2e.test.ts`
- [X] T028 [US3] Suite YAML support in the debugger: flatten a suite into one TestFlow with section boundaries and round-trip saves back to suite YAML, per the archived design in `specs/_archive/`

---

## Phase 6: User Story 6 — Author tests without an MCP server (P1)

- [X] T029 [US6] Ship the normative YAML spec in-package via `shiplight spec yaml` (FR-014) in `apps/cli/src/commands/`
- [X] T030 [US6] Render the action vocabulary from the engine registry at build time (FR-015, research D2) in `apps/cli/scripts/render-spec-assets.mts`
- [X] T031 [US6] Guard that no shipped document contains a `shiplight://` URI (FR-016, SC-008) in `apps/cli/src/`
- [X] T032 [US6] Guard that `spec actions` matches the live registry (SC-008) in `apps/cli/tests/conformance/`
- [X] T033 [US6] Offline authoring test: scaffold → read spec → write YAML → validate strict, no MCP (SC-007). No test chains the four steps — `apps/cli/src/commands/create.e2e.test.ts` holds a single scaffold assertion, and `transpile.test.ts` covers `--strict` in isolation

---

## Phase 7: User Story 4 — Wire Shiplight into an existing Playwright project (P2)

- [X] T034 [US4] `shiplightConfig()` composing with a user's existing config (FR-004) in `apps/cli/src/config.ts`
- [X] T035 [P] [US4] Context-option merge semantics (SC-003) in `apps/cli/src/fixture.contextOptions.test.ts`

---

## Phase 8: User Story 5 — Reports, transpile, inspect (P2)

- [X] T036 [US5] HTML reporter and `report-data.json` in `apps/cli/src/reporter/`
- [X] T037 [US5] Per-run LLM usage summary with token buckets, shard merge, run-complete upload (FR-012) in `apps/cli/src/reporter/runUsageAggregate.ts`
- [X] T038 [US5] Cloud upload routed by token type, absolute report URLs (FR-010) in `apps/cli/src/reporter/cloudUpload.ts`
- [X] T039 [US5] `transpile` validating with a single implementation for strict and default (FR-013, SC-006) in `apps/cli/src/commands/transpile.ts`
- [X] T040 [P] [US5] `inspect` plus version and global-install guards (FR-009, SC-003) in `apps/cli/src/`
- [X] T041 [P] [US5] Model-tier provenance in `report-data.json`, HTML-escaped where rendered (FR-021) in `apps/cli/src/reporter/`

---

## Phase 9: Tier Selection (spans US1 and US3)

- [X] T042 Pre-test org-settings fetch resolving the tier once per run and injecting it into the spawned process (FR-020) in `apps/cli/src/`
- [X] T043 [P] Failure policy — degrade on network/5xx/404, fail fast on 401/403 for `test`, warn for `debug`, skip on `--offline` (FR-020) in `apps/cli/src/`
- [X] T044 [P] Tier tests (SC-009) in `apps/cli/src/orgSettings.test.ts`, plus `readShiplightEnv` parent/child agreement in `apps/cli/src/dotenvSource.test.ts:160`. Scope note: `dotenvSource.test.ts:171` asserts parent-side readers are deliberately left unrouted, so end-to-end parity is not yet proven — that is T045 (wiring) and T052 (proof)
- [X] T045 Verify the CLI parent and spawned child resolve the same `.env` view end to end; the parent historically used `dotenv.config()` (cwd only, shell wins) while the child walked up with `.env` winning, which silently downgrades the action cache to Local — route both through `readShiplightEnv` in `apps/cli/src/dotenvSource.ts`

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T046 [P] Publish workflow gates — size comparison, functional smoke, native verifier — in `.github/workflows/publish-cli.yml`
- [X] T047 [P] Public examples suite as a hard release gate (Lane 4 in [quickstart.md](./quickstart.md))
- [X] T048 [P] E2E web fixtures relocated for the release smoke in `apps/cli/tests/fixtures/web/`
- [X] T049 Resolve the debugger SPA against constitution IV's bundle budget — closed by constitution 2.0.0 (2026-08-11), which removed the 500KB frontend-bundle clause as governing a deployed web app rather than a locally-served debugger
- [X] T050 Consolidate the duplicate transpile entry points: `src/transpiler/index.ts` injects `TRANSPILER_CACHE_KEY` around `transpileYamlTest`/`transpileYamlSuite` while `src/transpile.ts` and `src/commands/transpile.ts` do the same inline; only tests reach the former

---

## Dependencies

```text
Phase 1 (Setup) → Phase 2 (Foundational: env boundary, config, fixture, dispatch)
   ├── Phase 3  US1 run              [P1, MVP]
   ├── Phase 4  US2 scaffold         [P1, independent of US1]
   ├── Phase 5  US3 debug            [P1, depends on US1 transpilation]
   ├── Phase 6  US6 author offline   [P1, depends on US2 scaffold + spec rendering]
   ├── Phase 7  US4 existing project [P2, depends on US1]
   ├── Phase 8  US5 reports          [P2, depends on US1]
   └── Phase 9  tier selection       [spans US1 + US3]
          └── Phase 10 Polish
```

- **US2 is independent of US1** — scaffolding does not need the runner.
- **US6 depends on US2** — the authoring loop starts from a scaffold.
- **US3 depends on US1** — the debugger executes transpiled statements.

## Parallel Opportunities

- Phase 2: T007, T008 are independent.
- US1: T012, T013, T015, T016, T017 touch different files.
- US3: T024, T025, T026, T027 are independent.
- US5: T040, T041 are independent.
- **US2 + US4 + US5 can proceed in parallel with US1** once Phase 2 lands.

## Implementation Strategy

**MVP** = Phase 1 + Phase 2 + Phase 3 (US1): a developer can run mixed suites with one
command. US2 and US6 then make the product self-serve for agents; US3 adds the
debugger; US4/US5 broaden it.

**For this reconstruction** all six stories are delivered and every task is closed.
T049 closed with constitution 2.0.0; T028 turned out to be already implemented and
was closed after adding the missing round-trip coverage.

---

## Phase 11: Convergence

Appended by `/speckit-converge` on 2026-08-11, assessing the code against
[spec.md](./spec.md), [plan.md](./plan.md), this list, and constitution v2.0.0.
All 21 functional requirements and 9 success criteria were checked against
implementation and test. FR-001–FR-005, FR-007–FR-011, FR-013–FR-021 verify;
the gaps below are all in the **proof**, not the behavior, except T054. SC-007's gap
is recorded against T033, which this pass reopened.

- [X] T051 Assert the coverage *figure* in the default-mode transpile test, not just the `Low action coverage` prefix, per SC-006 (partial). `apps/cli/src/commands/transpile.test.ts:122` matches `/WARNING: Low action coverage/` while the `--strict` case at :135 pins `1/3 statements (33%)`. SC-006 requires the two modes be proven to **agree on the figure** and differ only in verdict and exit code; today a measurement drift in default mode alone passes green. The figure is emitted by `packages/types/src/test-flow/validateTestYaml.ts:275`, so both modes can assert the identical string.
- [X] T052 Add the parent/child token-parity test SC-009 claims, once T045 lands (partial). SC-009 asserts "the CLI parent resolves the same token as the spawned child (no cold-cache split)", but no test covers it — the only near match in `apps/cli/src/orgSettings.test.ts:216` is cold-start timeout retry. This is not merely unproven: T045 records that `apps/cli/src/cli.ts:5` still calls bare `dotenv.config()` (cwd only, shell wins) while `apps/cli/src/dotenvSource.ts` walks up with closest-wins, so the two views genuinely diverge. T045 fixes the behavior; this task pins it.
- [X] T053 Close the `install → run` leg of SC-004 (partial). SC-004 claims `create → install → run` is validated in the e2e lane; `test-run.e2e.test.ts` and `debug.e2e.test.ts` cover the real Playwright spawn and the live debug session, but no e2e installs a scaffolded project — no `npm install`/`npm ci` appears in any `*.e2e.test.ts`. The nearest real proof is the public-examples gate in `.github/workflows/publish-cli.yml`, which installs a tarball into a pre-existing repo rather than into a `shiplight create` scaffold. Either add the leg or narrow SC-004 to what the lane proves.
- [X] T055 `template:`/`call:` resolution with `<<param>>` substitution, required-param validation, depth limit and circular detection (FR-022) in `apps/cli/src/yaml-transpiler/templates.ts` — recorded here after the 001/003 `[X]` audit found 003 claiming it as FR-009 with no implementation
- [X] T054 Correct the stale v1 reference in `apps/cli/src/cache/actionEntityCacheClient.ts:18-23` (contradicts). The comment cites `apps/api/.../action-entity-cache` and says "the v1 core-api endpoint imposes no cap, so batching is a no-op there" — both `apps/api` and `core-api` were deleted in August 2026, so the parenthetical describes a path that cannot be taken and misleads a reader about why `MAX_PATHS_PER_REQUEST` exists.

---

## Phase 12: Report artifact size (FR-024, SC-010)

Triggered by a customer CI failure: `shiplight report --merge` died with
`RangeError: Invalid string length` on a 435-test run, before the cloud upload,
losing the whole run's results. Measured on 264 real artifacts from that
customer's org: 217.9 MB of step payload, 58% of it per-step variable snapshots.

- [X] T056 Stream `report-data.json` instead of `JSON.stringify(data, null, 2)`, so writing a report cannot fail on its own size (`apps/cli/src/reporter/reportFiles.ts`; used by both the reporter and `shiplight report --merge`). Rendering `index.html` no longer aborts the run either — losing the HTML must not take the cloud upload with it.
- [X] T057 Cap each recorded variable value at 1 KB, oversized values replaced by a marker naming the original size (`apps/cli/src/reporter/contextSnapshot.ts`). Applied where step results become report steps, not in sdk-core: the SDK's live `StepExecutionResult` values stay complete.
- [X] T058 Record each snapshot as changes from the previous step, with explicit removals, scoped per attempt (`apps/cli/src/reporter/contextDelta.ts`); carry both forms through the cloud upload payload, stamp each uploaded step entry with its recorded position (`seq`), and declare `schemaVersion: 3`.
- [X] T059 Write the wire contract both sides implement — fields, rules, read algorithm, cap markers, and the failure modes — as a standalone document plus machine-readable conformance vectors ([contracts/report-artifact.md](./contracts/report-artifact.md), [contracts/report-artifact-vectors.json](./contracts/report-artifact-vectors.json)). The writer runs the vectors as a test, so the two repos cannot drift silently.
- [ ] T060 Cloud reader: expand the delta form on its side so the run steps panel keeps showing the full store. It must order `resultJson` entries by `seq` before resolving — that reader builds its step list from `actionStepsMap` by phase as a tree, which is not recorded order. Implementable from [contracts/report-artifact.md](./contracts/report-artifact.md) alone — copy the vectors file and run it as a fixture; no monots source needed. Blocked on nothing in this repo, tracked here because the contract is only half-implemented until it lands.
