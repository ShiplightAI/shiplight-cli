# Test Spec: Action-entity cache request batching + pre-test download scoping

**Scope**: PR / change within feature `002-shiplightai-cli` (working tree on `feng/workspace`)
**Source material**: `apps/cli/src/cache/actionEntityCacheClient.ts`, `apps/cli/src/commands/test.ts`, `apps/cli/src/transpile.ts` (implementation); server cap verified in the cloud service's `action-entity-cache/{lookup,update}.ts`. No upstream PRD ranks these behaviors — priorities below are **inferred** and flagged.
**Testing posture**: baked-in default (`cover/default-testing-strategy.md`); no repo-root `TESTING.md`.
**Test report**: [test-report.md](./test-report.md)

This file is the durable testing contract for one focused change: two independent
pieces of CLI cache logic.

- **A — request batching.** The v2 cloud API caps each `lookup`/`update` request at
  100 test paths (`z.array(z.string()).max(100)` / `stores` refined `<= 100`).
  Before the change, a repo with >100 `.test.yaml` files sent one over-cap request,
  the server returned HTTP 400, and the **whole** lookup/update was discarded → cold
  cache (every step runs the slow AI path) or nothing persisted. The client now
  splits into ≤100-path batches and unions/sums the results, each batch degrading
  independently.
- **B — download scoping.** `preTestDownload` previously globbed the whole repo and
  looked up cache for every test, even for `shiplight test A`. The transpiler only
  ever consumes the requested file's store, so the rest was fetched over the network,
  written to disk, and never read. The pre-test download is now scoped to the same
  files the spawned transpiler will request (`getRequestedYamlFiles(projectRoot,
  rewrittenArgs)`), with `null` → whole-repo fallback matching the transpiler.

## Testing What

### Product Behaviors

- `shiplight test` on a repo with >100 YAML tests warms the cache it can, instead of
  getting a fully cold cache from a single rejected request.
- A run that self-heals >100 test files persists all of them back to the cache.
- `shiplight test <file>` downloads cache for only that file (fast start), not the
  whole repo.

### Implementation / System Invariants

- **Batch size never exceeds the server cap (100).** Every emitted request carries
  ≤100 paths/stores.
- **Union/sum is complete and order-independent.** Lookup merges every batch's stores
  into one map; update sums every batch's `updated` count.
- **Independent degradation.** A failed batch (HTTP non-2xx, network error, timeout)
  contributes no entries / zero to the count but never discards the batches that
  succeeded. *(This is the core resilience claim of change A — the bug it fixes.)*
- **Scope parity with the transpiler.** `preTestDownload`'s download scope equals what
  the spawned transpiler requests: both call `getRequestedYamlFiles` with the same
  `projectRoot` and the same `rewrittenArgs`. Divergence would re-introduce a cold
  cache (needed file not downloaded) or waste (extra downloaded).
- **`null` sentinel = whole repo.** No specific file requested (bare run / `--grep`)
  falls back to the full glob, matching the transpiler's own fallback. `getRequestedYamlFiles`
  returns `null` (never `[]`), so the nullish-coalescing fallback is well-defined.
- **Backward-compatible signatures.** `getRequestedYamlFiles(cwd, args = process.argv.slice(2))`
  keeps its single-arg callers working; `preTestDownload` gains a required scope param
  forcing the one production caller to decide scope explicitly.

### Risk-Based Behaviors

- **No silent under-warming / under-persisting.** A partial-batch failure must not
  cascade to a total loss (the pre-change failure mode). Regression coverage required.
- **No path leakage widening.** Scoping *reduces* which test paths are sent to the
  cloud and written to disk; it must not accidentally widen scope for the single-file
  case.

### Operational / Release Behaviors

- **Graceful degradation preserved.** Cache is best-effort: any batch failure logs a
  warning and yields empty/0 for that batch; a slow or down cache never fails the test
  run, only the cache warm/flush.
- **Sequential batch latency** (accepted): batches await in sequence, so per-batch
  timeouts (2s lookup / 5s update) stack on a stalled network. Acceptable on a
  once-per-invocation warm/flush path; noted as residual risk, not covered by a test.

### Stakeholder Confidence Goals

- CLI users on large repos (>100 tests) get cache benefit in CI instead of a silent
  cold cache; single-test runs start fast. Release owners can trust the change
  degrades safely and changes no trust boundary (token handling / URL construction
  unchanged — relocated verbatim into per-batch helpers).

## Evidence Strategy

All behaviors are deterministic pure logic reachable from unit tests with a mocked
`fetch` and a temp-dir filesystem. No browser, server, or live-environment surface →
**e2e / agent / manual are not in the feasible set** (capability before cost). Unit is
both cheapest and sufficient; the floor ("maximize unit coverage on changed logic")
applies. Priorities are **inferred** (no upstream PRD ranks them) — treat P-levels as
this session's judgment, flagged for the feature owner.

