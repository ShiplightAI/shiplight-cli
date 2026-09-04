import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { RunCacheExecutionSummary } from 'shiplight-types';
import type { ReportStep, ReportTest } from './template.js';
import {
  buildTestCacheExecution,
  formatCacheExecutionSummary,
  hasCacheExecutionSignal,
  mergeCacheExecutionSummaries,
} from './cacheExecutionSummary.js';

function step(over: Partial<ReportStep> & Pick<ReportStep, 'stepId'>): ReportStep {
  return {
    description: 'click submit',
    status: 'success',
    ...over,
  };
}

function test(over: Partial<ReportTest> & Pick<ReportTest, 'steps'>): ReportTest {
  return {
    title: 'a test',
    file: 'a.test.yaml',
    status: 'passed',
    duration: 100,
    ...over,
  };
}

describe('buildTestCacheExecution', () => {
  it('counts a cached entity that executed successfully as served', () => {
    const summary = buildTestCacheExecution(
      test({ steps: [step({ stepId: 'main.0', stmtUid: 'u1' }), step({ stepId: 'main.1', stmtUid: 'u2' })] }),
      new Set(['u1']),
    );
    assert.deepStrictEqual(summary, {
      executed: 2,
      cache_served: 1,
      auto_healed: 0,
      auto_heal_failed: 0,
      healed_from_cache: 0,
    });
  });

  it('excludes steps with no statement UID — DRAFTs never reach agent.step()', () => {
    // A DRAFT compiles to agent.execute(), which stamps no stmtUid. It must not be
    // counted as executed, served, or healed: its model call is intentional.
    const summary = buildTestCacheExecution(
      test({ steps: [step({ stepId: 'main.0' }), step({ stepId: 'main.1', autoHealed: true })] }),
      new Set(),
    );
    assert.strictEqual(summary, undefined);
  });

  it('counts a healed step as auto_healed, not cache_served, even when it came from cache', () => {
    const summary = buildTestCacheExecution(
      test({ steps: [step({ stepId: 'main.0', stmtUid: 'u1', autoHealed: true })] }),
      new Set(['u1']),
    );
    assert.strictEqual(summary?.cache_served, 0);
    assert.strictEqual(summary?.auto_healed, 1);
    assert.strictEqual(summary?.healed_from_cache, 1);
  });

  it('counts a heal that came from the YAML entity outside healed_from_cache', () => {
    const summary = buildTestCacheExecution(
      test({ steps: [step({ stepId: 'main.0', stmtUid: 'u1', autoHealed: true })] }),
      new Set(),
    );
    assert.strictEqual(summary?.auto_healed, 1);
    assert.strictEqual(summary?.healed_from_cache, 0);
  });

  it('counts a failed heal separately from a successful one', () => {
    const summary = buildTestCacheExecution(
      test({
        steps: [
          step({ stepId: 'main.0', stmtUid: 'u1', autoHealed: true }),
          step({ stepId: 'main.1', stmtUid: 'u2', healFailed: true, status: 'failure' }),
        ],
      }),
      new Set(['u1', 'u2']),
    );
    assert.strictEqual(summary?.auto_healed, 1);
    assert.strictEqual(summary?.auto_heal_failed, 1);
    // Both spent a model call on a cached entity that went stale.
    assert.strictEqual(summary?.healed_from_cache, 2);
    assert.strictEqual(summary?.cache_served, 0);
  });

  it('prefers healFailed when a step id carries both outcomes', () => {
    // A WHILE body reuses one step id across iterations: it can heal on one pass and
    // fail to heal on a later one. The failure is the outcome the run ended on.
    const summary = buildTestCacheExecution(
      test({ steps: [step({ stepId: 'main.0', stmtUid: 'u1', autoHealed: true, healFailed: true, status: 'failure' })] }),
      new Set(),
    );
    assert.strictEqual(summary?.auto_healed, 0);
    assert.strictEqual(summary?.auto_heal_failed, 1);
    assert.strictEqual(summary?.executed, 1);
  });

  it('does not credit the cache for a failed step that never attempted a heal', () => {
    // canSelfHeal:false actions set neither heal flag. Counting this as served would
    // report a saved model call for a statement that plainly did not work.
    const summary = buildTestCacheExecution(
      test({ steps: [step({ stepId: 'main.0', stmtUid: 'u1', status: 'failure' })] }),
      new Set(['u1']),
    );
    assert.strictEqual(summary?.cache_served, 0);
    assert.strictEqual(summary?.executed, 1);
    // It spent no model call either, so it belongs in no outcome bucket.
    assert.strictEqual(summary?.auto_healed, 0);
    assert.strictEqual(summary?.auto_heal_failed, 0);
  });

  it("does not credit the cache for a step left at 'pending' by a timeout or unhealable throw", () => {
    // The status the runtime ACTUALLY leaves behind on these failures. A
    // canSelfHeal:false action that throws reaches updateStepResult(id, undefined,
    // undefined) and a hung step never updates at all, so the reporter writes
    // 'pending'. A `status !== 'failure'` guard waves both through and credits the
    // cache for the statement that killed the run.
    const summary = buildTestCacheExecution(
      test({ steps: [step({ stepId: 'main.0', stmtUid: 'u1', status: 'pending' })] }),
      new Set(['u1']),
    );
    assert.strictEqual(summary?.cache_served, 0);
    assert.strictEqual(summary?.executed, 1);
  });

  it('does not credit the cache when AI dismissed a modal to rescue the step', () => {
    // dismissModalIfPresent made a model call and the retry then succeeded, so the
    // step is recorded 'success' with no heal flag. Its own model call is invisible
    // to llmUsage because that call deliberately passes no stepId.
    const summary = buildTestCacheExecution(
      test({
        steps: [step({ stepId: 'main.0', stmtUid: 'u1', dismissedModalActions: [{ action_description: 'close banner' }] })],
      }),
      new Set(['u1']),
    );
    assert.strictEqual(summary?.cache_served, 0);
    assert.strictEqual(summary?.auto_healed, 1);
    assert.strictEqual(summary?.healed_from_cache, 1);
  });

  it('does not credit the cache when a JS verify fell back to the model', () => {
    // A `verify` with a `code:` fast path is wrapped in agent.step(), swallows the
    // JS failure and calls agent.assert(). It resolves normally with no heal flag,
    // but the model call is recorded against this step id.
    const summary = buildTestCacheExecution(
      test({
        steps: [
          step({
            stepId: 'main.0',
            stmtUid: 'u1',
            llmUsage: [{ promptTokens: 100, completionTokens: 10, totalTokens: 110 }],
          }),
        ],
      }),
      new Set(['u1']),
    );
    assert.strictEqual(summary?.cache_served, 0);
    assert.strictEqual(summary?.auto_healed, 1);
  });

  it('buckets an AI-rescued step that still failed as a failed heal', () => {
    const summary = buildTestCacheExecution(
      test({
        steps: [
          step({
            stepId: 'main.0',
            stmtUid: 'u1',
            status: 'failure',
            llmUsage: [{ promptTokens: 100, completionTokens: 10, totalTokens: 110 }],
          }),
        ],
      }),
      new Set(['u1']),
    );
    assert.strictEqual(summary?.auto_heal_failed, 1);
    assert.strictEqual(summary?.auto_healed, 0);
  });

  it('treats a warning step as served — a soft outcome is not a failure', () => {
    const summary = buildTestCacheExecution(
      test({ steps: [step({ stepId: 'main.0', stmtUid: 'u1', status: 'warning' })] }),
      new Set(['u1']),
    );
    assert.strictEqual(summary?.cache_served, 1);
  });

  it('counts every attempt of a retried test, and does not double-count the last one', () => {
    // `steps` IS the final attempt's list and `attempts` already contains it, so
    // reading both would count the final try twice.
    const retried = test({
      steps: [step({ stepId: 'main.0', stmtUid: 'u1' })],
      attempts: [
        {
          attemptNumber: 1,
          status: 'failed',
          duration: 10,
          steps: [step({ stepId: 'main.0', stmtUid: 'u1', autoHealed: true })],
        },
        {
          attemptNumber: 2,
          status: 'passed',
          duration: 10,
          steps: [step({ stepId: 'main.0', stmtUid: 'u1' })],
        },
      ],
    });
    const summary = buildTestCacheExecution(retried, new Set(['u1']));
    assert.strictEqual(summary?.executed, 2);
    assert.strictEqual(summary?.auto_healed, 1);
    assert.strictEqual(summary?.cache_served, 1);
  });
});

