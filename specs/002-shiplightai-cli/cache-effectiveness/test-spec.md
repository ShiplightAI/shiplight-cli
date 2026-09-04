# Test Spec: Action-entity cache effectiveness metric + per-test LLM totals

**Scope**: change within feature `002-shiplightai-cli` (working tree on `feng/workspace`) — a
transpile-time `onActionEntitySource` observer in `shiplight-tools`, a run-scoped
collector in the CLI, the reporter/upload wiring that folds a `RunCacheSummary` into
`report-data.json` and onto the run-complete payload, and per-test `llmCalls` /
`llmTokens` columns on each uploaded test result.
**Source material**:
- [Feature spec](../spec.md) — FR-011 (action-entity caching), FR-012 (run LLM usage summary)
- Sibling contracts: [run-usage-summary/test-spec.md](../run-usage-summary/test-spec.md)
  (this change extends its per-run summary with per-test columns),
  [cache-batching/test-spec.md](../cache-batching/test-spec.md) (same cache subsystem)
- Implementation: `packages/shiplight-tools/src/yaml-transpiler/{statements,transpile,pipeline,types,yamlParser}.ts`,
  `apps/cli/src/{transpile,config,fixture}.ts`, `apps/cli/src/cache/{runCacheMetadata,cacheMetadataCollector,actionEntityCacheStore}.ts`,
  `apps/cli/src/reporter/{index,cloudUpload,runUsageAggregate}.ts`, `apps/cli/src/commands/report.ts`,
  `packages/types/src/test-flow/actionEntityCache.ts`
**Testing posture**: repo-root [TESTING.md](../../../TESTING.md) (policy chain step 2 —
this supersedes the "no monots TESTING.md" note in the sibling `run-usage-summary` spec,
which predates the file).
**Test report**: [test-report.md](./test-report.md)

No upstream PRD ranks these behaviors. Priorities below are **inferred** and flagged;
treat them as this session's judgment for the feature owner. The anchor is
TESTING.md's rule that boundary behavior gets direct deterministic proof regardless of
priority, plus its floor "unit coverage on core and changed logic".

The change has two independent halves that ship together:

- **A — cache effectiveness.** The transpiler is the only point that can tell a cached
  action entity from an inline one; by the time the generated spec runs, both are just a
  locator in the emitted code. An observer reports each action's source at transpile
  time, a run-scoped collector accumulates it, the reporter folds in healing from each
  test's `shiplight-new-action-entities` attachment, and the summary rides
  `report-data.json` → run-complete PUT.
- **B — per-test LLM totals.** `llmCalls` / `llmTokens` summed per test from the
  per-step `llmUsage` already in the report, uploaded alongside the existing per-run
  summary so per-test cost survives report-artifact retention deletion.

Both halves are **deterministic pure logic plus file/IO wiring**. Per the capability map
that makes **unit** the capable-and-cheapest modality throughout; there is no browser or
live-provider surface in the changed code, so `e2e` / `agent` / `manual` are outside the
feasible set. The one behavior needing a real sharded cloud run is recorded as an
accepted gap.

## Testing What

### Product Behaviors

- A run with an action-entity cache reports how much of it the cache actually served —
  cached / healed / original counts on the HTML report and the platform's usage view.
- A run with **no** cache configured reports nothing about one, rather than a panel
  reading "N original" for a feature the user never enabled. — inferred P2
- Per-test LLM cost is recorded on each uploaded test result, so it outlives the report
  artifact that object retention eventually deletes. — inferred P1
- A CI run applies the cached action entities it downloaded, instead of resolving every
  step through the slow AI path. — inferred P1

### Implementation / System Invariants

- **The collector is shared across tsup entry bundles.** The writer (`transpile.ts`,
  reached from the `src/index.ts` config bundle) and the reader (`reporter/index.ts`, its
  own `src/reporter.ts` bundle) are compiled with `splitting: false`, so a module-level
  `let` gives each its own instance and the reader's is always empty. State must live on
  `globalThis`, as `dotenvSource.ts` already does. — inferred P1
- **The healed-entities attachment is read at its real nesting.** `fixture.ts` writes an
  `ActionEntityStore` (`{version, entries: {uid: {action_entity, …}}}`); reading the top
  level yields the keys `version`/`entries`, matches no statement, and silently reports
  zero healing. — inferred P1
