# Test Spec: Run LLM Usage Summary (X01 — runner half of the cloud service spec 047)

**Scope**: change within feature `002-shiplightai-cli` (declared as FR-012 in [../spec.md](../spec.md)) — sdk-core usage aggregator + `conditionKind` plumbing, both transpilers' IF/WHILE/WAIT_UNTIL emit, and the CLI reporter/upload wiring that folds a per-run `RunUsageSummary` into `report-data.json` and onto the run-complete payload. The sdk-core/transpiler halves are internal plumbing consumed only by this reporter path.
**Source material**: the cloud service `specs/047-test-economics-analytics/` (spec + `contracts/run-usage-summary.md`); inferred priority P1 (this is the runner half of that P1 pipeline).
**Testing posture**: no monots `TESTING.md` → baked-in default.
**Test report**: [test-report.md](./test-report.md)

X01 is **deterministic pure logic** (aggregation, merge, provider inference, operation mapping) plus **transpiler code-gen** plus **file/IO wiring** in the CLI reporter. Per the capability map these are proven by **unit** tests. The one genuinely browser/agent-level behavior (the `conditionKind` tag flowing through a real `agent.evaluate` at runtime) needs a live run and is recorded as an accepted gap.

## Testing What

### Implementation / System Invariants
- Each tracked LLM call maps to the correct operation: `execute`/`run`→`action`, `generate`→`draft`, `assert`→`verify_ai`, `evaluate`+conditionKind→`evaluate_if`/`evaluate_while`/`evaluate_wait_until`. — P1
- WAIT_UNTIL is tagged distinctly (its per-poll `evaluate` calls attribute to `evaluate_wait_until`, not `evaluate_if`). — P1
- Both transpilers emit the construct tag (`"if"`/`"while"`) as the 4th arg to `agent.evaluate` for AI conditions. — P1
- Multi-poll WAIT_UNTIL counts one call per poll, tokens summed. — P1
- Merge sums per-shard summaries by `(operation, provider, model, routing)` without mutating inputs. — P1
- Aggregation reads the agent's `ai-actions.json` under a given cwd's `test-results/` and returns `undefined` (a blind spot, never zero) when absent/empty/malformed. — P1

### Risk-Based Behaviors
- **Sharded-CI coverage:** the summary must survive shard→merge→upload. It is folded into `report-data.json` at report time (the only artifact that travels), so a merge job whose cwd never ran tests still carries every shard's usage. — P1 (this was the review blocker)
- **No secret leakage:** the summary carries only operation/provider/model/routing strings + numeric counts — never `userPrompt`/`rawLlmResponse`/`explanation`. — P1
- **Additive/back-compat:** older runs and the current cloud-service receiver (strips unknown keys) are unaffected by the new field. — P1

### Operational Behaviors
- Routing is detected per bucket provider from the Shiplight `.env` stash, mirroring sdk-core's provider selection: a direct API key or Vertex flag → `byok`, an OpenAI key + `OPENAI_BASE_URL` → `custom_endpoint`, otherwise `proxy` (the Shiplight-token path). `SHIPLIGHT_USAGE_ROUTING` remains an explicit whole-run override (counts-only tag; no billing decision rides on it). — P2

## Evidence Strategy

| What | Priority | Viable How | Selected How | Why | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| Operation mapping + IF/WHILE/WAIT_UNTIL split + multi-poll counting | P1 | unit | **unit** (`runUsageSummary.test.ts`) | pure aggregator; cheapest capable | none material |
| Transpiler AI-condition emit (`"if"`/`"while"`) | P1 | unit | **unit** (`yaml-transpiler/aiConditionAttribution.test.ts`) | code-gen assertion on transpiled output | statements.ts (yaml path) shares the literal pattern; covered by the same review + real-data validation |
| Merge / aggregate / routing helpers | P1 | unit | **unit** (`runUsageAggregate.test.ts`) — summing, no-mutation, empty, override, temp-dir | pure + fs; temp dir exercises the real glob/parse | none |
| Sharded-CI survival (fold into report-data.json → merge → upload) | P1 | unit + integration | **unit** (merge summing) + typecheck of the reporter/upload wiring | the data-flow fix is unit-provable at the merge boundary; end-to-end needs a real cloud run | full shard→merge→cloud path not exercised in CI here (accepted) |
| No secret leakage | P1 | static/review | **review** (aggregator copies only counts + id strings) | inspection is the capable proof; there is no PII field path | none |
| `conditionKind` runtime threading (`evaluate`→`trackAIAction`→`waitUntilCondition`) | P1 | integration/e2e | **static (typecheck)** + accepted gap | proving it end-to-end needs a browser + live model call; disproportionate cost | runtime threading unit-untested (accepted) |

Out of scope:
- The cloud-side ingest (`test_run_llm_usage` + `completeRun`), reconciliation, and the customer/admin surfaces — different repo / not built.
- Precise BYOK routing detection — documented follow-up.