| What | Priority | Viable How | Selected How | Why | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| Lookup: split >100 into ≤100 batches + union merge | P1 (inferred) | unit | unit | Core of change A; mocked `fetch` records batch sizes and echoes stores | — |
| Lookup: independent degradation (failed batch keeps survivors) | P1 (inferred) | unit | unit | The bug fix; must prove survivors retained | — |
| Lookup: single request at/below cap | P2 (inferred) | unit | unit | No needless splitting | — |
| Update: split >100 + summed counts | P1 (inferred) | unit | unit | Core of change A (persist path) | — |
| Update: independent degradation | P1 (inferred) | unit | unit | Failed upload batch must not sink succeeded ones | — |
| Update: single request at/below cap | P2 (inferred) | unit | unit | `new Map(batch)` path distinct from lookup | — |
| Batch boundary: 100→[100], 101→[100,1], 150→[100,50] | P2 (inferred) | unit | unit | Off-by-one guard on the chunk loop | — |
| Scoping: `test <file>` fetches only that file's cache | P1 (inferred) | unit | unit | Perf + correctness fix (change B) | — |
| Scoping: several files → exactly those, exclude untargeted | P2 (inferred) | unit | unit | Guards a "forwarded only the first" bug | — |
| Scoping: `null` → whole-repo fallback | P1 (inferred) | unit | unit | Must match transpiler fallback | — |
| `getRequestedYamlFiles` explicit `argv` override + `.yaml.spec.ts`→`.test.yaml` | P2 (inferred) | unit | unit | Mechanism that makes scope match the transpiler | — |
| Scope-parity invariant (preTestDownload scope == transpiler request) | P1 (inferred) | unit (indirect) + static | unit (indirect) | Verified indirectly: both call the same function with the same inputs; no single test asserts identity across the process boundary | Cross-process identity is argued, not directly asserted — see Residual Risk |
| Sequential-batch timeout latency | P3 (inferred) | unit (timer mock) / manual | none | Accepted design trade-off on a once-per-run path | Not covered by a test; documented |

Out of scope:

- Server-side cap enforcement and the 400 response (lives in the cloud service, a
  separate repo).
- Windows path-separator normalization between `globSync` (forward slashes) and
  `getRequestedYamlFiles` (`resolve`-derived) — pre-existing, not introduced here;
  CLI runs on macOS/Linux CI.
- End-to-end cloud round-trip (real token, the real proxy endpoint) — an integration/agent
  concern, not this unit-scoped change.

## Test Cases

### CACHE-BATCH-T01 Lookup batching, union, and boundaries

- Testing what: split at cap, union merge, single-request-at-cap, 101 boundary.
- Source refs: `apps/cli/src/cache/actionEntityCacheClient.ts:48-103`.
- Preconditions: `SHIPLIGHT_API_TOKEN` set via `__setShiplightEnvForTest`; `fetch` mocked.
- Automated checks:
  ```bash
  cd apps/cli && node --test --experimental-test-module-mocks --import tsx \
    src/cache/actionEntityCacheClient.test.ts
  ```
- Pass criteria: 150 paths → `batchSizes === [100, 50]`, `result.size === 150`;
  100 paths → single request; 101 paths → `[100, 1]`, `result.size === 101`.

### CACHE-BATCH-T02 Lookup independent degradation

- Testing what: a failed batch keeps the succeeding batch's stores.
- Source refs: `actionEntityCacheClient.ts:54-63, 66-103`.
- Pass criteria: 150 paths, first batch returns HTTP 500 → `result.size === 50`,
  failed-batch paths absent, succeeded-batch paths present.

### CACHE-BATCH-T03 Update batching, summed counts, boundary, degradation

- Testing what: split + summed `updated`, single-request-at-cap, partial-fail sum.
- Source refs: `actionEntityCacheClient.ts:110-163`.
- Pass criteria: 150 stores → `[100, 50]`, `updated === 150`; 100 stores → single
  request, `updated === 100`; first batch 500 → `updated === 50`.

### CACHE-BATCH-T04 Pre-test download scoping

- Testing what: single-file scope, multi-file scope, `null` whole-repo fallback.
- Source refs: `apps/cli/src/commands/test.ts:319-354`.
- Automated checks:
  ```bash
  cd apps/cli && node --test --experimental-test-module-mocks --import tsx \
    src/commands/test.test.ts
  ```
- Pass criteria: `['a.test.yaml']` → lookups `[['a.test.yaml']]`;
  `['a.test.yaml','c.test.yaml']` → exactly those two (b excluded);
  `null` → all three repo files.

### CACHE-BATCH-T05 getRequestedYamlFiles explicit argv

- Testing what: explicit `argv` beats `process.argv`; `.yaml.spec.ts`→`.test.yaml`.
- Source refs: `apps/cli/src/transpile.ts:56-77`.
- Automated checks:
  ```bash
  cd apps/cli && node --test --experimental-test-module-mocks --import tsx \
    src/transpile.test.ts
  ```
- Pass criteria: `getRequestedYamlFiles(tmpDir, ['--project=web','b.yaml.spec.ts','--headed'])`
  returns `['b.test.yaml']`.

## Report Expectations

- Report path: [test-report.md](./test-report.md).
- Status vocabulary per `_shared/vocabularies.md`.
- No secrets (the Bearer token is a test literal via `__setShiplightEnvForTest`).

## Coverage Notes

- Every behavior above maps to a unit test; commands are in the test cases.
- The one behavior without a direct assertion is the cross-process **scope-parity
  invariant** — covered indirectly (same function, same inputs on both sides) and
  logged as residual risk in the report.
