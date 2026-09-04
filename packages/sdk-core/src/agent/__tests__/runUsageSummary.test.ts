import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { AIActionDetail } from '../../core/types';
import { buildRunUsageSummary, inferProvider } from '../runUsageSummary';

function detail(over: Partial<AIActionDetail> & Pick<AIActionDetail, 'actionType'>): AIActionDetail {
  return {
    stepId: 'main.0',
    count: 1,
    tokenUsages: [],
    ...over,
  } as AIActionDetail;
}

const tu = (prompt: number, completion: number, model: string) => ({
  prompt_tokens: prompt,
  completion_tokens: completion,
  total_tokens: prompt + completion,
  model,
});

describe('inferProvider', () => {
  it('maps model ids to provider families', () => {
    assert.strictEqual(inferProvider('claude-sonnet-5'), 'anthropic');
    assert.strictEqual(inferProvider('gemini-3.1-pro-preview'), 'gemini');
    assert.strictEqual(inferProvider('gpt-5'), 'openai');
    assert.strictEqual(inferProvider('o3-mini'), 'openai');
    assert.strictEqual(inferProvider('mystery-model'), 'unknown');
  });
});

describe('buildRunUsageSummary', () => {
  it('maps actionType to operation and separates IF, WHILE, and WAIT_UNTIL', () => {
    const details: AIActionDetail[] = [
      detail({ actionType: 'execute', tokenUsages: [tu(100, 10, 'claude-sonnet-5')] }),
      detail({ actionType: 'generate', tokenUsages: [tu(200, 20, 'claude-sonnet-5')] }),
      detail({ actionType: 'assert', tokenUsages: [tu(50, 5, 'claude-sonnet-5')] }),
      detail({ actionType: 'evaluate', conditionKind: 'if', tokenUsages: [tu(80, 8, 'claude-sonnet-5')] }),
      detail({ actionType: 'evaluate', conditionKind: 'while', tokenUsages: [tu(90, 9, 'claude-sonnet-5')] }),
      // A WAIT_UNTIL that polled twice before the condition was met -> 2 calls.
      detail({ actionType: 'evaluate', conditionKind: 'wait_until', count: 2, tokenUsages: [tu(40, 4, 'claude-sonnet-5'), tu(45, 5, 'claude-sonnet-5')] }),
      detail({ actionType: 'run', tokenUsages: [tu(70, 7, 'claude-sonnet-5')] }),
    ];

    const { by_operation } = buildRunUsageSummary(details);
    const ops = by_operation.map((b) => b.operation).sort();
    assert.deepStrictEqual(ops, ['action', 'draft', 'evaluate_if', 'evaluate_wait_until', 'evaluate_while', 'verify_ai']);

    // execute + run both fold into `action` (100+70 in, 10+7 out).
    const action = by_operation.find((b) => b.operation === 'action')!;
    assert.strictEqual(action.calls, 2);
    assert.strictEqual(action.input_tokens, 170);
    assert.strictEqual(action.output_tokens, 17);

    const evalIf = by_operation.find((b) => b.operation === 'evaluate_if')!;
    assert.strictEqual(evalIf.input_tokens, 80);
    const evalWhile = by_operation.find((b) => b.operation === 'evaluate_while')!;
    assert.strictEqual(evalWhile.input_tokens, 90);
    // WAIT_UNTIL polls are counted per poll: 2 calls, tokens summed across polls.
    const evalWait = by_operation.find((b) => b.operation === 'evaluate_wait_until')!;
    assert.strictEqual(evalWait.calls, 2);
    assert.strictEqual(evalWait.input_tokens, 85);
    assert.strictEqual(evalWait.output_tokens, 9);
  });

  it('defaults evaluate with no conditionKind to evaluate_if', () => {
    const { by_operation } = buildRunUsageSummary([
      detail({ actionType: 'evaluate', tokenUsages: [tu(10, 1, 'gpt-5')] }),
    ]);
    assert.strictEqual(by_operation[0]?.operation, 'evaluate_if');
    assert.strictEqual(by_operation[0]?.provider, 'openai');
  });

  it('buckets by provider and model, and stamps routing', () => {
    const { by_operation } = buildRunUsageSummary(
      [
        detail({ actionType: 'execute', tokenUsages: [tu(1, 1, 'claude-sonnet-5'), tu(2, 2, 'gpt-5')] }),
      ],
      { routing: 'byok' },
    );
    // Same operation, two models -> two buckets.
    assert.strictEqual(by_operation.length, 2);
    assert.ok(by_operation.every((b) => b.routing === 'byok'));
    assert.ok(by_operation.every((b) => b.operation === 'action'));
  });

  it('returns an empty summary when there are no AI actions (verify_js / cached runs)', () => {
    assert.deepStrictEqual(buildRunUsageSummary([]).by_operation, []);
    assert.deepStrictEqual(buildRunUsageSummary(undefined).by_operation, []);
    // An action detail carrying no token usages contributes nothing.
    assert.deepStrictEqual(buildRunUsageSummary([detail({ actionType: 'execute' })]).by_operation, []);
  });
});