describe('mergeCacheExecutionSummaries', () => {
  const s = (over: Partial<RunCacheExecutionSummary> = {}): RunCacheExecutionSummary => ({
    executed: 10,
    cache_served: 6,
    auto_healed: 2,
    auto_heal_failed: 1,
    healed_from_cache: 2,
    ...over,
  });

  it('sums shards — execution is disjoint, unlike transpile-time counts', () => {
    const merged = mergeCacheExecutionSummaries([s(), s({ executed: 5, cache_served: 3 })]);
    assert.deepStrictEqual(merged, {
      executed: 15,
      cache_served: 9,
      auto_healed: 4,
      auto_heal_failed: 2,
      healed_from_cache: 4,
    });
  });

  it('ignores shards that carried no summary', () => {
    const merged = mergeCacheExecutionSummaries([undefined, s(), undefined]);
    assert.deepStrictEqual(merged, s());
  });

  it('returns undefined when nothing was counted, so "not measured" stays distinct from zero', () => {
    assert.strictEqual(mergeCacheExecutionSummaries([]), undefined);
    assert.strictEqual(mergeCacheExecutionSummaries([undefined, undefined]), undefined);
  });
});

describe('formatCacheExecutionSummary', () => {
  it('reports served and healed counts, with failures called out', () => {
    const line = formatCacheExecutionSummary({
      executed: 10,
      cache_served: 6,
      auto_healed: 2,
      auto_heal_failed: 1,
      healed_from_cache: 2,
    });
    assert.strictEqual(line, '6 served from cache, 3 auto-healed (1 failed) of 10 executed statements');
  });

  it('omits the failure clause when every heal succeeded', () => {
    const line = formatCacheExecutionSummary({
      executed: 1,
      cache_served: 0,
      auto_healed: 1,
      auto_heal_failed: 0,
      healed_from_cache: 0,
    });
    assert.strictEqual(line, '1 auto-healed of 1 executed statement');
  });

  it('says nothing when there is nothing to report', () => {
    assert.strictEqual(formatCacheExecutionSummary(undefined), '');
    assert.strictEqual(
      formatCacheExecutionSummary({
        executed: 3,
        cache_served: 0,
        auto_healed: 0,
        auto_heal_failed: 0,
        healed_from_cache: 0,
      }),
      '',
    );
  });
});

