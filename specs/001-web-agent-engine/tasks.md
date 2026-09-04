# Tasks: AI Web-Agent Automation Engine

**Input**: Design documents from `/specs/001-web-agent-engine/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The spec asks for CI-gated proof (SC-001..SC-004), so test tasks are included.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Reconstruction convention — read before running `/speckit-implement`

This engine **already ships**. Tasks are reconstructed from the implementation, so a
task marked `[X]` records work that exists in the codebase today, with the file that
holds it. It is not a claim that the work was done through this task list.

- `[X]` — implemented and covered by the lane named in [quickstart.md](./quickstart.md).
- `[ ]` — genuinely open. Only these are work.

`/speckit-implement` MUST skip `[X]` items; treating them as undone would rebuild a
shipping engine. Run `/speckit-converge` to find gaps this list does not yet name.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1..US4 from [spec.md](./spec.md)

## Path Conventions

Library package at `packages/sdk-core/`, shared vocabulary at `packages/types/`.
Paths below are repo-relative.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 ESM-only TypeScript package with strict mode in `packages/sdk-core/tsconfig.json`
- [X] T002 Node >= 22 engine constraint and tsup build in `packages/sdk-core/package.json`
- [X] T003 [P] Lint rule keeping the engine standalone (no internal-scope imports) in `packages/sdk-core/eslint.config.js`
- [X] T004 [P] Two test lanes — deterministic `test:unit` and keyed `test:browser` — in `packages/sdk-core/package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Seams every user story depends on. Breaking one breaks all four.

- [X] T005 Injected-configuration seam so the engine reads no ambient env (FR-010, contract C1) in `packages/sdk-core/src/config.ts`
- [X] T006 Shared vocabulary — `TestFlow`, `Statement`, `ActionEntity` — in `packages/types/src/test-flow/`
- [X] T007 [P] Agent context: model, variable store with sensitive flags, history, token usage in `packages/sdk-core/src/utils/agentContextUtils.ts`
- [X] T008 [P] Variable substitution for `{{var}}`, `${var}`, `$var`, `<secret>var</secret>` (FR-008) in `packages/types/src/utils/replaceVariables.ts`
- [X] T009 [P] Browser/page management and CDP discovery in `packages/sdk-core/src/browser/`
- [X] T010 DOM and accessibility-tree extraction feeding action resolution in `packages/sdk-core/src/dom/`
- [X] T011 Fix multi-pass `replaceVariables` re-substitution: a substituted value containing `$ident` is substituted again (`P$word` + `word=ZZZ` → `PZZZ`) in `packages/types/src/utils/replaceVariables.ts`

**Checkpoint**: T011 is a known defect carried deliberately (see [data-model.md](./data-model.md)); everything else here is in place.

---

## Phase 3: User Story 1 — Resolve a natural-language step into a browser action (P1)

**Goal**: One instruction plus a live page yields exactly one concrete action, or an explicit error.

**Independent test**: Drive `generateAction` with a known page and instruction; confirm action type and target match intent. Deterministic via mocked LLM.

- [X] T012 [US1] DOM-based action generation from extracted elements (FR-001, contract C2) in `packages/sdk-core/src/agent/action-generation/elementBased.ts`
- [X] T013 [P] [US1] Action-resolution prompts in `packages/sdk-core/src/agent/action-generation/actionPrompts.ts`
- [X] T014 [P] [US1] One module per browser action in `packages/sdk-core/src/actions/impl/`
- [X] T015 [US1] `verify` actions carry the original statement as the assertion (FR-005) in `packages/sdk-core/src/actions/impl/ai_assert.ts`
- [X] T016 [US1] Error paths for no-action / done / cannot-complete-in-one-step (US1 AC3) in `packages/sdk-core/src/agent/action-generation/elementBased.ts`
- [X] T017 [US1] Reject negative or invalid element index rather than acting (Edge Cases) in `packages/sdk-core/src/agent/action-generation/elementBased.ts`
- [X] T018 [P] [US1] Strict tool schemas at the LLM submission boundary in `packages/sdk-core/src/llm_tools/strictSchema.ts`
- [X] T019 [US1] Deterministic decision-mapping tests with the LLM mocked (SC-001) in `packages/sdk-core/src/agent/action-generation/__tests__/elementBased.generateAction.test.ts`
- [X] T020 [P] [US1] Strict-schema regression tests in `packages/sdk-core/src/agent/action-generation/__tests__/elementBased.strictSchema.test.ts`

**Checkpoint**: US1 is the engine's reason to exist; every other story builds on it.

---

## Phase 4: User Story 2 — Generate self-healing locators (P1)

**Goal**: Element actions record a durable semantic locator plus an XPath, so replay needs no model.

**Independent test**: Resolve an element-targeted action; confirm the entity carries both a semantic locator and an XPath, and that replay makes zero model calls.

