# Test Spec: Report artifact size (FR-024 / SC-010)

**Scope**: change within feature `002-shiplightai-cli` (declared as FR-024 in [../spec.md](../spec.md)) — the report artifact's per-step variable snapshots: streamed writing of `report-data.json`, a per-value size cap, and the changed-only (delta) encoding carried into the cloud upload. All of it lives in `apps/cli/src/reporter/`.
**Source material**: [../contracts/report-artifact.md](../contracts/report-artifact.md) and its [conformance vectors](../contracts/report-artifact-vectors.json) — the wire contract both this repo and the cloud implement, written to be implementable without reading either side's code; a customer CI failure — `shiplight report --merge` exiting `RangeError: Invalid string length` on a 435-test run — and 264 real per-test artifacts from that org, measured at 217.9 MB of step payload.
**Testing posture**: no monots `TESTING.md` → baked-in default.
**Test report**: [test-report.md](./test-report.md)

This is **deterministic pure logic** (a serializer, a value cap, a diff/patch pair) plus **file/IO wiring** in the reporter and the upload payload builder. Per the capability map both are proven by **unit** tests. The one behavior units cannot reach — whether the cloud renders the new form — is out of scope here, because the reader lives in another repo and is not built yet.

Priority is inherited from the feature: FR-024 governs whether a run's results reach the customer at all, so it carries the same P1 level as the sibling reporting requirements (FR-012, FR-021).

## Testing What

### Product Behaviors

- A merged report is written and uploaded regardless of the run's size — the failure that started this must not be reachable by adding tests to a suite. — P1
- The variables shown against a step remain the values the run observed. They are display-only evidence; making them smaller must not make them wrong. — P1

### Implementation / System Invariants

- `report-data.json` is byte-identical to `JSON.stringify(data, null, 2)` for a report that fits in one string, and is produced without ever building that string. — P1
- A recorded variable value is measured, truncated and reported in **one unit** — a string in its own characters, anything else in the characters of its JSON — so the threshold, the kept prefix and the reported count cannot disagree. The marker is always a string and names the original total, never the amount dropped. — P1
- Capping never makes a value longer: a value is replaced only when the marker is shorter than what it replaces. — P1
- Within one step list, a snapshot records only what changed since the previously recorded state; removals are explicit, never inferred from absence. — P1
- The accumulated state resets per attempt, so a retry's step list is self-contained. — P1
- An empty delta (`{}`) and an absent field mean different things — a snapshot with no change versus no snapshot at all. — P1
- The encode/expand pair is pure: neither mutates the steps it is given, which is what lets a test's `steps` array be shared with its final attempt's. — P1
- The upload payload carries whichever form the reporter recorded, and declares `schemaVersion: 3`. — P1

### Risk-Based Behaviors

- **Reader compatibility.** A consumer resolves the full form, the delta form, and a list mixing them, detected per step with no version negotiation — a merged report can combine shards written before and after this change. A full snapshot is authoritative and resets the accumulated state. — P1
- **Silent data loss.** The wiring is where this fails quietly: the reporter could keep writing full copies, or the upload could drop the new fields and ship steps with no variables at all. Both must be proven on the real path, not only at the unit boundary. — P1

### Operational / Release Behaviors

- Losing `index.html` (rendering failure) must not take the cloud upload with it — the upload runs after it and is the part the customer needs. — P1
- A failed render must not leave a previous run's `index.html` in place, and `--open` must not open one. A stale report that looks current is worse than a missing one: CI uploads it as this run's result. — P1
- A failure part-way through writing `report-data.json` must not destroy the file that was there before. — P1

### Risk-Based Behaviors (continued)

- **Recorded order survives the consumer's own iteration.** The object carrier (`segments[].resultJson`) is consumed by ids drawn from `actionStepsMap`, partitioned by phase and rebuilt as a tree — never in document order. The chain must therefore carry its order as data (`seq`), not rely on how the object is walked. — P1

### Stakeholder Confidence Goals

- A support engineer can state that a customer's sharded CI run will upload its results, and that the variables panel still shows what the test saw.

## Evidence Strategy

