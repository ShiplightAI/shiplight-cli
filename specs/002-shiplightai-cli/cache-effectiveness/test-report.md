# Test Report: Action-entity cache effectiveness metric + per-test LLM totals

**Test spec**: [test-spec.md](./test-spec.md)
**Branch / commit**: `feng/workspace`, working tree on top of `ffc1b07ed` (uncommitted)
**Last updated**: 2026-07-25
**Tester**: Claude (agent session)

This report is the development session record: what was tested, by what test **type**,
what ran, and what failed or was blocked. It records facts, not a graded confidence
verdict.

## Summary

- Overall session status: `PASS`
- What this session added or strengthened: 48 tests across 9 files covering the new
  cache-effectiveness metric and per-test LLM totals. The change entered this session
  with 3 test files and no coverage of its own wiring; a prior multi-agent review found
  15 verified defects, 14 were fixed, and this session added regression coverage for each
  fix plus the two gaps the fixes themselves left (the staged-store loader and the shard
  merge wiring).
- Blocking findings: none.
- Known gaps left for follow-up: the `failed` bucket is structurally unpopulated
  (F-002); the CI download→stage→transpile→replay path is proven seam-by-seam but not
  end-to-end (D-001). **Release note, not a gap:** fixing the staged-store read changes
  CI runtime behavior — cached entities now actually apply (F-001).

## Source Material

- Source material used: [feature spec](../spec.md) (FR-011, FR-012), sibling contracts
  [run-usage-summary](../run-usage-summary/test-spec.md) and
  [cache-batching](../cache-batching/test-spec.md), repo-root
  [TESTING.md](../../../TESTING.md), the working-tree diff across `apps/cli`,
  `packages/shiplight-tools`, and `packages/types`, and the prior review's verified
  findings.
- Source material not found or not available: no upstream PRD ranks these behaviors —
  every priority in the spec and in the matrix below is **inferred** and flagged for the
  feature owner. Platform-side ingest of `cacheSummary` / `llmCalls` / `llmTokens` lives
  in a sibling repo and was not read.

