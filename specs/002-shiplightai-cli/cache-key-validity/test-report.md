# Test Report: Action-entity cache key — identity vs validity

**Test spec**: [test-spec.md](./test-spec.md)
**Branch / commit**: `feng/workspace` — **uncommitted working tree**; `git log origin/main..HEAD`
is empty, so the entire change under test lives in unstaged/untracked files.
**Last updated**: 2026-08-05
**Tester**: Claude Opus 5 (agent session)

This report is the development session record: what was tested, by what test **type**, what
ran, and what failed or was blocked. It records facts, not a graded confidence verdict.

## Summary

- Overall session status: **PASS**
- What this session added or strengthened: 44 unit tests across 4 new files covering the
  separation of statement **identity** (UID) from cached-entity **validity**
  (`source_fingerprint`), plus the repo-relative identity path that makes UIDs
  checkout-independent. Both halves are backed by negative controls — reverting each
  production change fails the tests that assert it.
- Blocking findings: none.
- Known gaps left for follow-up: four, all recorded below with what would prove them — the
  one-time cold cache on upgrade (accepted by the owner's explicit decision), artifact
  reattachment end-to-end, a real Windows runner, and a real cross-machine cloud round-trip.
  Two dead functions with actively misleading docstrings were found and left in place.

## Source Material

- Source material used: `specs/002-shiplightai-cli/spec.md` (FR-011; User Story 1 declares
  P1), sibling `cache-effectiveness/` and `cache-batching/` test specs, repo-root
  `TESTING.md`, the implementation diff, and a high-effort multi-agent code review of the
  first attempt at this fix (10 verified findings, all closed).
- Source material not found or not available: no PRD ranks FR-011's sub-behaviors
  individually. Priority is carried from User Story 1's declared **P1**; the two behaviors
  marked **inferred P2** are flagged as this session's judgment in the spec, not an upstream
  declaration.

## Commands Run

| Command | Result | Notes |
| --- | --- | --- |
| `cd packages/types && pnpm build` | `PASS` | Prerequisite — `shiplight-tools` and the CLI resolve this package through `dist`. |
| `cd packages/types && pnpm test` | `PASS` | 416 tests, 416 pass, 0 fail, 0 skipped. |
| `cd packages/shiplight-tools && pnpm build` | `PASS` | Prerequisite — the CLI bundles this package's `dist`. |
| `cd packages/shiplight-tools && pnpm test` | `PASS` | 93 tests, 93 pass, 0 fail, 0 skipped. |
| `cd apps/cli && pnpm test:unit` | `PASS` | 815 tests, 814 pass, 0 fail, 1 skipped. |
| `pnpm --filter shiplight-types typecheck` | `PASS` | `tsc --noEmit`. |
| `pnpm --filter shiplight-tools typecheck` | `PASS` | `tsc --noEmit`. |
| `pnpm --filter shiplightai typecheck` | `PASS` | `tsc --noEmit`. |
| `pnpm --filter @shiplightai/test typecheck` | `PASS` | `tsc --noEmit` — consumes `createRunnerStoreEntry`, whose signature gained an optional parameter. |
| `git check-ignore -v .shiplight/inline-fingerprints.json` | `PASS` | Matches `.gitignore:86 .shiplight/`; the scaffolded template ignores it too. |
| **Negative control** — revert `statements.ts`, run the gate suite | `PASS` (as designed) | 5 tests, **2 pass / 3 fail**. The 2 that pass are the still-serves and grandfather cases, which must hold in both states. |
| **Negative control** — revert `yamlParser.ts`, run the identity suite | `PASS` (as designed) | 10 tests, **9 pass / 1 fail**. The failure is the cross-checkout UID case — the property the wiring exists to deliver. |

The CLI suite's single skip is the pre-existing `report --merge` case that self-skips
without a built `dist/cli.js`; it is unrelated to this change.

## Tests Added Or Updated

| Type | Files | Tests |
| --- | ---: | ---: |
| Unit | 4 | 44 |
| Contract | 0 | 0 |
| Integration | 0 | 0 |
| E2E | 0 | 0 |
| Agent | 0 | 0 |
| Script / static | 0 | 0 |
| **Total** | **4** | **44** |

### File List

- `packages/types/src/test-flow/actionEntityFingerprint.test.ts` (17 tests) — fingerprint
  semantics, noise-stability, the `''`/`undefined` distinction, and a golden serialization.
- `packages/shiplight-tools/src/yaml-transpiler/statementIdentityPath.test.ts` (10 tests) —
  repo-relative derivation, POSIX normalisation, git anchoring, and UID consequences.
- `packages/shiplight-tools/src/yaml-transpiler/actionEntityFingerprintGate.test.ts`
  (5 tests) — the applicability gate at the transpiler seam.
- `apps/cli/src/cache/inlineFingerprintMap.test.ts` (12 tests) — the cross-process bridge
  and the pure stamping step.

A prior file, `deterministicUid.test.ts` (9 tests), was **deleted**: it pinned the
content-keyed UID design that the code review rejected, so keeping it would have asserted
the defect.

## Coverage Matrix

| Behavior (from test-spec) | Priority | Test type | Coverage | Session result | Notes / gap |
| --- | --- | --- | --- | --- | --- |
| Hand-edited locator/xpath/kwarg is what runs | P1 (declared) | unit | COVERED | PASS | The core defect; fails without the gate. |
| Cached entity still serves unchanged YAML | P1 (declared) | unit | COVERED | PASS | Guards against "fixing" it by disabling the cache. |
| Upgrading does not empty an existing cache | P1 (declared) | unit | COVERED | PASS | Grandfather branch asserted; real populated-cache upgrade deferred. |
| Screenshots stay attached across an edit | P2 (inferred) | unit | IMPLICIT | PASS | Proven via UID stability, which is what names the directories; no end-to-end read-back. |
| UID is an identity, independent of content | P1 (declared) | unit | COVERED | PASS | Asserted inside the gate test across a locator edit. |
| UID is checkout-independent | P1 (declared) | unit | COVERED | PASS | Two fixture repos at different absolute roots. |
| UID uses POSIX separators | P1 (declared) | unit | COVERED | PASS | No real Windows runner — see Residual Risk. |
| Repo anchoring: worktree / nested / none | P1 (declared) | unit | COVERED | PASS | `.git`-as-file shape reproduced; real `git worktree` not invoked. |
| Repo and branch excluded from the UID | P1 (declared) | static | COVERED | PASS | By construction — the identity function takes no branch input. |
| Fingerprint moves on semantic edits | P1 (declared) | unit | COVERED | PASS | Locator, xpath, action name, kwarg value, kwarg added. |
| Fingerprint stable under noise | P1 (declared) | unit | COVERED | PASS | Key order (flat + nested), scalar retyping, entity debris; array order correctly moves it. |
| `''` distinct from `undefined` fingerprint | P1 (declared) | unit | COVERED | PASS | All four combinations asserted. |
| Serialization frozen against silent drift | P1 (declared) | unit | COVERED | PASS | Golden string; relational assertions alone would not catch a stringifier change. |
| Re-heals overwrite the same key | P1 (declared) | unit | IMPLICIT | PASS | Follows from content-independent UIDs plus the existing merge write-back; not separately asserted. |
| Bridge is merged, not replaced | P1 (declared) | unit | COVERED | PASS | Two merges; later wins, earlier survives. |
| Bridge degrades, never corrupts | P1 (declared) | unit | COVERED | PASS | Absent, malformed, non-object, unwritable, corrupt-then-merge. |
| Stamping selects and does not mutate | P1 (declared) | unit | COVERED | PASS | Extracted as a pure exported function to make this directly assertable. |
| Refused entry reports `original`, not a hit | P1 (declared) | unit | COVERED | PASS | Keeps the sibling cache-effectiveness metric honest. |
| No new secret egress | P1 (declared) | static | COVERED | PASS | Verified, not assumed — see Findings. |
| No user working-tree churn | P1 (declared) | static | COVERED | PASS | `.shiplight/` and `*.yaml.spec.ts` ignored in repo and scaffold template. |
| One cold cache on upgrade | P1 (declared) | — | NOT COVERED | DEFERRED | Accepted by owner decision over a dual-read migration. |
| Pre-upgrade screenshots detach once | P2 (inferred) | — | NOT COVERED | DEFERRED | Cosmetic; self-corrects after one run. |

### FR / User-story keyed view

| Id | Requirement | Coverage | Session result |
| --- | --- | --- | --- |
| FR-011 | Action-entity caching keys entries by a **stable** statement hash | COVERED | PASS — "stable" now holds across checkouts, and validity is checked separately from the key. |
| US1 (P1) | `shiplight test` runs YAML + Playwright with one command | PARTIAL | PASS for the cache path exercised here; the story's own e2e coverage is out of this scope. |

## Agent Test Evidence

None. This change has no browser, provider, or live-service surface, so no agent case was
authored — `agent` is not in the feasible set here, not merely more expensive.

## Manual Verification Log

### 2026-08-05

- Environment: local workspace, no product environment involved.
- Scenarios checked: read-only inspection for the two review-proven behaviors — that
  `{{VAR}}` placeholders are substituted at runtime in `sdk-core` rather than at transpile
  time, and that `.shiplight/` plus `*.yaml.spec.ts` are ignored in both this repo and the
  scaffolded template.
- Result: both confirmed.
- Anomalies: none.

## Findings

No blocking failures.

- [x] **INFO — no new secret egress (verified, not assumed).** The fingerprint includes
  `action_data.kwargs`, which can hold typed text. Two facts make this safe and both were
  checked rather than reasoned about: `{{VAR}}` placeholders are substituted at runtime by
  `replaceVariables` in `sdk-core`, so the YAML — and therefore the fingerprint — carries
  `{{TEST_PASS}}` and not its value; and the cached `action_entity` already ships
  `action_data.kwargs` to the cloud today, so fingerprinting them adds no new class of
  egress. Evidence: `packages/sdk-core/src/agent/agentHelpers.ts:120`,
  `packages/types/src/test-flow/actionEntityCache.ts:18`.
- [ ] **LOW — two dead functions with misleading docstrings, left in place.**
  `apps/cli/src/cache/statementHash.ts:18` (`computeStatementHash`) has no callers anywhere
  and documents the cache key as built from a "relative path from project root" — which was
  false until this change and is still not what computes the key. It is what led both the
  code review and this session to read intent into the absolute path that was never there.
  `resolveActionEntity` in `packages/types/src/test-flow/actionEntityStore.ts:104` is
  likewise uncalled, and being a second lookup path it would need the same applicability
  gate if it were ever revived. Follow-up: delete both, or gate `resolveActionEntity` and
  correct the other's docstring.
- [ ] **INFO — pre-existing orphan entries are untouched.** This change adds no orphans
  (re-heals overwrite their key), but entries stranded by earlier behavior remain, and
  nothing prunes under the server-side per-file cap. Out of scope here; belongs with
  `cache-batching`.

## Deferred / Residual Risk

- [ ] **One cold cache on upgrade.** Every UID moves once because the identity path became
  repo-relative, so the first run after release re-heals, reports zero cache hits, and takes
  the re-heal time. This is an accepted decision, not an oversight — the owner chose it over
  carrying dual-read migration code. Retest: run a repo with a populated pre-release cache
  against the new build. Pass criterion: run 1 reports ~0 hits and completes green; run 2
  reports a normal hit rate.
- [ ] **Artifact reattachment end-to-end.** UID stability across an edit is asserted, and
  artifact directories are named by UID, but no test drives a real failing run and reads the
  screenshots back through the debugger. Retest: fail a statement, edit its locator, reopen
  `shiplight debug`. Pass criterion: the before/after screenshots still render against that
  statement.
- [ ] **Real Windows runner.** POSIX normalisation is asserted by output inspection and by a
  backslash-bearing relative input, not by running on Windows. Retest: a cross-OS CI matrix
  sharing one cache. Pass criterion: the Linux and Windows lanes hit the same entries.
- [ ] **Real cross-machine cloud round-trip.** Checkout-independence is proven at the UID,
  not through a real download → transpile → replay against The Shiplight proxy. Retest: heal locally, push,
  let CI run the same branch. Pass criterion: CI's cache summary reports hits rather than a
  cold cache.

## Cleanup

- Cleanup performed: all fixtures are `mkdtemp` directories removed in `after`/`afterEach`
  hooks; the memoised repo-root cache is reset around each identity test so fixtures cannot
  leak between them. Both negative-control stashes were popped and `git status` was verified
  to match the pre-control state.
- Resources intentionally left behind: none.
- Follow-up cleanup required: none for tests. The two dead functions in Findings are
  product-code cleanup, deliberately not bundled into this change.

## Coverage Summary

- Total testing whats: 22
- COVERED: 18
- PARTIAL: 0
- IMPLICIT: 2
- NOT COVERED: 2 (both DEFERRED with retest procedures)
- NOT MEASURED: 0
- MANUAL: 0
- BLOCKED: 0
- DEFERRED: 2