| What | Priority | Viable How | Selected How | Why | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| Streamed write is byte-identical to the pretty-printed form, and chunked | P1 | unit | **unit** (`reportFiles.test.ts`) | pure serializer; a regression to one-shot `JSON.stringify` shows up as a single chunk carrying the document | none material |
| Report writing survives a report too large for one string | P1 | unit + manual measurement | **unit** (chunking assertion) + **manual** (1.2 GB written, old path reproduces the `RangeError`) | a 512 MB fixture cannot live in the unit lane | the exact V8 limit is not asserted in CI (accepted) |
| Value cap: threshold unit, marker contents, string vs object, no inflation, no mutation | P1 | unit | **unit** (`contextSnapshot.test.ts`) | pure function; the unit mismatch this pass fixed was invisible to every other layer | none |
| Delta encode/expand: round trip, removals, empty vs absent, purity, idempotence | P1 | unit | **unit** (`contextDelta.test.ts`) | pure diff/patch pair | none |
| Reader handles full, delta, and mixed lists | P1 | unit | **unit** (`contextDelta.test.ts`) | the compatibility promise is a property of `expandStepContexts` | the cloud's own reader is a separate implementation (out of scope) |
| Attempt scope resets the accumulated state | P1 | unit | **unit** (`contextDelta.test.ts`) | encoding is applied per attempt in the reporter | none |
| Reporter actually applies cap + delta on the way to `report-data.json` | P1 | unit + integration | **integration-style unit** (`index.contextEncoding.test.ts`, drives the real `ShiplightReporter` to a temp dir) | the units are worthless if the wiring drops them | none |
| Upload carries the recorded form and declares `schemaVersion: 3` | P1 | unit | **unit** (`cloudUpload.test.ts`) | `buildStepResultJson` / `buildReportV2` are the payload boundary | full shard→merge→cloud path not exercised in CI (accepted) |
| The merge passes the recorded form through unaltered | P1 | integration | **integration** (`commands/report.test.ts`, spawns the built CLI over shard fixtures) | the merge is what crashed, and the only artifact a sharded run uploads | the suite is skipped when `dist/` is unbuilt — see the report's operational note |
| Each uploaded step entry is stamped with its recorded position | P1 | unit | **unit** (`cloudUpload.test.ts`) | `seq` is what makes R2 hold for a reader that iterates its own way | the cloud must sort by it — its half (T060) |
| Writer satisfies the published contract, case by case | P1 | unit | **unit** (`contractVectors.test.ts`, runs `contracts/report-artifact-vectors.json`) | the vectors are the cross-repo interface; a drift between the two implementations must fail a test here, not surface as a rendering bug | the cloud runs the same file only once its reader is built |
| Encoding is lossless on real customer data | P1 | unit + measurement | **manual measurement** (264 real artifacts, 306 step lists, 5,757 steps: 0 round-trip mismatches) | synthetic fixtures cannot represent the real store shape | not repeatable in CI — the artifacts are customer data (accepted) |
| HTML rendering failure does not abort the upload | P1 | unit | **unit** (`reportFiles.test.ts`) | injected renderer that throws | none |
| A failed render removes a stale `index.html`; `--open` is gated on the render | P1 | unit | **unit** (`reportFiles.test.ts`) + static (both `--open` call sites) | the stale-file case is unit-provable; the two `--open` blocks are one condition each | `--open` gating is typechecked, not exercised (it shells out to `open`) |
| A failed write leaves the previous `report-data.json` intact | P1 | unit | **unit** (`reportFiles.test.ts`, circular value mid-serialization) | temp-file + rename is observable from the filesystem | none |
| Recorded order survives a consumer that iterates its own way | P1 | unit | **unit** (`contextDelta.test.ts`, `contractVectors.test.ts` object-carrier case) | `seq` makes order data; the vector shuffles keys and nests an id where no key sort would put it | the cloud must actually sort by it — that is its half (T060) |
| A change between two values that cap to the same marker is still recorded | P1 | unit | **unit** (`contextDelta.test.ts`) | diffing uncapped values is what makes it observable | two identical markers still render identically, by construction |

Out of scope:

- The cloud  reader that expands the delta form for the run steps panel — different repo, not built yet (tasks.md T060). Until it lands, a v3 artifact renders no variables there.
- The engine's own snapshotting (`sdk-core` `webAgent.snapshotVariables`), which is deliberately unchanged: `StepExecutionResult` is a public SDK type and its live values stay complete.
- Whether any *particular* customer run stays under the string limit. The streamed write removes the limit as a failure mode; the cap and delta reduce size but are not a bound.