- **Statement UIDs are deterministic for hook statements too.** Hooks are parsed
  separately via `yamlToTestFlow`, which stamps a fresh `uuidv4()`; without deterministic
  re-keying the store lookup can never match and every hook heal is written back under a
  UUID that never recurs. — inferred P1
- **The transpiler reads the staged cache directory, not the cache backend.**
  `preTestDownload` writes whatever it fetched (cloud or local) into
  `.shiplight/action-cache/`; `CloudActionEntityCache.loadAll()` is `undefined` by design,
  so routing config-time loading through the backend applies nothing in CI. — inferred P1
- **Measurement is all-or-nothing per run.** The summary is emitted only when a cache was
  in play, nothing went unobserved, and something was recorded. A hit rate measured over
  whichever files happened to be stale is worse than no number. — inferred P1
- **Observation is committed only after the spec is written.** The observer fires while
  walking actions; syntax validation and the write happen afterwards, so a file that fails
  to transpile must contribute nothing (its stale spec from a previous transpile is what
  actually runs). — inferred P1
- **Only executable statements are counted.** An AI action inside a `beforeAll`/`afterAll`
  hook is emitted as a comment and never runs. Both arms of an IF and a WHILE body *are*
  counted — the transpiler cannot know which is taken, so this is explicitly a
  transpile-time measure. — inferred P2
- **Run state resets per transpile pass.** Playwright watch/UI mode re-evaluates the
  config in the same process; without a reset run 2 reports run 1's statements and undoes
  run 1's healed marks. — inferred P2
- **Shard merge unions, it does not sum.** Every shard transpiles the whole corpus
  (`--shard` splits execution only), so the transpile-time buckets repeat while healing is
  disjoint. Summing multiplies the corpus by the shard count. — inferred P1
- **Per-test totals are gated on evidence in the report, not on a filesystem glob.** The
  per-run summary is aggregated by scanning output directories; the per-test figures come
  off Playwright attachments. Gating the latter on the former discards real usage whenever
  the scan misses. — inferred P1
- **The per-run total is scoped to this run's output directories.** `outputDir` is
  `test-results/<runId>` with a fresh id per invocation and nothing prunes the parent, so
  scanning the parent reports a multiple of what the run's own tests account for. —
  inferred P1

### Risk-Based Behaviors

- **No fabricated zeros.** Every "not measured" case must omit its field so the platform
  stores NULL, never a 0 it can't distinguish from a real measurement: no cache in play,
  incomplete measurement, no LLM instrumentation, no shard carrying a summary. — inferred P1
- **No inflated hit rate.** Healing must move a statement out of `cache_hits`; heals
  dropped for any reason leave stale entries booked as successful. Heals occurring in a
  test that later fails must still count. — inferred P1
- **No secret leakage.** The cache summary carries only counts; the per-test columns carry
  only counts. Neither touches prompt/response content or locator payloads. — inferred P1
- **Additive/back-compat.** `RunCacheSummary.healed_from_cache` is optional; reports
  written before it exists must still merge, and a receiver that strips unknown keys is
  unaffected. — inferred P2

### Operational / Release Behaviors

- **Cache application is a behavior change in CI.** Fixing the staged-directory read means
  CI runs now genuinely replay from cache where they previously resolved everything fresh.
  Release owners need this called out — it changes CI run time and failure modes, not just
  a reported number. — inferred P1
- **The mtime transpile skip is deliberately defeated when measuring.** Cost is bounded:
  `parseYamlTestFile` already ran unconditionally before the skip, so only codegen and the
  write are given up. — inferred P2

### Stakeholder Confidence Goals

- Platform/analytics owners can trust that a reported hit rate describes the whole run or
  is absent, never a biased subset — and that `healed` counts real staleness.
- Release owners can trust the CI cache path actually applies entities, and that the
  `failed` bucket's structural zero is a known, documented limitation rather than a claim.
- CLI users get per-test cost that survives artifact retention.

## Evidence Strategy

