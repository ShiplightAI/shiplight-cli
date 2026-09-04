/**
 * Unit tests for convertUsageToTokenUsage.
 *
 * The load-bearing behaviour is model normalisation: the recorded `model` is the
 * billing/reconciliation identity, so a `provider:` routing prefix must be
 * stripped to the bare upstream id. Without it, tier primaries and cross-provider
 * fallbacks (both `provider:model`) key as different usage rows than the same
 * physical model named bare, and one side fails platform reconciliation.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { convertUsageToTokenUsage } from './tokenUsage';

describe('convertUsageToTokenUsage', () => {
  const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

  it('returns null for absent usage', () => {
    assert.strictEqual(convertUsageToTokenUsage(undefined, 'gemini-3.5-flash'), null);
    assert.strictEqual(convertUsageToTokenUsage(null, 'gemini-3.5-flash'), null);
  });

  it('returns null for a truthy non-object usage (defensive narrow, not a zeroed record)', () => {
    // The `typeof usage !== 'object'` guard: a scalar cannot carry token fields,
    // so it nulls rather than falling through to a zeroed TokenUsage.
    assert.strictEqual(convertUsageToTokenUsage(42, 'gemini-3.5-flash'), null);
    assert.strictEqual(convertUsageToTokenUsage('nope', 'gemini-3.5-flash'), null);
  });

  it('carries token counts through (OpenAI-shaped usage)', () => {
    assert.deepStrictEqual(convertUsageToTokenUsage(usage, 'gpt-5.4'), {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      model: 'gpt-5.4',
    });
  });

  it('reads Gemini-shaped usage (inputTokens/outputTokens)', () => {
    const gemini = { inputTokens: 100, outputTokens: 40, totalTokens: 140 };
    const result = convertUsageToTokenUsage(gemini, 'gemini-3.5-flash');
    assert.strictEqual(result?.prompt_tokens, 100);
    assert.strictEqual(result?.completion_tokens, 40);
    assert.strictEqual(result?.total_tokens, 140);
  });

  it('leaves a bare model id unchanged', () => {
    assert.strictEqual(convertUsageToTokenUsage(usage, 'gemini-3.5-flash')?.model, 'gemini-3.5-flash');
  });

  it('strips a known provider prefix — the tier-primary and fallback case', () => {
    const cases: Array<[string, string]> = [
      ['google:gemini-3.5-flash', 'gemini-3.5-flash'],
      ['anthropic:claude-sonnet-5', 'claude-sonnet-5'],
      ['openai:gpt-5.6-terra', 'gpt-5.6-terra'],
    ];
    for (const [input, expected] of cases) {
      assert.strictEqual(convertUsageToTokenUsage(usage, input)?.model, expected, input);
    }
  });

  it('makes prefixed and bare forms of one model record identically', () => {
    const prefixed = convertUsageToTokenUsage(usage, 'google:gemini-3.5-flash')?.model;
    const bare = convertUsageToTokenUsage(usage, 'gemini-3.5-flash')?.model;
    assert.strictEqual(prefixed, bare);
  });

  it('does not split an unknown prefix (e.g. a fine-tuned id)', () => {
    assert.strictEqual(convertUsageToTokenUsage(usage, 'ft:gpt-4o:my-org')?.model, 'ft:gpt-4o:my-org');
  });
});
