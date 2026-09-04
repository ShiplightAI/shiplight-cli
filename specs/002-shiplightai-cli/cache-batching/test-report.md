# Test Report: Action-entity cache request batching + pre-test download scoping

**Test spec**: [test-spec.md](./test-spec.md)
**Branch / commit**: `feng/workspace` @ `4fdf40cfe` (change is in the working tree, uncommitted)
**Last updated**: 2026-07-13
**Tester**: Claude (`/shiplight cover`)

Session record for the focused change reviewed earlier this session. All behaviors
are pure CLI logic; the whole contract is proven at the **unit** modality.

## Summary

- Overall session status: `PASS`
- What this session added or strengthened:
  - Closed the one MEDIUM gap from code review: **independent batch degradation** was
    an asserted code comment with zero coverage — now proven for both lookup and update
    (fail batch 1, succeed batch 2, assert only survivors retained).
  - Added the **101-path boundary** (`[100, 1]` split) — the first count that crosses
    into a second batch, guarding the `chunk` loop against an off-by-one.
  - Added the **update ≤100 single-request** boundary (distinct `new Map(batch)` path).
  - Added the **multi-file scoping** case (`['a','c']` → exactly those, `b` excluded).
- Blocking findings: none.
- Known gaps left for follow-up: sequential-batch timeout latency (accepted design
  trade-off, not tested); cross-process scope-parity asserted indirectly. See
  **Deferred / Residual Risk**.

## Source Material

- Source material used: implementation in `apps/cli/src/cache/actionEntityCacheClient.ts`,
  `apps/cli/src/commands/test.ts`, `apps/cli/src/transpile.ts`; server cap confirmed in
  the cloud service's `action-entity-cache/{lookup,update}.ts`
  (`.max(100)` / `stores <= 100`).
- Source material not found or not available: no upstream PRD or feature-breakdown
  ranks these behaviors — priorities in the spec are **inferred** and flagged for the
  feature owner.

## Commands Run

| Command | Result | Notes |
| --- | --- | --- |
| `node --test --experimental-test-module-mocks --import tsx src/cache/actionEntityCacheClient.test.ts src/commands/test.test.ts src/transpile.test.ts` (from `apps/cli`) | `PASS` | 82 tests, 81 pass, 1 pre-existing skip, 0 fail |
| `pnpm --filter shiplightai exec tsc --noEmit -p tsconfig.json` | `PASS` | exit 0 — clears the CI `build` gate (strict null checks over test files) |

## Tests Added Or Updated

| Type | Files | Tests |
| --- | ---: | ---: |
| Unit | 2 | 5 |
| Contract | 0 | 0 |
| Integration | 0 | 0 |
| E2E | 0 | 0 |
| Agent | 0 | 0 |
| Script / static | 0 | 0 |
| **Total** | **2** | **5** |

### File List

- `apps/cli/src/cache/actionEntityCacheClient.test.ts` (+4: lookup 101-boundary,
  lookup independent-degradation, update single-request-at-cap, update
  independent-degradation)
- `apps/cli/src/commands/test.test.ts` (+1: multi-file scoping)

Pre-existing tests shipped with the change under test (not re-counted above):
lookup split+union, lookup single-request-at-cap, update split+summed, preTestDownload
single-file scope, preTestDownload null fallback, `getRequestedYamlFiles` argv override.

## Coverage Matrix

| Behavior (from test-spec) | Priority | Test type | Coverage | Session result | Notes / gap |
| --- | --- | --- | --- | --- | --- |
| Lookup: split >100 + union merge | P1 (inferred) | unit | COVERED | PASS | shipped w/ change |
| Lookup: independent degradation | P1 (inferred) | unit | COVERED | PASS | added this session |
| Lookup: single request at/below cap | P2 (inferred) | unit | COVERED | PASS | shipped w/ change |
| Lookup: 101 boundary `[100,1]` | P2 (inferred) | unit | COVERED | PASS | added this session |
| Update: split >100 + summed counts | P1 (inferred) | unit | COVERED | PASS | shipped w/ change |
| Update: independent degradation | P1 (inferred) | unit | COVERED | PASS | added this session |
| Update: single request at/below cap | P2 (inferred) | unit | COVERED | PASS | added this session |
| Scoping: `test <file>` → only that file | P1 (inferred) | unit | COVERED | PASS | shipped w/ change |
| Scoping: several files → exactly those | P2 (inferred) | unit | COVERED | PASS | added this session |
| Scoping: `null` → whole-repo fallback | P1 (inferred) | unit | COVERED | PASS | shipped w/ change |
| `getRequestedYamlFiles` argv override | P2 (inferred) | unit | COVERED | PASS | shipped w/ change |
| Scope-parity invariant (preTestDownload == transpiler) | P1 (inferred) | unit (indirect) / static | IMPLICIT | PASS | same fn + same inputs both sides; no cross-process assertion |
| Sequential-batch timeout latency | P3 (inferred) | — | NOT COVERED | NOT RUN | accepted trade-off; documented |

## Findings

None. Code review earlier this session found one MEDIUM (untested partial-batch
degradation) and cleared LOW items; all blocking items are resolved and the
degradation behavior is now proven.

## Deferred / Residual Risk

- [ ] **Scope-parity across the process boundary**: `preTestDownload` (parent process)
  and `transpileAllYamlTests` (spawned Playwright process) both derive scope from
  `getRequestedYamlFiles`, but no single test asserts they resolve to the *same* file
  list end-to-end. Argued by construction (identical function, identical `projectRoot`
  + `rewrittenArgs`), not directly asserted. Retest: an integration test that spawns
  the CLI against a fixture repo and diffs downloaded cache files vs. transpiled specs.
  Pass criterion: cache written == specs transpiled, for a single-file run.
- [ ] **Sequential-batch timeout latency**: on a stalled network, per-batch timeouts
  stack (up to 5×2s lookup / 5×5s update on a ~500-file repo). Accepted on a
  once-per-invocation warm/flush path. Retest (if it becomes a problem): mock timers,
  assert total wall time; or add bounded-concurrency (`p-limit`). Pass criterion: total
  ≈ max(batch), not sum(batch).

## Cleanup

- Cleanup performed: temp dirs created by `preTestDownload` tests are removed in
  `afterEach` (`fs.rmSync`, `{ recursive, force }`).
- Resources intentionally left behind: none.
- Follow-up cleanup required: none. `.shiplight-agent-skills-last-update` timestamp
  cache is git-ignored (not committed).

## Coverage Summary

- Total testing whats: 13
- COVERED: 11
- PARTIAL: 0
- IMPLICIT: 1 (scope-parity invariant)
- NOT COVERED: 1 (sequential-batch latency — accepted)
- NOT MEASURED: 0
- MANUAL: 0
- BLOCKED: 0
- DEFERRED: 0

Modality note: **e2e / agent / manual were not selected** — the change has no browser
or live-environment surface, so those modalities are not in the feasible set. Unit is
both cheapest and sufficient, and the "maximize unit coverage on changed logic" floor
is met. No Shiplight producer (`create-yaml-tests` / `create-agent-verification`) was
driven, by design.