All changed logic is deterministic and reachable from unit tests with temp dirs, mocked
`fetch`/`axios`, and a subprocess invocation of the built CLI. Capability before cost:
there is no browser, provider, or live-service surface in this diff, so the expensive
modalities cannot prove anything here that unit does not.

| What | Priority | Viable How | Selected How | Why | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| Collector shared across tsup bundles | P1 (inferred) | unit | **unit** — second module instance via a query-suffixed dynamic import | Reproduces the two-bundle split in-process; the shipped bundles cannot be loaded together in a test | Proxy for the real tsup split, not the split itself; the built bundles are separately grepped for the stash key |
| Healed-attachment nesting | P1 (inferred) | unit | **unit** — fixture built with the real `createEmptyStore`/`createRunnerStoreEntry` | Producer and consumer cannot drift without the test failing | none |
| Deterministic hook UIDs | P1 (inferred) | unit | **unit** — re-transpile stability + a store keyed on a hook UID hitting | Directly asserts the property the cache depends on | UIDs remain path-dependent (pre-existing; cross-machine cloud keys unchanged by this work) |
| Transpiler reads staged dir, not backend | P1 (inferred) | unit | **unit** — CI + token env, asserting the backend cannot enumerate but the loader can | Encodes the exact precondition that made the CI cache inert | Real cloud download→stage→read round-trip not exercised (accepted) |
| Measurement all-or-nothing (cache-in-play / incomplete / empty gates) | P1 (inferred) | unit | **unit** — collector gates + `transpileAllYamlTests` over temp dirs | Cheapest capable; the gate is pure predicate logic | none |
| Observation committed only after a valid write | P1 (inferred) | unit | **unit** — a file that fails to transpile records nothing | Guards the buffering directly | none |
| Only executable statements counted (noAgent AI skip) | P2 (inferred) | unit | **unit** — suite `beforeAll` with an AI and a non-AI action | Asserts the exclusion and the non-exclusion together | IF/WHILE branch counting intentionally unchanged and documented, not tested as a gap |
| Reset per transpile pass | P2 (inferred) | unit | **unit** — two passes, non-additive totals | Watch mode is otherwise unreachable in CI | Real Playwright watch mode not exercised (accepted) |
| Shard merge unions, does not sum | P1 (inferred) | unit + integration | **unit** (merge arithmetic incl. legacy-field path) + **integration** (built CLI `report --merge` subprocess) | The unit test proves the arithmetic; the subprocess proves the wiring, which is where the field was dropped | Real multi-shard CI run not exercised (accepted) |
| Per-test totals gated on report evidence | P1 (inferred) | unit | **unit** — gate true from steps alone with no run summary | Encodes the custom-`outputDir` failure mode | Payload assembly asserted at the helper, not on a live PUT |
| Per-run total scoped to this run's dirs | P1 (inferred) | unit | **unit** — two runs staged under one parent; scoped vs unscoped compared | Makes the over-count visible rather than arguing it | none |
| No fabricated zeros (omission on every not-measured path) | P1 (inferred) | unit | **unit** — cache gates, LLM gate, merge-with-no-summary | Each omission path asserted at its own seam | none |
| No secret leakage | P1 (inferred) | static/review | **review** — summaries copy counts and id strings only; no field path reaches prompt/response content | Inspection is the capable proof; there is no PII path to exercise | none |
| Additive/back-compat of `healed_from_cache` | P2 (inferred) | unit | **unit** — merge of summaries lacking the field | Cheapest capable | Platform-side receiver lives in another repo (out of scope) |
| `failed` bucket populated | P1 (inferred) | integration/e2e | **none — knowingly accepted gap** | Needs a statement-UID channel from runtime to the reporter that does not exist; `(file, stepId)` is ambiguous inside a suite (stepIds restart per test) | `failed` is structurally 0; a stale entity that cannot self-heal still reads as `cache_hit`. Documented, not silently under-tested |
| CI cache application end-to-end (download → stage → transpile → replay) | P1 (inferred) | integration/agent | **unit at each seam** + accepted gap | A real token, the real proxy endpoint, and a real browser run; disproportionate for this change | Full path unproven in CI here (accepted) |

Out of scope:

- Platform-side ingest of `cacheSummary` / `llmCalls` / `llmTokens` and the customer usage
  surfaces — sibling repo, not built here.
