# Quality Improvement Progress

Tracks work against the ranked recommendations in
`.quality/generated/recommendations/monots-publish-review--whole-project.json`
(latest: generated 2026-08-07T06:21Z against the current 47-check graph — 34
recommendations; coverage 73, evidence confidence 80 HIGH, runtime quality 46,
structure confidence 57. Prior scan 2026-07-26T21:23Z was 73 / 80 / 63 / 57 over
the same 47 checks, but under engine schema 4; the 2026-08-07 scan is schema 5,
so the two runtime numbers are **not comparable**. The original baseline this log
started from was 2026-06-09T23:58Z, 33 recommendations, 26/100.)

> Do not read the 2026-07-26 score movement as the effect of one change: that
> scan also picked up 4 checks the previous scan never saw and a newer MCP run
> (29884749396, 2026-07-22, replacing the 2026-06-28 one). What *is* cleanly
> attributable is which recommendations closed — see root cause 2.

> The recommendations file is **tool-generated and may refresh** on each QC scan.
> This file is the durable human-tracked progress log. Re-read the JSON before
> each work session and reconcile statuses here.
>
> Reconciling: the list is **not** truncated unless you pass `--limit`. Verified
> 2026-07-26 — `analyze --limit 200` returns the same 20 items. An item's absence
> from the list therefore does mean it has no open recommendation.

## Root-cause finding (read this first)

**Corrected 2026-08-07. The A/D batch never flipped, and the reason is not in
this repo.** Acquisition and resolution are now both `valid` (344 matched
observations, 0 ambiguous), so every earlier acquisition theory below is closed.
26 checks are still `unobserved` and 8 `partial` for one reason:

**`observations from-junit` in the pinned `@shiplightai/quality-tools@0.3.0`
rejects the CLI and sdk-core unit reports outright, so those two lanes contribute
zero observations.** The publish runs say so in plain text:

```
##[warning]Canonical observation input was rejected: /tmp/qc-observations/cli/unit.junit.xml
##[warning]Canonical observation input was rejected: /tmp/qc-observations/engine/sdk-core-unit.junit.xml
```

Why: node:test's JUnit reporter writes `classname="test"` for every case and puts
the `describe()` title only in the enclosing `<testsuite name>`. 0.3.0 ignores
that suite chain and keys `test_case` on the bare `<testcase name>`. Two
same-named `it()`s in different `describe` blocks of one file therefore collapse
to one `path + test_case` identity, and a duplicate identity invalidates the
whole manifest by contract. Four such collisions exist in the CLI report (e.g.
`apps/cli/src/fixture.test.ts` has `falls back to process.cwd() when rootDir is
unavailable` under both `resolveProjectRoot` and `resolveTestDataDir`) and more
in sdk-core (`js_action.test.ts`). Four collisions void 910 records.

This is why the shipped CLI manifest holds 223 records spanning only 17 files,
none under `apps/cli/src/**`, and why the SDK manifest holds 6. It is also why
MCP scores higher than the CLI: its four JUnit reports happen to contain no
colliding names and convert cleanly.

**The fix is already merged upstream and unpublished.** `quality-tools`
`origin/main` (commits `15acf35`, `8d55847`, `314dfbd`, 2026-08-03) qualifies a
colliding case with its suite path, and only when that actually disambiguates.
0.3.1, published 2026-08-03T21:19:59Z — minutes *before* those commits — still
rejects both files, and the three monots workflows pinned `0.3.0` exactly (15
occurrences across `publish-cli.yml`, `publish-mcp.yml`, `sdk-tests.yml`), so
they never even received 0.3.1.

**Resolved 2026-08-10.** `@shiplightai/quality-tools@0.3.2` is published
(`2026-08-10T04:38:46Z`, npm dist-tag `latest`) and carries the fix: the
registry tarball converts the previously rejected `cli/unit.junit.xml` to 910
records. All 15 pins are bumped to 0.3.2 in this change.

