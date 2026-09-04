# Tasks: @shiplightai/mcp UI-Automation Server

**Input**: Design documents from `/specs/003-shiplightai-mcp-server/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included — SC-006 and SC-007 are guards, which are test tasks by nature.

**Organization**: Grouped by user story (US1..US5 from spec.md).

## Reconstruction convention — read before running `/speckit-implement`

`@shiplightai/mcp` **is published**. `[X]` records work that exists today; `[ ]` is
genuinely open. `/speckit-implement` MUST skip `[X]` items. Run `/speckit-converge`
to surface gaps this list does not name.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 ESM build bundling `mcp-tools`/`sdk-core` via tsup `noExternal` in `apps/mcp-server/tsup.config.ts`
- [X] T002 [P] Copy the Chrome relay extension into the tarball at build time (contract C7) in `apps/mcp-server/package.json`
- [X] T003 [P] Three lanes — unit, browser behaviour, stdio smoke — across `apps/mcp-server` and `packages/mcp-tools`

---

## Phase 2: Foundational (Blocking Prerequisites)

- [X] T004 stdio JSON-RPC shell keeping stdout protocol-only, EPIPE handled (FR-008, contract C1) in `apps/mcp-server/src/server.ts`
- [X] T005 Lazy browser imports so non-browser paths skip the Playwright graph (FR-013, research D4) in `apps/mcp-server/src/server.ts`
- [X] T006 [P] Tool registry with complete registration and unknown-tool errors (FR-010) in `packages/mcp-tools/src/tools/`
- [X] T007 `SessionManager` owning lifecycle, isolation and disposal (FR-006) in `packages/mcp-tools/src/backends/SessionManager.ts`
- [X] T008 [P] Structured logging to stderr only in `apps/mcp-server/src/logger.ts`

---

## Phase 3: User Story 1 — A coding agent verifies its own UI changes (P1)

- [X] T009 [US1] `new_session` / `navigate` / `close_session` over a real Playwright page (FR-001) in `packages/mcp-tools/src/tools/`
- [X] T010 [P] [US1] `inspect_page` returning a DOM tree with element indices plus screenshot in `packages/mcp-tools/src/tools/`
- [X] T011 [P] [US1] `get_page_info` in `packages/mcp-tools/src/tools/`
- [X] T012 [US1] `act` dispatching through the engine's action registry, executing only advertised actions in `packages/mcp-tools/src/tools/`
- [X] T013 [P] [US1] `get_browser_console_logs` / `get_browser_network_logs` in `packages/mcp-tools/src/tools/`
- [X] T014 [P] [US1] Real-browser lane covering navigate/inspect/act (SC-001) in `packages/mcp-tools/browser-tests/`
- [X] T015 [P] [US1] `generate_html_report` over a closed session's recording (FR-012) in `packages/mcp-tools/src/tools/`

---

## Phase 4: User Story 2 — Sessions are isolated and cleaned up (P1)

- [X] T016 [US2] Distinct ids/pages per session, independently closable (FR-006) in `packages/mcp-tools/src/backends/SessionManager.ts`
- [X] T017 [US2] Clear failure for operations on a closed session in `packages/mcp-tools/src/backends/SessionManager.ts`
- [X] T018 [P] [US2] Two-session isolation and teardown tests (SC-002) in `packages/mcp-tools/browser-tests/`
- [X] T019 [P] [US2] Session disposal on close, no unbounded growth in the long-lived process in `packages/mcp-tools/src/backends/SessionManager.ts`

---

## Phase 5: User Story 3 — Sessions yield replay-ready action entities (P1)

- [X] T020 [US3] `get_locators` returning `locator`, `xpath`, `frame_path` (FR-002, contract C3) in `packages/mcp-tools/src/tools/`
- [X] T021 [US3] Action-entity resource generated from the live registry (FR-014) in `packages/mcp-tools/src/resources/index.ts`
- [X] T022 [US3] Resource scoped to what this server produces, pointing at `npx shiplight spec yaml` (FR-015) in `packages/mcp-tools/src/resources/`
- [X] T023 [US3] Single authored `ActionEntity` definition, derived not transcribed (FR-016) in `packages/types/src/test-flow/actionEntity.ts`
- [X] T024 [P] [US3] Guard that the resource renders every registry action and no others (SC-007) in `packages/mcp-tools/src/`. What exists guards the **act tool**, not the resource: `backends/__tests__/actSupportedActionsRegistered.test.ts` proves `ACT_SUPPORTED_ACTIONS` all resolve in the registry and match the act union schema. Neither direction catches a registry action absent from the resource, so registry drift does **not** surface as a failing test, which is exactly what SC-007 promises
- [X] T025 [P] [US3] Real-page entity quality test (SC-003) in `packages/mcp-tools/browser-tests/`

---

## Phase 6: User Story 5 — Attach to existing Chrome tabs (P2)

- [X] T029 [US5] `attach_to_browser` over CDP via the relay extension (FR-003) in `packages/mcp-tools/src/tools/`
- [X] T030 [P] [US5] `ExtensionRelayServer` and CDP target management in `packages/mcp-tools/src/backends/`
- [X] T031 [P] [US5] Relay election coordinator for concurrent servers in `packages/mcp-tools/src/backends/`
- [X] T032 [P] [US5] Relay CDP target-management tests (SC-005) in `packages/mcp-tools/src/`

---

## Phase 7: Boundary Enforcement (cross-cutting)

- [X] T033 Remove authoring tools — scaffolding, YAML validation, transpilation — from the registered surface (FR-012) in `packages/mcp-tools/src/tools/`
- [X] T034 Guard asserting the registered surface stays session-bound; must fail on reintroduction (SC-006) in `packages/mcp-tools/src/`
- [X] T036 [P] Registration-completeness and unknown-tool tests (SC-005) in `packages/mcp-tools/src/`
- [X] T037 [P] stdio integrity smoke over the wire (SC-005) in `apps/mcp-server/smoke/stdioSmoke.test.ts`

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T038 [P] Prompts exposed as resources too, since prompts are user-invoked and unreadable by the agent, in `packages/mcp-tools/src/prompts/index.ts`
- [X] T040 Resolve FR-011: either add a test proving semantic locator generation depends on `PWDEBUG=console`, or correct the README that asserts it. Currently a `[NEEDS CLARIFICATION]` in the spec with no test pinning either answer (research D6)
- [X] T041 Add a packaging guard asserting the tarball contains `chrome-extension/manifest.json`, `background.js` and `icons/`; its absence shipped silently in `0.1.62` and only manual inspection caught it (contract C7)

---

## Dependencies

```text
Phase 1 (Setup) → Phase 2 (Foundational: stdio shell, lazy imports, registry, SessionManager)
   ├── Phase 3 US1 verify UI          [P1, MVP]
   │      ├── Phase 4 US2 isolation   [P1, depends on sessions existing]
   │      └── Phase 5 US3 entities    [P1, depends on US1 acting on a page]
   └── Phase 6 US5 Chrome attach      [P2, depends on US1]
          └── Phase 7 Boundary → Phase 8 Polish
```

- **US2 and US3 both depend on US1**; they harden and extend the session it opens.

## Parallel Opportunities

- Phase 2: T006, T008 are independent.
- US1: T010, T011, T013, T014, T015 touch different files.
- US3: T024, T025 are independent.
- US5: T030, T031, T032 are independent.

## Implementation Strategy

**MVP** = Phase 1 + Phase 2 + Phase 3 (US1): an agent can open a page, look at it, act
on it, and read logs. US3 makes the output replay-ready, US2 makes it safe to run
long, US5 adds attach.

**For this reconstruction** every story is delivered and every task is closed.