- Server-side cache API behavior (cap enforcement, upsert semantics) — see
  [cache-batching](../cache-batching/test-spec.md); lives in the cloud service.
- Whether cached replay produces *correct* test outcomes — that is the cache's own
  contract (FR-011), not this metric's.
- Cross-machine UID stability (UIDs hash the absolute file path) — pre-existing, not
  introduced here.

## Test Cases

### CACHE-EFF-T01 Cross-bundle collector sharing

- Testing what: the collector is reachable from a second, independently loaded copy of the
  module — the in-process stand-in for the config and reporter tsup bundles.
- Source refs: `apps/cli/src/cache/runCacheMetadata.ts:25-53`, `apps/cli/tsup.config.ts`.
- Preconditions: none.
- Automated checks:
  ```bash
  cd apps/cli && node --test --experimental-test-module-mocks --import tsx \
    src/cache/runCacheMetadata.test.ts
  ```
- Pass criteria: the second instance's `runCacheCollector` is a different function object;
  `hasRunCacheMetadata()` in the first copy is `true` after the second copy records; healing
  folded in through the first copy appears in the second copy's summary.
- Supplementary evidence: `__shiplightRunCacheMetadata__` appears once in each of
  `dist/index.js`, `dist/reporter.js`, `dist/cjs/index.cjs`, `dist/cjs/reporter.cjs`.

### CACHE-EFF-T02 Summary gating — no fabricated measurement

- Testing what: the summary is emitted only when a cache was in play, nothing went
  unobserved, and something was recorded; state resets per pass.
- Source refs: `runCacheMetadata.ts:57-117`, `apps/cli/src/transpile.ts:105-186`.
- Automated checks:
  ```bash
  cd apps/cli && node --test --experimental-test-module-mocks --import tsx \
    src/cache/runCacheMetadata.test.ts src/transpile.test.ts
  ```
- Pass criteria: no cache in play → not reported; a file failing to transpile → not
  reported and its statements not recorded; every file measured once a cache is present
  (the mtime skip does not shrink the denominator); the mtime skip still applies with no
  cache; two passes are non-additive.

### CACHE-EFF-T03 Healed-entity fold-in

- Testing what: the attachment is read at its real nesting and unwrapped to the entity.
- Source refs: `apps/cli/src/reporter/index.ts:222-250`, `apps/cli/src/fixture.ts:912-947`.
- Automated checks:
  ```bash
  cd apps/cli && node --test --experimental-test-module-mocks --import tsx \
    src/reporter/healedEntitiesAttachment.test.ts
  ```
- Pass criteria: statement UIDs come back as keys (never `version`/`entries`); values are
  `ActionEntity`, not the store wrapper; malformed/empty/absent input yields an empty map
  without throwing.

### CACHE-EFF-T04 Transpiler source observation

- Testing what: cache vs inline labelling, hook UID stability and cacheability, exclusion
  of statements emitted as dead comments, no report for statements with no entity.
- Source refs: `packages/shiplight-tools/src/yaml-transpiler/statements.ts:150-208`,
  `transpile.ts:395-466`, `yamlParser.ts:296`.
- Automated checks:
  ```bash
  cd packages/shiplight-tools && node --test --import tsx \
    src/yaml-transpiler/actionEntitySourceObserver.test.ts
  ```
- Pass criteria: only the cached statement is `cache_hit`; a hook action's UID is identical
  across two transpiles and distinct from the main-flow statement's; a store keyed on the
  hook UID produces `cache_hit`; an AI action in `beforeAll` is not reported while the
  non-AI one is; a description-only statement is not reported.

### CACHE-EFF-T05 Staged-store loading in CI

- Testing what: the config-time loader reads `.shiplight/action-cache/` under the exact env
  that selects the cloud backend.
- Source refs: `apps/cli/src/cache/actionEntityCacheStore.ts:208-223`, `apps/cli/src/config.ts:88`.
- Preconditions: `CI=1` and a token in the `.env` stash via `__setShiplightEnvForTest`
  (test literal, not a real credential).
- Automated checks:
  ```bash
  cd apps/cli && node --test --experimental-test-module-mocks --import tsx \
    src/cache/actionEntityCacheStore.test.ts
  ```