- [X] T021 [US2] Semantic locator computation preferring `getByRole`/`getByTestId` (FR-002) in `packages/sdk-core/src/dom/utils/locator.ts`
- [X] T022 [US2] Attach locator, XPath and frame path to the action entity (US2 AC1) in `packages/types/src/test-flow/actionEntity.ts`
- [X] T023 [US2] Replay a captured entity via locator/XPath with no model call (US2 AC2, SC-003, contract C3) in `packages/sdk-core/src/actions/handler.ts`
- [X] T024 [P] [US2] Action-entity fingerprinting and cache-reuse rules in `packages/types/src/test-flow/actionEntityFingerprint.ts`
- [X] T025 [P] [US2] Locator computation tests for `packages/sdk-core/src/dom/utils/locator.ts` (FR-002, SC-003). No test file exists in that directory and no test imports the module, so `pickBestLocator`, `pickBestLocatorForElement`, `pickBestLocators`, `isLocatorGeneratorAvailable` and `getFallbackLocator` have zero coverage. `getFallbackLocator(xpath)` is pure and directly testable; the rest need a `Page` and belong in the browser lane

**Checkpoint**: This is the durability promise that makes authored suites fast.

---

## Phase 5: User Story 3 — Auto-select the model from the available provider key (P1)

**Goal**: One credential in, correct model and endpoint out, with no further configuration.

**Independent test**: Set each credential in isolation; confirm provider/model resolution and endpoint routing, including the tier path.

- [X] T026 [US3] Parse and normalise `provider:model`, preserving unknown prefixes (FR-003) in `packages/sdk-core/src/agent/llm/parseModel.ts`
- [X] T027 [US3] Route by credential shape: provider key → provider, `shp_*` → the Shiplight proxy, any other shape → no endpoint, honouring `SHIPLIGHT_API_URL` (FR-004, contract C4) in `packages/sdk-core/src/agent/llm/proxy.ts`
- [X] T028 [P] [US3] Provider clients for Anthropic, Google and OpenAI in `packages/sdk-core/src/agent/llm/`
- [X] T029 [US3] Tier vocabulary, baked map and resolution precedence (FR-003) in `packages/types/src/llmTiers.ts`
- [X] T030 [US3] Ignore `WEB_AGENT_MODEL`/`WEB_AGENT_FALLBACK_MODELS`/`COMPUTER_USE_MODEL` on the tier path (`TIER_IGNORED_ENV_VARS`, US3 AC4) in `packages/types/src/llmTiers.ts`
- [X] T031 [P] [US3] Model-fallback chain when the primary is unavailable in `packages/sdk-core/src/agent/task/modelFallback.ts`
- [X] T032 [US3] Routing and tier-resolution tests for each credential type (SC-002) in `packages/types/src/__tests__/resolveCuaModel.test.ts`
- [X] T033 [P] [US3] Tier-path env-var precedence tests in `packages/types/src/__tests__/resolveModelFromEnv.test.ts`

**Checkpoint**: Mis-routing breaks every run or sends a key to the wrong endpoint, so this story is proof-heavy by design.

---

## Phase 6: User Story 4 — Degrade gracefully and stay bounded (P2)

**Goal**: Fall back to vision when the DOM is insufficient; never loop unbounded.

**Independent test**: Force DOM extraction to be insufficient and confirm the vision path yields a valid action; assert budgets reject invalid values and cap retries.

- [X] T034 [US4] Coordinates/vision action generation as the DOM fallback (FR-009) in `packages/sdk-core/src/agent/action-generation/coordinatesBased/index.ts`
- [X] T035 [P] [US4] Provider-specific vision paths (Gemini, OpenAI) in `packages/sdk-core/src/agent/action-generation/coordinatesBased/`
- [X] T036 [US4] Step budget and multi-step task loop; reject non-positive `maxSteps` (FR-006, US4 AC1/AC2, contract C5) in `packages/sdk-core/src/agent/task/executor.ts`
- [X] T037 [P] [US4] Self-heal and modal-dismissal budgets in `packages/sdk-core/src/agent/`
- [X] T038 [US4] Per-statement → organization → default timeout precedence (FR-007) in `packages/sdk-core/src/actions/utils.ts`
- [X] T039 [P] [US4] Budget-enforcement tests (SC-004) in `packages/sdk-core/src/agent/task/`

**Checkpoint**: Reliability margin on hard pages and protection against runaway spend.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T040 [P] Per-run token accounting folded into the run usage summary in `packages/sdk-core/src/agent/runUsageSummary.ts`
- [X] T041 [P] AI-mode condition construct tags (`"if"`/`"while"`) so usage attribution can split them, proven in `apps/cli/src/yaml-transpiler/aiConditionAttribution.test.ts`
- [X] T042 [P] Live browser lane exercising the full NL→action loop in `packages/sdk-core/tests/specs/`
- [X] T043 Make the live browser lane runnable from a documented credential: `packages/sdk-core/tests/.env` defines `GOOGLE_GENERATIVE_AI_API_KEY`, but the specs read `GOOGLE_API_KEY`/`ANTHROPIC_API_KEY`, so `pnpm --filter sdk-core test` fails with "No LLM model configured" even with a key present
- [X] T044 Decide whether SC-001's CI claim should cover the live loop, or record the keyed lane as accepted residual risk in [spec.md](./spec.md) Assumptions