describe('hasCacheExecutionSignal', () => {
  it('is false for a run that executed statements but neither served nor healed any', () => {
    // The common shape for a project that never enabled the cache. Reporting
    // `executed` alone would put a permanent "Action Entity Cache" panel on every
    // report for a feature the user does not use.
    assert.strictEqual(
      hasCacheExecutionSignal({
        executed: 37,
        cache_served: 0,
        auto_healed: 0,
        auto_heal_failed: 0,
        healed_from_cache: 0,
      }),
      false,
    );
  });

  it('is true as soon as anything cache-relevant happened', () => {
    const base = { executed: 5, cache_served: 0, auto_healed: 0, auto_heal_failed: 0, healed_from_cache: 0 };
    assert.strictEqual(hasCacheExecutionSignal({ ...base, cache_served: 1 }), true);
    assert.strictEqual(hasCacheExecutionSignal({ ...base, auto_healed: 1 }), true);
    assert.strictEqual(hasCacheExecutionSignal({ ...base, auto_heal_failed: 1 }), true);
  });

  it('is false for a missing summary', () => {
    assert.strictEqual(hasCacheExecutionSignal(undefined), false);
  });

  it('agrees with formatCacheExecutionSummary, so HTML and console cannot diverge', () => {
    const cases: RunCacheExecutionSummary[] = [
      { executed: 0, cache_served: 0, auto_healed: 0, auto_heal_failed: 0, healed_from_cache: 0 },
      { executed: 9, cache_served: 0, auto_healed: 0, auto_heal_failed: 0, healed_from_cache: 0 },
      { executed: 9, cache_served: 2, auto_healed: 0, auto_heal_failed: 0, healed_from_cache: 0 },
      { executed: 9, cache_served: 0, auto_healed: 0, auto_heal_failed: 3, healed_from_cache: 1 },
    ];
    for (const c of cases) {
      assert.strictEqual(
        hasCacheExecutionSignal(c),
        formatCacheExecutionSummary(c) !== '',
        JSON.stringify(c),
      );
    }
  });
});
