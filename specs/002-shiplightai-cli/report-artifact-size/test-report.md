# Test Report: Report artifact size (FR-024 / SC-010)

**Test spec**: [test-spec.md](./test-spec.md)
**Session date**: 2026-08-27 (refreshed same day after two review passes)
**Scope**: uncommitted FR-024 changes in `apps/cli/src/reporter/`, branch `feng/workspace`.

## Commands run

| Command | Result |
| --- | --- |
| `node --test --import ./tpl-loader.mjs --import tsx src/reporter/{reportFiles,contextSnapshot,contextDelta,index.contextEncoding}.test.ts` | **45 passed** |
| `node --test --import tsx src/reporter/contractVectors.test.ts` | **23 passed** (11 step-list cases + the object-carrier case) |
| `node --test --import tsx src/reporter/cloudUpload.test.ts` | **96 passed** (3 new) |
| `pnpm --filter shiplightai build` | clean — required before the merge suite means anything, see the operational note |
| `node --test --import tsx src/commands/report.test.ts` | **55 passed, 0 skipped** (1 new; previously 54 passed with the merge suite silently skipped or stale) |
| `pnpm --filter shiplightai test:unit` | **1157 passed, 0 failed, 1 skipped** (1158 total; the skip is a pre-existing Windows-only case) |
| `pnpm --filter shiplightai typecheck` | clean (exit 0) |

## Tests added / updated this session

- `apps/cli/src/reporter/reportFiles.test.ts` (**new**, 13) — streamed serializer byte-identical to `JSON.stringify(data, null, 2)` across empty/single/undefined/unicode reports; emits one chunk per test so no chunk carries the document; truncates an existing file; HTML render failure returns `false`, writes nothing, removes a previous run's `index.html`, and says the data was still written; a write that fails part-way leaves the previous `report-data.json` intact with no temp file behind.
- `apps/cli/src/reporter/contextSnapshot.test.ts` (**new**, 9) — cap threshold incl. the exact-limit edge, string vs object marker, only oversized keys replaced, input not mutated, explicit limit, values `JSON.stringify` cannot measure; plus the two cases from the contract review below — a string measured in its own characters rather than its JSON's, and a value left alone when the marker would not be shorter.
- `apps/cli/src/reporter/contextDelta.test.ts` (**new**, 20) — first step carries the whole store and later steps only changes; full form dropped; explicit removals; empty delta vs absent field; purity of both directions; idempotent encode; round trip incl. removals; reads the full form untouched; reads a mixed list with a full snapshot resetting state; per-attempt reset; plus the review cases below — encoding a mixed list, a change between two values that cap to the same marker, and `orderStepList` ordering the object carrier by `seq`.
- `apps/cli/src/reporter/index.contextEncoding.test.ts` (**new**, 4) — drives the real `ShiplightReporter` to a temp dir and asserts `report-data.json` carries deltas (not full copies), caps an oversized value, and expands back to what the run observed. *This is the wiring gap this cover pass found: every unit above passes even if the reporter never calls them.* A fourth case drives a **retried** test and asserts each attempt's chain opens from an empty store.
- `apps/cli/src/reporter/contractVectors.test.ts` (**new**, 23) — runs `contracts/report-artifact-vectors.json`, the file the cloud reader is implemented from: every case decoded, and every writer-producible case re-encoded. It caught three shapes the hand-written tests had missed — a step recording only one position, arbitrary JSON value shapes surviving unchanged, and unknown step fields being ignored.
- `apps/cli/src/commands/report.test.ts` (+1) — merges a shard whose steps carry the changed-only form and asserts the merged `report-data.json` reproduces it exactly, with no re-expansion. Spawns the built CLI, so it covers the real merge path — the one that crashed.
- `apps/cli/src/reporter/cloudUpload.test.ts` (+3) — the upload payload carries `contextBeforeDelta`/`contextAfterDelta`, omits them when absent, `buildReportV2` declares `schemaVersion: 3`, and every entry is stamped with its recorded position (`seq`) in order.

## Measurements

Against 264 real per-test artifacts from the affected customer's org (runs read via the The Shiplight proxy API; 306 step lists, 5,757 steps), replayed through the implemented `capVariableSnapshot` + `encodeStepContexts`. Measured before the cap moved from the snapshot to the emitted delta; that reorder changes only whether two identical markers are re-emitted, so the figures move by at most a marker per collision:

| | Pretty-printed step payload |
| --- | --- |
| Before | 217.9 MB |
| + 1 KB value cap | 145.2 MB (−33%) |
| + changed-only encoding | **9.1 MB (−96%)** |

Round-trip mismatches through `expandStepContexts`: **0 of 306 step lists**.

Separately, a report whose pretty-printed JSON exceeds V8's ~512 MB maximum string length: the previous `JSON.stringify(reportData, null, 2)` reproduces `RangeError: Invalid string length`; `writeReportDataFile` wrote 1.2 GB successfully. A 75 MB report written by the streamed path is byte-identical to the old output and parses.

## Coverage matrix

| Behavior | Priority | Test type | Result |
| --- | --- | --- | --- |
| Merged report is written and uploaded regardless of run size | P1 | unit + manual measurement | PASS |
| Streamed write byte-identical to the pretty-printed form, and chunked | P1 | unit | PASS |
| Value cap: threshold, marker, no mutation | P1 | unit | PASS |
| Changed-only encoding: round trip, removals, empty vs absent, purity | P1 | unit | PASS |
| Reader handles full, delta, and mixed step lists | P1 | unit | PASS |
| Attempt scope resets the accumulated state | P1 | unit | PASS |
| Reporter applies cap + delta on the real path to `report-data.json` | P1 | integration-style unit | PASS |
| Upload carries the recorded form; `schemaVersion: 3` | P1 | unit | PASS |
| Encoding lossless on real customer data | P1 | manual measurement | PASS (0 mismatches, 264 artifacts) |
| HTML rendering failure does not abort the upload | P1 | unit | PASS |
| Value cap reports one consistent unit and never inflates a value | P1 | unit | PASS |
| Writer satisfies the published contract, case by case | P1 | unit | PASS (11 cases + object carrier) |
| Merge passes the recorded form through unaltered | P1 | integration | PASS |
| Uploaded entries stamped with recorded position (`seq`) | P1 | unit | PASS |
| Failed render removes a stale `index.html`; `--open` gated on it | P1 | unit + static | PASS |
| Failed write leaves the previous `report-data.json` intact | P1 | unit | PASS |
| Recorded order survives a consumer's own iteration (`seq`) | P1 | unit | PASS |
| Change between two identically-capped values still recorded | P1 | unit | PASS |
| Cloud renders the delta form | P1 | — | NOT MEASURED — reader not built (out of scope, tasks.md T060) |

## Findings addressed this session