---

## Dependencies

```text
Phase 1 (Setup)
   └── Phase 2 (Foundational: config seam, vocabulary, DOM extraction)
          ├── Phase 3 US1 — action resolution        [P1, MVP]
          │      └── Phase 4 US2 — locators/replay   [P1, depends on US1 producing actions]
          ├── Phase 5 US3 — model selection/routing  [P1, independent of US1/US2]
          └── Phase 6 US4 — vision fallback + budgets[P2, depends on US1]
                 └── Phase 7 Polish
```

- **US3 is independent** of US1/US2 and can be verified alone.
- **US2 depends on US1** — there is no entity to make durable until an action resolves.
- **US4 depends on US1** — the fallback and the budgets wrap the resolution loop.

## Parallel Opportunities

- Phase 2: T007, T008, T009 touch different files.
- US1: T013, T014, T018, T020 are independent of each other.
- US3: T028, T031, T033 are independent.
- US4: T035, T037, T039 are independent.
- **US3 can proceed in parallel with US1/US2 entirely** — different subsystem.

## Implementation Strategy

**MVP** = Phase 1 + Phase 2 + Phase 3 (US1). That alone gives a usable engine:
natural language resolves to a browser action. US2 makes it durable, US3 makes it
zero-config, US4 makes it survive hard pages.

**For this reconstruction** the MVP and all four stories are already delivered. The
open work is four items: T011 (variable re-substitution defect), T043 (the live lane's
env-var mismatch), and T044 (a product decision about SC-001's scope). Run
`/speckit-converge` to surface anything this list does not yet name.

---

## Phase 8: Convergence

Appended by `/speckit-converge` on 2026-08-11, assessing the code against
[spec.md](./spec.md), [plan.md](./plan.md), this list, and constitution v2.0.0.

- [X] T045 CRITICAL Remove `axios`, `p-retry` and `yaml` from `packages/sdk-core/package.json`, or add the import that justifies each — all three are declared with zero import sites in `src/` and `tests/` per Constitution V (contradicts). **Resolved**: `axios` and `p-retry` removed. `yaml` also removed from the manifest but added to `tsup.config.ts` `npmExternals` — it is imported by `shiplight-types`, which sdk-core inlines via `noExternal`, so esbuild must leave it alone; bundling it breaks at load because `yaml` is CJS and calls `require("process")`.
- [X] T046 CRITICAL Add a guard that fails when `process.env` is reintroduced into `packages/sdk-core/src/`, per Constitution II "Guards, not cleanups" — the absence of one is how the reads in T047 accumulated (missing)
- [X] T047 Route the three ambient reads through the injected `SdkConfig.env` seam — `src/config.ts:148` (`SDK_LOG_LEVEL`), `src/agent/agentServices.ts:469` (`USE_DOM_TREE_TS`), `src/browser/registryClient.ts:25` (`OMNITERM_BROWSER_REGISTRY_URL`) — or narrow FR-010 to provider configuration and correct the comment at `src/agent/llm/anthropic.ts:22` which asserts the engine never reads `process.env` per FR-010 (partial)
- [X] T048 Decide whether the UUID → v1 cloud route in `src/agent/llm/proxy.ts` still has a live endpoint per FR-004 (contradicts). **Resolved**: route removed. `resolveApiBase` returns `null` for a legacy token so each caller applies its own policy — LLM calls fail with an actionable message, the action cache no-ops, tier selection degrades to baked defaults, report upload is skipped. FR-004, US3/AC2 and SC-002 were reconciled in `spec.md` in the same change.

---

## Phase 9: Convergence (second pass)

Appended 2026-08-11 while auditing the `[X]` marks of this reconstruction against
code. T025 was reopened in Phase 4 — it claimed locator tests that do not exist.

- [X] T049 Bring the orphaned browser specs under a CI lane, or state that they are manual. `packages/sdk-core/tests/specs/` holds eight specs, but `test:browser` (package.json:49) runs only `engine-fixture.spec.ts`, and that is the script `.github/workflows/browser-tests.yml:101` gates on. The other seven — `agent-execute-verify`, `copy-paste`, `generateAction`, `interactive-class-names`, `logger`, `pure-vision`, `registry` — run only under bare `pnpm test` (package.json:47, `testDir: './specs'`), which no workflow invokes. T042 reads as if the whole directory is exercised.
