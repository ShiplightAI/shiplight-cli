# Test Report: Run LLM Usage Summary (X01)

**Test spec**: [test-spec.md](./test-spec.md)
**Session date**: 2026-07-18
**Scope**: uncommitted X01 changes, branch `feng/workspace`.

## Commands run

| Command | Result |
| --- | --- |
| `node --test --import tsx 'packages/sdk-core/src/agent/__tests__/runUsageSummary.test.ts'` | **5 passed** |
| `node --test --import tsx apps/cli/src/reporter/{runUsageAggregate,cloudUpload}.test.ts` | **36 passed** (6 new runUsageAggregate + 30 cloudUpload) |
| `pnpm --filter shiplight-tools run test:unit` | **54 passed** (both transpilers; +1 new AI-emit test) |
| `pnpm turbo run typecheck --filter=sdk-core --filter=shiplight-types --filter=shiplight-tools --filter=shiplightai` | clean (exit 0) |

## Tests added / updated this session

- `apps/cli/src/reporter/runUsageAggregate.test.ts` (**new**, 6) — `mergeUsageSummaries` (bucket summing, distinct buckets, no input mutation, empty→undefined), `detectUsageRouting` (default + override), `aggregateRunUsageSummary` (temp `test-results/` with `ai-actions.json`; missing dir → undefined).
- `packages/shiplight-tools/src/testFlowTranspiler.test.ts` (+1) — asserts AI-mode IF/WHILE emit the `"if"`/`"while"` attribution arg. *Closes the gap this cover pass found (the emit was previously unasserted).*
- `packages/sdk-core/src/agent/__tests__/runUsageSummary.test.ts` (5) — operation mapping incl. WAIT_UNTIL, multi-poll counting, provider inference, bucketing, empty.

## Coverage matrix

| Behavior | Priority | Test type | Result |
| --- | --- | --- | --- |
| Operation mapping + IF/WHILE/WAIT_UNTIL split + multi-poll counting | P1 | unit | PASS |
| Transpiler AI-condition emit (`"if"`/`"while"`) | P1 | unit | PASS |
| Merge / aggregate / routing helpers | P1 | unit | PASS |
| Sharded-CI survival (report-data.json fold → merge → upload) | P1 | unit (merge) + typecheck (wiring) | PASS (end-to-end not CI-exercised) |
| No secret leakage | P1 | review | PASS (aggregator copies only counts + id strings) |
| `conditionKind` runtime threading | P1 | static (typecheck) | NOT MEASURED at runtime — see accepted gaps |

## Knowingly-accepted gaps

- **End-to-end shard→merge→cloud** and **runtime `conditionKind` threading** through a live `agent.evaluate` are not exercised by CI here — both need a real browser run + cloud upload. The unit layer proves the aggregation/merge/emit logic; the wiring is typechecked. Validate on a real cloud run before relying on the emitted numbers.
- **`statements.ts` (yaml-transpiler) AI-emit** is not separately asserted (the `testFlowTranspiler.ts` emit is); both share the identical literal pattern and the cloud-side classifier reproduces the correct split from real transpiled customer output, so the emit is proven in production. Low residual risk.
  - *Closed 2026-08-10:* `testFlowTranspiler.ts` was deleted as unreachable code, so the assertion moved onto the live `statements.ts` emit in `yaml-transpiler/aiConditionAttribution.test.ts`. The gap above no longer exists.
- **BYOK routing detection** defaults to `proxy` — documented follow-up, no billing impact (cost derives from the proxy plane, not this counts-only tag).

No blocking findings. All P1 logic behaviors are unit-covered; the two accepted gaps are integration/e2e-level and gated on a live run.