A contract review (`/code-review`, reader's perspective) asked what `<n>` counts in the truncation marker and in which unit the cap is measured. Answering it exposed a real defect rather than a wording gap: the threshold was measured on `JSON.stringify(value).length` while the kept prefix was `value.slice(0, 1024)` raw characters. Two consequences, both now fixed and pinned by tests:

- A 600-character string of quotes (JSON length 1202) was capped despite being well under 1024 characters, and reported a length its prefix did not match.
- A 1024-character string was replaced by a **1049**-character marker — capping made the value longer.

Each kind of value is now measured, truncated and reported in one unit, and a value is replaced only when the marker is shorter than what it replaces. The marker also now says `chars` rather than `bytes` for non-strings: it counts characters of JSON, and for non-ASCII values — most of the customer data that motivated this — a byte count would have been a different, larger number.

The same review produced R6 (a key appearing in both `set` and `removed` resolves as set-then-removed) and its decode-only vector. No conforming writer emits that shape; the rule exists so two readers cannot disagree about it.

A second review (`/code-review medium`) raised six findings; all six were acted on.

- **Recorded order was not carried as data.** The reviewer suspected Postgres `jsonb` key reordering. It is not that — `resultJson` never reaches Postgres — but the real mechanism is worse: the cloud reader builds its step list from `actionStepsMap`, partitioned by phase and rebuilt as a tree (`packages/core/src/test-results/artifacts.ts:493`), so it never iterates `resultJson` in document order. A delta chain resolved that way is silently wrong. Each uploaded step entry now carries `seq`, R2 requires sorting by it, and `orderStepList()` plus an object-carrier vector pin it.
- **`--open` opened an unwritten report.** Both `--open` blocks in `commands/report.ts` were ungated; on a render failure `shiplight report --merge --open` would open a previous merge's `index.html` from the same `-o` directory. Now gated on the render.
- **A failed render left a stale `index.html`.** Regenerating over an existing report directory kept the old file, which CI would upload as this run's result. The stale file is now removed and the error says so.
- **Two oversized values could collapse into one marker.** The cap ran *before* the diff, so two `Buffer`s of the same length sharing their first 120 JSON characters compared equal and a real change was dropped. The cap now runs on what the delta emits, so the comparison sees the uncapped values. (Two identical markers still *render* identically — that part is inherent to truncation and is now stated in §7.)
- **The encoder mishandled a mixed list.** A step already in delta form was passed through without advancing the accumulated state, so a later full-form step diffed against a stale state. It now applies the delta to the state, matching `expandStepContexts`'s handling (R3).
- **A failed write truncated the previous report.** `writeReportDataFile` opened the real path with `'w'`; the one-shot `JSON.stringify` it replaced threw before writing anything. It now writes to a temp file and renames on success.

## PR review (#2242)

`claude[bot]` **APPROVED** with no CRITICAL/HIGH/MEDIUM findings and four LOW items. Two were correct and are fixed; two rested on misreadings and were checked rather than actioned:

- **Fixed** — a failed `renameSync` (cross-device temp dir, permission change mid-run) stranded the `.tmp` file, because the fd is already closed by then and the earlier catch no longer covers it. Now cleaned up before rethrowing.
- **Fixed (comment)** — `applyDeltaToState` stores the serialization of a value that may already be a truncation marker, so a later full-form step carrying the uncapped original re-records it. Only a mixed list reaches that path and the decoded values stay correct; the divergence is now documented where it lives.
- **Not a defect** — the review read `generateHtml` as requiring `ReportData & { outputDir: string }`. It takes `ReportData` (`template.ts:547`) and `outputDir` is optional on it (`:151`), so the injected renderer's signature already matches. No change.
- **Not a defect** — the review reported that earlier attempts of a retried test bypass `encodeStepContexts`. `buildReportTest` is called once per attempt (`index.ts:348`) and encoding runs at its end, so every attempt is encoded from a fresh state. The suggested two-attempt test was worth adding anyway and now proves it.

## Operational note: the merge suite is only as current as `dist/`

`report --merge` is covered by spawning the built CLI (`dist/cli.js`), and the suite skips itself when that file is missing. It does **not** skip when the file is *stale*. During this session `dist/cli.js` dated from three days before the change and contained no `contextBeforeDelta`, so every green run of that suite was exercising pre-change code while appearing to cover the merge path — the one path this whole change exists to fix.

Rebuilding made the suite meaningful, and the new merge test then verified the real behavior. Anyone reading a green `test:unit` as evidence about `shiplight report` must run `pnpm --filter shiplightai build` first; this mirrors the existing repo rule that the unit lanes execute but do not typecheck.

## Knowingly-accepted gaps

- **The cloud reader does not exist yet.** Until the cloud service expands the delta form on its side, a `schemaVersion: 3` artifact shows no variables in the run steps panel. The contract and its conformance vectors are in place and the writer passes them; nothing in this repo can prove the other half. The vectors are the mechanism that will keep the two implementations honest once it lands.
- **The 512 MB limit is not asserted in CI.** Proving it needs a multi-hundred-MB fixture, which does not belong in the unit lane. The property the lane does hold is chunking — a regression to a one-shot `JSON.stringify` fails `reportFiles.test.ts` before it can reach the limit in production.
- **The real-data measurement is not repeatable in CI.** The 264 artifacts are customer data, fetched for this session and deleted afterwards. The behaviors they proved (losslessness, size) are covered synthetically; the numbers are not re-derivable from the repo.
- **The end-to-end shard → merge → cloud path** is proven at each boundary and now across shard → merge (integration, real CLI), but the cloud leg is still unexercised — unchanged from the sibling FR-012 pass.
- **`--open` gating is typechecked, not exercised.** Both call sites now read `shouldOpen && htmlWritten`, but forcing a render failure through the command entry would need `generateHtml` injected into it; the helper's own failure path is unit-covered.

No blocking findings.