- Pass criteria: with `CI=1` + token, `createActionEntityCache(...).isCloud` is `true` and
  its `loadAll()` is `undefined`, while `loadStagedActionEntityStores` returns the staged
  stores; the same call works with no token; nothing staged → `undefined`.

### CACHE-EFF-T06 Shard merge

- Testing what: the merged report carries a cache summary that unions rather than sums, and
  omits it when no shard measured one.
- Source refs: `apps/cli/src/cache/cacheMetadataCollector.ts:153-215`,
  `apps/cli/src/commands/report.ts:139-223`.
- Preconditions: `apps/cli/dist/cli.js` built (the suite skips itself otherwise).
- Automated checks:
  ```bash
  cd apps/cli && pnpm build && node --test --experimental-test-module-mocks --import tsx \
    src/cache/cacheMetadataCollector.test.ts src/commands/report.test.ts
  ```
- Pass criteria: four identical shards → the corpus is not multiplied; disjoint healing
  unions and comes out of the right bucket; buckets still account for every statement
  exactly once; differing totals → sum; a summary lacking `healed_from_cache` merges;
  no shard summary → the field is absent from the merged `report-data.json`.

### CACHE-EFF-T07 Per-test and per-run LLM usage

- Testing what: per-test sums across attempts without double counting, the gate that
  decides NULL vs 0, and run-total scoping to this run's output directories.
- Source refs: `apps/cli/src/reporter/cloudUpload.ts:85-144`,
  `apps/cli/src/reporter/runUsageAggregate.ts:119-165`, `apps/cli/src/reporter/index.ts:282-294, 391`.
- Automated checks:
  ```bash
  cd apps/cli && node --test --experimental-test-module-mocks --import tsx \
    src/reporter/cloudUpload.test.ts src/reporter/runUsageAggregate.test.ts
  ```
- Pass criteria: retried tests count each attempt once; the gate is true from steps alone
  with no run summary, and false only when nothing anywhere recorded usage; a scoped scan
  counts one run's tokens where the unscoped fallback counts several.

## Fixtures And Environments

No product environment is involved — the changed code is CLI-internal and every test runs
against temp directories and mocked transports.

### Local Development

- Accounts / roles: none.
- Data fixtures: `fs.mkdtemp` directories holding `.test.yaml`, generated `.yaml.spec.ts`,
  `.shiplight/action-cache/*.json`, `report-data.json`, and `ai-actions.json`.
- External service fixtures: none — `axios` is mocked; no cache API call is made.
- Environment setup: `pnpm install`; `pnpm --filter shiplightai build` before
  CACHE-EFF-T06 (the `report --merge` suite spawns `dist/cli.js` and self-skips if absent).
- Secret availability: tokens are test literals injected via `__setShiplightEnvForTest`;
  no real credential is read or required.
- Mutation policy: `seeded_fixtures_only` — temp dirs only, removed in `afterEach`.
- Known local limitations: no real cloud endpoint, no browser, no sharded Playwright run.

### Dev / Staging / Production

- Not applicable. This change ships inside the `shiplightai` package; its runtime
  environment is the customer's own CI, and no Shiplight-operated environment is exercised.
  The CI cache-application behavior change (see Operational Behaviors) is observable on the
  first real sharded run after release — see the deferred item in the report.

## Report Expectations

- Report path: [test-report.md](./test-report.md).
- Status vocabulary per `_shared/vocabularies.md`.
- No secrets: tokens appearing in tests are literals (`shp_pat_ci`) injected through the
  test-only env stash setter; none is a real credential and none is printed.
- Record the exact commands, and call out the CI cache-application behavior change plus the
  structurally-zero `failed` bucket as findings rather than burying them.

## Coverage Notes

- Every behavior above maps to a unit test except the four explicitly accepted gaps: the
  `failed` bucket, the end-to-end CI cache round-trip, real Playwright watch mode, and
  IF/WHILE branch counting (a documented semantic, not a defect).
- CACHE-EFF-T06 is the only case with a build prerequisite; its command chain includes
  `pnpm build`.
- The tsup-bundle-split invariant is proven by proxy (a second module instance) plus a
  direct grep of the four built bundles; no test can load two real tsup bundles at once.