**Confirmed against real runs 2026-08-10.** `dry_run=true` runs of
`publish-cli.yml`
([31357424698](https://github.com/ShiplightAI/monots/actions/runs/31357424698))
and `publish-mcp.yml`
([31357430933](https://github.com/ShiplightAI/monots/actions/runs/31357430933))
both succeeded with **zero** `Canonical observation input was rejected`
warnings. The canonical manifests now carry what was being discarded:

| Manifest | Before | After | Recovered |
| --- | ---: | ---: | --- |
| `quality-cli-observations` | 223 | 1150 | 935 records under `apps/cli/src/**` (was 0) |
| `sdk-tests-observations` | 6 | 591 | 585 under `packages/sdk-core/**` (was 0) |
| `quality-mcp-observations` | 92 | 92 | unchanged — it never had colliding names |

Runtime quality **90 whole-project / 96 shiplightai / 86 mcp-server** (from
46 / 30 / 53), open recommendations 34 → 8. Coverage, evidence confidence, and
structure confidence are unchanged, correctly: nothing about the graph changed,
only whether passing results were visible. These match the pre-merge simulation
exactly, including the residual list.

### The 8 residual items, triaged 2026-08-10

Not one is an observation-wiring gap. Verified by checking each proof path
against the filesystem and each lane's file selection.

**Group 1 — the checks describe a deleted product surface (ranks 1-4, all
feature 003). RESOLVED 2026-08-10 — do NOT write these tests.**
The first read of this group was wrong: it looked like four missing tests, and
the recommendation's `next_action` said to write them. In fact
`cloudTokenGating.test.ts`, `resolveLocalReferences.test.ts`,
`matchEnvironmentByUrl.test.ts` and `saveFunction.test.ts` existed and passed
until commit `736d9e973` ("browser-only server, drop the v1 cloud surface",
2026-07-30) deleted them together with the code they tested —
`testCaseTools.ts`, `dataTools.ts`, `testResultTools.ts`, `TokenApiClient.ts`,
`IApiClient.ts`. Verified with `git show --diff-filter=D`, not inferred from the
files being absent.

An `unobserved` check whose proof was deleted is indistinguishable from one
nobody got round to writing. That is why this nearly became four days of writing
tests for code that no longer ships.

Outcome: `exp-cloud-token-gating`, `exp-env-url-matching` and
`exp-file-io-wrapping` were removed from the 003 map; `exp-local-references`
moved to 002 with the CLI. The surviving "no cloud tool may reappear" intent
rides on `exp-session-bound-surface`, whose test already asserts the exact
registered surface.

**Group 2 — the test exists but no lane selects it (ranks 5-7).**

| Check | Existing proof | Why unobserved |
| --- | --- | --- |
| `exp-transpile-strict` | `packages/types/src/test-flow/validateTestYaml.test.ts` | the types step in `publish-mcp.yml` hardcodes one file, `src/test-flow/yamlRoundtrip.test.ts` |
| `exp-usage-summary` | `packages/shiplight-tools/src/testFlowTranspiler.test.ts` | `shiplight-tools` appears in no workflow; it has no emission step at all |
| `exp-dom-extraction` | `packages/sdk-core/tests/specs/interactive-class-names.spec.ts` | the keyless browser lane in `sdk-tests.yml` runs only `tests/specs/engine-fixture.spec.ts` |

Each is a one-line selection widening, but each also changes *what CI runs* and
can newly fail a release gate, so it is an owner decision, not mechanical glue.
**DONE 2026-08-10** (PR #2226): all three lanes now emit. Each newly selected
file was run locally first (37, 20 and 3 tests, all passing), and the pinned
`test_case` on `testFlowTranspiler` was verified to survive 0.3.2 conversion
verbatim so the pin still joins.

**Group 3 — keyed live-AI proof (rank 8). ACCEPTED 2026-08-10.**
`exp-vision-fallback`'s `pure-vision.spec.ts` requires `RUN_PURE_VISION_LIVE=1`,
a provider key, a 1920x1080 viewport and a healthy staging site, so it is
deliberately out of CI. Owner decision: do not fund a keyed lane; recorded as
`accepted_gaps: ["deferred"]` on the check. Note the record changes no score and
does not clear the check from the recommendation list under quality-tools 0.3.2
— it documents the decision so the gap is not re-triaged as an oversight.

### Superseded 2026-07-26 finding

**Corrected 2026-07-26.** The original finding (kept below) was right when
written and is now superseded. The unit-JUnit wiring it asked for shipped in
PR #2088 and the 2026-07-21 scan proved it works — 520 observations matched, 0
ambiguous. Items are still `unobserved` for three *different* reasons, none of
which is a missing test.

1. **The CLI profile ingested nothing at all — FIXED 2026-07-26.** QC reads the
   newest run of `publish-cli.yml`. Every release *ends* with a `promote` run,
   which skips `sdk-tests` and `publish` and uploads no artifacts at all. Both
   scanned runs (29437971697, 29772513613) were promote runs with zero
   artifacts, so all four CLI adapters reported
   `MISSING_OBSERVATION_ARTIFACT_MATCH`. That message reads like a path bug,
   which is why this was misdiagnosed as a wiring gap for three scans. The
   promote job now re-uploads the source dry-run's results, held in place by
   `scripts/__tests__/publish-workflow-observations.test.mjs`. Verified against
   the last real publish run (30046830346): its `cli/unit.junit.xml` covers 38
   `apps/cli/src/**` test files and does contain the A/D proof —
   `fixture.allowlist.runtime` (the #1 P0 item), `versionCheck`, `dotenvSource`,
   `extension-helpers`, `fixture.contextOptions`, `commands/debug`,
   `commands/test`. Those should flip on the first scan after the next promote.
2. **All MCP report shards now enter one canonical artifact — CLOSED
   2026-07-26.** The MCP run emits `mcp/mcp-server-unit.junit.xml` (covers
   `apps/mcp-server/src/stdioGuards.test.ts`) and
   `mcp/types-roundtrip.junit.xml` (covers
   `packages/types/src/test-flow/yamlRoundtrip.test.ts`) alongside the
   mcp-tools unit and browser reports. The workflow now converts all four JUnit
   reports and merges them into one validated `quality-observations.json`.
   `observation-sources.yaml` only locates that canonical file; it no longer
   chooses report parsers. This prevents an uploaded native report from being
   silently omitted by source configuration.
3. **The CLI Playwright "logic" lane enters the canonical artifact —
   CONFIGURED 2026-07-26, awaiting a deployed run.** The workflow converts
   `cli/logic.playwright.json` alongside the two CLI JUnit reports and merges all
   three into one validated `quality-observations.json`. That covers
   `apps/cli/tests/**` — the only proof for exp-config-roots and four of
   exp-transpile's five evidence rows. Local conversion and resolution against
   the real report succeeded without ambiguous matches, but GitHub acquisition
   cannot confirm it until a run containing the new canonical artifact exists.

### Superseded original finding (2026-06-09)

Almost every recommendation is `observed_state: unobserved` with
`structural_status: COVERED, structural_confidence: HIGH`. The blocker is **not**
missing tests — it is that **QC has no runtime observation (JUnit artifact) loaded**
for them. Proof: Rank #1 (`exp-env-allowlist`) lists `fixture.allowlist.runtime.test.ts`
(added this session, passing) as a proof source and is *still* `unobserved`.

The publish workflows only emit JUnit for the **browser** lanes
(`cli/browser-e2e`, `mcp/browser-tests`, `engine-fixture`). The **unit** lanes
(`pnpm test:unit`), which back ~22 of these expectations, emit no ingestable
artifact, and `observation-sources.yaml` maps none.

**Highest-leverage action:** emit unit-lane JUnit in the publish/`sdk-tests`
workflows and map it in `.quality/config/observation-sources.yaml`. One change
flips the whole A + D batch (22 items) to observed on the next publish run + scan.

## Closure classification

| Group | Meaning | Count | Action |
| --- | --- | ---: | --- |
| **A — wiring** | Test exists & passes; needs unit JUnit emitted + ingested | 15 | Observation pipeline |
| **D — partial-wiring** | Some linked evidence observed; remaining linked test exists, needs ingest | 7 | Observation pipeline (+ run any keyless browser/spec lanes) |
| **B — new test/assertion** | Genuinely missing proof; write the test | 11 | Per-item test work (some Optional) |

## Plan

1. **[MERGED — PR #2088] Observation wiring (covers A + D, 22 items).**
   Merged to main 2026-06-10. Emitted `test:unit` JUnit from `publish-cli.yml`
   (cli/unit.junit.xml), `publish-mcp.yml` (mcp/unit.junit.xml), and
   `sdk-tests.yml` (engine/sdk-core-unit.junit.xml); mapped all three in
   `observation-sources.yaml` (both profiles, new `*-unit-junit` adapters). Each
   testcase carries `file=<evidence path>` for QC auto-matching.
   **Outcome:** the wiring itself is correct and proven (520 matched
   observations on the 2026-07-21 scan), but the A/D batch did not clear — six
   items are confirmed still unobserved and the rest are unknown, for the three
   reasons in the corrected root-cause finding above.
2. **[DONE 2026-07-26] Promote runs can carry source-run results (root cause 1).**
   `publish-cli.yml`'s promote job now re-uploads the source dry-run's two small,
   dedicated observation artifacts when they are available. That transfer is
   deliberately non-blocking: the optional quality viewer cannot add a release
   prerequisite to the promote path's validated-tarball safety contract. Guarded
   by `scripts/__tests__/publish-workflow-observations.test.mjs`.
3. **[DONE 2026-07-26] Close root causes 2 and 3.** The CLI, MCP, and shared SDK
   workflows now convert their native JUnit/Playwright reports with
   the exact `@shiplightai/quality-tools@0.3.0` release, record hard-gate
   outcomes, merge every available shard after the last producer, validate the
   result, and upload `quality-observations.json` in dedicated artifacts. Source
   profiles now contain transport and artifact location only. A contract test
   checks every workflow path, producer ordering, failure handling, package pin,
   and selected artifact. Finalization is best-effort and cannot block a release;
   raw SDK reports remain available in a separate diagnostic artifact.
4. **B items — real test work**, highest risk-weight/priority first
   (#6 resolver traversal P1, #11 transpile compile P1, #14 action exec P1,
   #20 step budgets P1, then P2/P3 and Optional).
5. After the next promote run, re-scan QC and reconcile the A/D statuses here.
   A normal publish (`gh workflow run "Publish shiplightai" -f dry_run=true`)
   also produces the artifacts, but only a promote exercises the 2026-07-26 fix.

## Open questions / assumptions

1. **Canonical observation→evidence matching — ANSWERED 2026-07-26.**
   `quality-tools` resolves each canonical observation `path` against
   `evidence.path`, with optional `test_case` refinement. Native report parsing
   belongs to the workflow producer, not `observation-sources.yaml`.
2. **Path normalization — ANSWERED 2026-07-26: the assumption was correct.** QC
   strips the workspace prefix. Those same 520 matches came from node:test JUnit
   carrying `file="/home/runner/work/monots/monots/..."` matched against
   repo-relative `evidence.path`. The 61 unmatched observations are test files no
   quality map references (e.g. `emailToolRegistration.test.ts`,
   `upload_file.test.ts`), not normalization failures.
3. Local ingestion and graph resolution are verifiable with `quality-tools`;
   GitHub acquisition still requires a completed workflow run carrying the
   canonical artifacts. The 2026-07-26 local contract test ingested 163 real
   CLI/MCP observations with valid resolution and zero ambiguous matches.
4. **Producer coverage guard — DONE 2026-07-26.**
   `scripts/__tests__/publish-workflow-observations.test.mjs` verifies that every
   modeled publish path finalizes after its proof producers and uploads each
   canonical file through the exact artifact selector in the corresponding
   observation profile. It also protects promote's optional-transfer boundary.

The workflow-path gate records are truthful run provenance and guarantee that a
failed or skipped producer can still leave a non-empty canonical manifest. They
are intentionally not mapped as feature proof: runtime scores come only from the
available native test-report records whose paths match quality-map evidence.

## Status log

Statuses: TODO · WIRING-READY (test green locally, awaits ingest) · DONE (observed) · OPTIONAL-SKIPPED

### A — wiring (test exists, passes locally; needs ingest)
> **2026-08-07: every open item in groups A and D is blocked by the single
> converter defect in the top root-cause finding, not by anything below.** The
> per-item reasoning in this section predates that finding; keep it for history
> and reconcile after the `quality-tools` 0.3.2 pin bump lands.
>
> **ALL WIRING-READY** as of PR #2088: unit JUnit is emitted and mapped, and the
> mapping mechanism is now proven to work. The 2026-07-21 scan did **not** flip
> them: the CLI items because the scanned run was a promote run carrying no
> artifacts (fixed 2026-07-26), the MCP items #8 and #2 because their result
> files have no adapter (still open). See the corrected root-cause finding.
>
> **Definitive status from the complete 2026-07-26 list.** Still open:
> #1 exp-env-allowlist, #13 exp-action-cache, #15 exp-dotenv-precedence,
> #26 exp-version-guards — all feature 002, all blocked only by root cause 1.
> Resolved (no open recommendation): #5 exp-llm-provider-routing,
> #2 exp-yaml-export (now 002 exp-yaml-roundtrip), #3 exp-chrome-relay,
> #4 exp-cloud-token-gating, #8 exp-stdio-guards, #17 exp-tool-registry,
> #16 exp-env-url-matching, #18 exp-model-parsing, #22 exp-resource-uris,
> #25 exp-file-io-wrapping. #7 exp-scaffold-project became 002
> exp-create-scaffold and is still open.
- [ ] #1  exp-env-allowlist (002, P0) — runtime proof added this session (PR #2088); WIRING-READY pending unit-JUnit ingest
- [ ] #5  exp-llm-provider-routing (001, P1)
- [ ] #2  exp-yaml-export (003, P1)
- [ ] #3  exp-chrome-relay (003, P1)
- [~] #4  exp-cloud-token-gating (003, P1) — **CHECK REMOVED 2026-08-10**: commit 736d9e973 deleted the v1 cloud surface, so there is no cloud path left to gate. The "no cloud tool may reappear" intent now rides on 003 exp-session-bound-surface.
- [ ] #7  exp-scaffold-project (003, P1)
- [ ] #8  exp-stdio-guards (003, P1)
- [ ] #17 exp-tool-registry (003, P1)
- [ ] #13 exp-action-cache (002, P2)
- [ ] #15 exp-dotenv-precedence (002, P2)
- [~] #16 exp-env-url-matching (003, P2) — **CHECK REMOVED 2026-08-10**: matchEnvironmentByUrl went with the cloud environment surface (736d9e973).
- [ ] #18 exp-model-parsing (001, P2)
- [ ] #22 exp-resource-uris (003, P3)
- [~] #25 exp-file-io-wrapping (003, P3) — **CHECK REMOVED 2026-08-10**: saveFunction/saveTestCase went with the cloud sync surface (736d9e973).
- [ ] #26 exp-version-guards (002, P3)

### D — partial-wiring (remaining linked evidence needs ingest)
> **Unit-backed evidence WIRING-READY** (PR #2088). Items whose remaining proof is a
> keyless browser/spec lane (#32 dom-extraction, parts of #27/#28) may still need that
> lane's JUnit emitted too — revisit after the scan shows which stay partial.
>
> **Definitive status from the complete 2026-07-26 list.** Still open:
> #29 exp-create-scaffold, #30 exp-debug-server, #31 exp-test-command,
> #33 exp-fixture-context (all `unobserved`, all 002, all blocked only by root
> cause 1) and #32 exp-dom-extraction (`partial`, 001). Resolved:
> #27 exp-nl-to-action-loop and #28 exp-self-healing-locators.
- [ ] #27 exp-nl-to-action-loop (001, P0)
- [ ] #28 exp-self-healing-locators (001, P1)
- [ ] #29 exp-create-scaffold (002, P1)
- [ ] #30 exp-debug-server (002, P1)
- [ ] #31 exp-test-command (002, P1)
- [ ] #32 exp-dom-extraction (001, P1)
- [ ] #33 exp-fixture-context (002, P1)

### B — new test / assertion (real work)
- [x] #6  exp-local-references — **RESOLVED 2026-08-10, moved to 002.** The MCP-side `resolveLocalReferences` was deleted with the rest of the v1 cloud surface (736d9e973); `template:`/`call:` resolution now lives in the CLI transpiler (`packages/shiplight-tools/src/yaml-transpiler/`). The deferred product decision was made: the CLI does NOT sandbox these paths — staying inside the project is the test author's responsibility — so the security framing is dropped and the check is about resolving to the right file. Re-authored as 002 exp-local-references against the existing pipeline.test.ts resolution tests.
  - **Next CLEAN B-items (no product-decision ambiguity, assert existing safe behavior):** #24 exp-knowledge-injection (mock model call, assert knowledge text in prompt), #12 exp-report-merge (assert merged report combined count + copied screenshots).
- [x] #9  exp-variable-substitution (001, P1) — **DONE** (test green): `sensitiveRedaction.test.ts` proves no secret value reaches `getActionGenerationUserPrompt` (shown as `[SENSITIVE - value hidden]`) or `maskSensitiveVariables` (`*****`); exported the mask helper; proof_gap resolved in 001 map. Redaction was already implemented — no product change.
- [ ] #11 exp-transpile (002, P1) — gated step that tsc-checks/runs a transpiled spec
- [ ] #14 exp-action-execution-config (001, P1) — run one transpiled action e2e vs fixture HTML
- [ ] #20 exp-step-budgets (001, P1) — browser fixture w/ dismissible modal, assert modal-dismiss cap
- [ ] #12 exp-report-merge (002, P2) — assert merged report combined count + copied screenshots
- [ ] #23 exp-session-new-schema (003, P2) — extend session-lifecycle to assert a configured option takes effect
- [ ] #10 exp-vision-fallback (001, P2) — keyed fixture forcing insufficient DOM → coordinates action
- [ ] #19 exp-context-options (002, P2) — already repaired this session (PR #2088); WIRING-READY
- [ ] #21 exp-inspect-command (003, P3) — Optional: `--stats` assertion for a suite YAML
- [x] #24 exp-knowledge-injection (001, P3) — **DONE** (test green): `knowledgeInjection.test.ts` proves retrieved knowledge content is injected into the action-generation prompt under `<retrieved_knowledge>` (every item, in order; none → no block). Tested the real prompt-construction seam directly. No product change. proof_gap resolved in 001 map.

### Optional (explicitly marked Optional in next_action; skip unless requested)
- #2 exp-yaml-export, #3 exp-chrome-relay, #4 exp-cloud-token-gating, #8 exp-stdio-guards,
  #13 exp-action-cache, #21 exp-inspect-command