## Commands Run

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm --filter shiplight-types build` | `PASS` | Prerequisite — `RunCacheSummary.healed_from_cache` added |
| `pnpm --filter shiplight-tools build` | `PASS` | Prerequisite for the CLI build |
| `pnpm --filter shiplightai build` | `PASS` | Prerequisite for CACHE-EFF-T06 (`report --merge` spawns `dist/cli.js`) |
| `pnpm turbo run typecheck --filter=shiplightai --filter=shiplight-tools --filter=shiplight-types` | `PASS` | 10/10 tasks. Catches strict-null errors in test files that the `tsx` lanes do not |
| `cd apps/cli && pnpm test` | `PASS` | 745 tests, 744 pass, 0 fail, 1 skipped (pre-existing) |
| `cd apps/cli && npx playwright test` (browser lane, via `pnpm test`) | `PASS` | 209 passed |
| `cd packages/shiplight-tools && pnpm test` | `PASS` | 66 tests, 66 pass, 0 fail |
| `node --test … src/cache/runCacheMetadata.test.ts src/transpile.test.ts` | `PASS` | 34/34 — CACHE-EFF-T01, T02 |
| `node --test … src/reporter/healedEntitiesAttachment.test.ts` | `PASS` | 4/4 — CACHE-EFF-T03 |
| `node --test … src/yaml-transpiler/actionEntitySourceObserver.test.ts` | `PASS` | 7/7 — CACHE-EFF-T04 |
| `node --test … src/cache/actionEntityCacheStore.test.ts` | `PASS` | 23/23 — CACHE-EFF-T05 |
| `node --test … src/cache/cacheMetadataCollector.test.ts src/commands/report.test.ts` | `PASS` | 47/47 — CACHE-EFF-T06 |
| `node --test … src/reporter/cloudUpload.test.ts src/reporter/runUsageAggregate.test.ts` | `PASS` | 65/65 — CACHE-EFF-T07 |
| `grep -c '__shiplightRunCacheMetadata__' dist/{index.js,reporter.js,cjs/index.cjs,cjs/reporter.cjs}` | `PASS` | 1 occurrence in each of the four bundles — supplementary evidence for CACHE-EFF-T01 |

## Tests Added Or Updated

| Type | Files | Tests |
| --- | ---: | ---: |
| Unit | 8 | 46 |
| Contract | 0 | 0 |
| Integration | 1 | 2 |
| E2E | 0 | 0 |
| Agent | 0 | 0 |
| Script / static | 0 | 0 |
| **Total** | **9** | **48** |

### File List

- `apps/cli/src/cache/runCacheMetadata.test.ts` (10 tests, new) — collector gating,
  cross-bundle sharing, reset
- `apps/cli/src/reporter/healedEntitiesAttachment.test.ts` (4 tests, new) — attachment
  shape, built from the real `createEmptyStore`/`createRunnerStoreEntry`
- `packages/shiplight-tools/src/yaml-transpiler/actionEntitySourceObserver.test.ts`
  (7 tests, new) — source labelling, hook UIDs, noAgent exclusion
- `apps/cli/src/cache/cacheMetadataCollector.test.ts` (+6) — `mergeCacheSummaries`
- `apps/cli/src/cache/actionEntityCacheStore.test.ts` (+3) — `loadStagedActionEntityStores`
- `apps/cli/src/commands/report.test.ts` (+2, **integration** — spawns the built CLI) —
  `cacheSummary` survives `report --merge`
- `apps/cli/src/reporter/cloudUpload.test.ts` (+8) — per-test sums, NULL-vs-0 gate
- `apps/cli/src/reporter/runUsageAggregate.test.ts` (+2) — output-directory scoping
- `apps/cli/src/transpile.test.ts` (+6) — measurement completeness, buffering, reset

## Coverage Matrix

| Behavior (from test-spec) | Priority | Test type | Coverage | Session result | Notes / gap |
| --- | --- | --- | --- | --- | --- |
| Run with a cache reports what the cache served | P1 (inferred) | unit | COVERED | `PASS` | Composed from T01–T04, T06 |
| Run with no cache reports nothing about one | P2 (inferred) | unit | COVERED | `PASS` | `cacheInPlay` gate — T02 |
| Per-test LLM cost outlives the report artifact | P1 (inferred) | unit | PARTIAL | `PASS` | Sums + gate asserted at the helper (T07); the assembled PUT payload is not asserted on a live upload |
| CI applies the cached entities it downloaded | P1 (inferred) | unit | PARTIAL | `PASS` | Loader proven under the exact cloud-selecting env (T05); full round-trip is D-001 |
| Collector shared across tsup entry bundles | P1 (inferred) | unit | COVERED | `PASS` | Second module instance + four-bundle grep — T01 |
| Healed-entity attachment read at its real nesting | P1 (inferred) | unit | COVERED | `PASS` | T03 |
| Deterministic UIDs for hook statements | P1 (inferred) | unit | COVERED | `PASS` | Stability across transpiles + a hook store hitting — T04 |
| Transpiler reads the staged dir, not the backend | P1 (inferred) | unit | COVERED | `PASS` | T05 asserts the backend cannot enumerate while the loader can |
| Measurement is all-or-nothing per run | P1 (inferred) | unit | COVERED | `PASS` | T02 — cache-in-play, incomplete, and empty gates |
| Observation committed only after a valid write | P1 (inferred) | unit | COVERED | `PASS` | T02 — failing file records nothing |
| Only executable statements counted | P2 (inferred) | unit | PARTIAL | `PASS` | noAgent AI exclusion covered (T04); IF/WHILE branch counting is a documented transpile-time semantic, not covered — D-003 |
| Run state resets per transpile pass | P2 (inferred) | unit | PARTIAL | `PASS` | Two-pass non-additivity covered (T02); real Playwright watch mode is D-002 |
| Shard merge unions, does not sum | P1 (inferred) | unit + integration | COVERED | `PASS` | Arithmetic (T06 unit) and wiring (T06 subprocess) proven separately |
| Per-test totals gated on report evidence, not a glob | P1 (inferred) | unit | COVERED | `PASS` | T07 — gate true from steps alone |
| Per-run total scoped to this run's output dirs | P1 (inferred) | unit | COVERED | `PASS` | T07 — scoped vs unscoped compared on the same tree |
| No fabricated zeros on any not-measured path | P1 (inferred) | unit | COVERED | `PASS` | Cache gates (T02), LLM gate (T07), merge-with-no-summary (T06) |
| No inflated hit rate — healing leaves `cache_hits` | P1 (inferred) | unit | PARTIAL | `PASS` | Heals now counted, incl. from failing tests (T03, T02); the unhealable-stale case is F-002 |
| No secret leakage | P1 (inferred) | static / review | COVERED | `PASS` | Summaries copy counts and id strings only; no field path reaches prompt/response content |
| `healed_from_cache` is additive / back-compat | P2 (inferred) | unit | COVERED | `PASS` | T06 merges summaries lacking the field |
| CI cache application is a behavior change | P1 (inferred) | — | NOT MEASURED | `NOT RUN` | F-001 — a release-note obligation, not a testable assertion |
| mtime skip defeated when measuring | P2 (inferred) | unit | COVERED | `PASS` | T02 asserts both directions (skip kept without a cache, defeated with one) |
| `failed` bucket reflects unhealable stale entries | P1 (inferred) | — | NOT COVERED | `NOT RUN` | F-002 — knowingly accepted; no runtime UID channel exists |
| Platform/analytics owners can trust the reported rate | P1 (inferred) | unit | IMPLICIT | `PASS` | Derived from the gating and merge rows above |
| Release owners can trust the CI cache path | P1 (inferred) | unit | IMPLICIT | `PASS` | Derived from T05; end-to-end is D-001 |
| CLI users get per-test cost that survives retention | P1 (inferred) | unit | IMPLICIT | `PASS` | Derived from T07 |

### FR mapping (supplementary)

| Requirement | Relation to this change | Coverage | Result |
| --- | --- | --- | --- |
| FR-011 (action-entity caching) | The staged-store fix restores cache application in CI; the metric observes it | PARTIAL | `PASS` |
| FR-012 (run LLM usage summary) | Extended with per-test columns; run-level aggregation re-scoped to this run | COVERED | `PASS` |

## Agent Test Evidence

None — this change has no browser or live-environment surface, so no agent verification
was authored or required.

## Manual Verification Log

### 2026-07-25

- Environment: local macOS, no product environment involved.
- Scenarios checked: read the four built tsup bundles to confirm the `globalThis` stash
  key is inlined once per bundle (the invariant no in-process test can prove directly);
  read Playwright 1.58.2's `normalizeAndSaveAttachment` to confirm `attach({path})`
  **copies** rather than moves, so moving the healed-entities attachment to a `body` does
  not change what the orchestrator's post-test scan finds on disk.
- Result: both confirmed.
- Anomalies: none.

## Findings

- [ ] **HIGH F-001 — CI cache application is now live (release note, not a defect)**:
  `config.ts` previously loaded action-entity stores through
  `createActionEntityCache(...).loadAll()`, which in CI with a token resolves to
  `CloudActionEntityCache` whose `loadAll()` is unconditionally `undefined`. CI runs
  therefore downloaded cache entries into `.shiplight/action-cache/` and never read them —
  the cache was inert in its target environment. It now reads the staged directory, so CI
  runs genuinely replay from cache. Evidence: `apps/cli/src/cache/actionEntityCacheStore.ts:208-223`,
  `apps/cli/src/config.ts:88`, tests in `actionEntityCacheStore.test.ts`. Follow-up:
  feature owner to call this out in the release notes and watch the first real CI run for
  runtime and failure-mode changes.
- [ ] **MEDIUM F-002 — `failed` bucket is structurally zero**: `CacheMetadataCollector.recordFailed()`
  has no production caller, so a cached entity that broke and could not self-heal is still
  reported as a successful `cache_hit`, and the uploaded summary always says `failed: 0`.
  Populating it needs a statement-UID channel from runtime to the reporter that does not
  exist — step results carry `stepId`, not `uid`, and `(file, stepId)` is ambiguous inside
  a suite because stepIds restart at `main.0` per test. Evidence:
  `apps/cli/src/cache/cacheMetadataCollector.ts:92-96`; no caller outside tests. Follow-up:
  feature owner to decide between threading the UID through step results or dropping the
  bucket from the uploaded shape.
- [ ] **LOW F-003 — priorities are inferred**: no upstream PRD ranks any behavior in this
  change. Every P-level in the spec and matrix is this session's judgment. Follow-up:
  feature owner to confirm or correct, particularly the P1 on the CI cache path.

## Deferred / Residual Risk

- [ ] **D-001 — CI cache round-trip end-to-end**: download → stage → transpile → replay is
  proven seam-by-seam but never as one path. Retest: a real CI run with
  `SHIPLIGHT_API_TOKEN` against a repo with a warm cloud cache. Pass criterion: the run
  logs `Cache: downloaded N action stores`, and the uploaded `cacheSummary` reports
  `cache_hits > 0` rather than an all-`original` summary.
- [ ] **D-002 — Playwright watch/UI mode**: the reset is proven by calling
  `transpileAllYamlTests` twice in one process, not by a real watch session. Retest:
  `npx playwright test --ui`, edit one YAML, re-run. Pass criterion: the second run's
  `cacheSummary.total_statements` equals that run's own statement count, not the sum.
- [ ] **D-003 — IF/WHILE branch counting**: both arms of an IF and the body of a WHILE are
  counted whether or not they execute. This is a deliberate transpile-time semantic (the
  transpiler cannot know which arm is taken), documented in `statements.ts`, and is not a
  defect — but it means `total_statements` is not an executed-statement count, and the HTML
  report renders it next to executed-step counts. Retest: none; revisit if the platform
  ever reconciles the two numbers.
- [ ] **D-004 — tsup split proven by proxy**: CACHE-EFF-T01 loads a second module instance
  via a query-suffixed dynamic import, which reproduces the *situation* but not the actual
  bundle split; the four-bundle grep is the direct evidence and is manual. Retest: after
  any `tsup.config.ts` entry change, re-grep the built bundles for
  `__shiplightRunCacheMetadata__`. Pass criterion: exactly one occurrence per bundle.
- [ ] **D-005 — UIDs hash the absolute file path**: pre-existing and unchanged here, but
  now extended to hook statements. A cloud cache shared between machines with different
  checkout paths keys differently. Retest: none in this scope; belongs to FR-011's own
  contract.

## Cleanup

- Cleanup performed: all tests create and remove their own temp directories in
  `afterEach` / `after`; no fixture data persists.
- Resources intentionally left behind: `apps/cli/dist/` (rebuilt during verification —
  required by CACHE-EFF-T06 and normally present).
- Follow-up cleanup required: none.

## Coverage Summary

- Total testing whats: 25
- COVERED: 15
- PARTIAL: 5
- IMPLICIT: 3
- NOT COVERED: 1
- NOT MEASURED: 1
- MANUAL: 0
- BLOCKED: 0
- DEFERRED: 0
