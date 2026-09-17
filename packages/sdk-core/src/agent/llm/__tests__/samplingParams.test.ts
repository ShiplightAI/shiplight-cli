/**
 * Sampling-parameter resolution.
 *
 * Anthropic removed `temperature`/`top_p`/`top_k` on its sampling-free models
 * (Opus 4.7/4.8, Sonnet 5, Fable 5 / Mythos 5): a non-default value returns a
 * non-retryable HTTP 400. Because a 400 does NOT trigger model fallback, an
 * unconditionally-sent temperature deterministically kills those models mid-chain
 * (the production incident this guards). resolveTemperature must therefore omit
 * temperature for exactly those models, while still sending it everywhere it is
 * accepted (Google, OpenAI, and the older Anthropic models).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { anthropicModelSupportsSamplingParams, resolveTemperature } from '../index';

describe('anthropicModelSupportsSamplingParams', () => {
  it('returns false for the sampling-free Anthropic models', () => {
    for (const m of [
      'claude-sonnet-5',
      'claude-sonnet-5-20260101',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-fable-5',
      'claude-mythos-5',
    ]) {
      assert.strictEqual(anthropicModelSupportsSamplingParams(m), false, m);
    }
  });

  it('returns true for the older Anthropic models that still accept sampling', () => {
    for (const m of [
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      'claude-opus-4-1',
      'claude-opus-4-0',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5',
      'claude-haiku-4-5-20251001',
      'claude-haiku-3-5',
      'claude-3-opus-20240229',
    ]) {
      assert.strictEqual(anthropicModelSupportsSamplingParams(m), true, m);
    }
  });
});

describe('resolveTemperature', () => {
  it('omits temperature for the Anthropic fallback that broke production', () => {
    // The exact chain entry from DEFAULT_WEBAGENT_FALLBACK_MODELS.
    assert.strictEqual(resolveTemperature('anthropic:claude-sonnet-5', undefined), undefined);
    // Auto-detected (no provider prefix) resolves the same way.
    assert.strictEqual(resolveTemperature('claude-opus-4-8', 0), undefined);
    assert.strictEqual(resolveTemperature('vertex:claude-sonnet-5', 0), undefined);
    assert.strictEqual(resolveTemperature('bedrock:anthropic.claude-fable-5', 0), undefined);
    // Bedrock cross-region inference ids carry a `<xx>.` prefix.
    assert.strictEqual(resolveTemperature('bedrock:us.anthropic.claude-sonnet-5', 0), undefined);
    assert.strictEqual(resolveTemperature('bedrock:eu.anthropic.claude-opus-4-8', 0), undefined);
    assert.strictEqual(resolveTemperature('openrouter:anthropic/claude-sonnet-5', 0), undefined);
    assert.strictEqual(resolveTemperature('openrouter:anthropic/claude-opus-4.8', 0.7), undefined);
  });

  it('only gates Anthropic Claude models — non-Claude models on any provider keep temperature', () => {
    // The Anthropic sampling predicate must NOT be applied to non-Claude ids:
    // Gemini-on-Vertex and non-Anthropic Bedrock models must keep the default.
    assert.strictEqual(resolveTemperature('vertex:gemini-3.5-flash', undefined), 0);
    assert.strictEqual(resolveTemperature('vertex:gemini-3.1-pro-preview', 0.3), 0.3);
    assert.strictEqual(resolveTemperature('bedrock:meta.llama3-70b', undefined), 0);
    // Bedrock-hosted Anthropic still keeps determinism when it accepts sampling.
    assert.strictEqual(resolveTemperature('bedrock:anthropic.claude-haiku-4-5', undefined), 0);
    assert.strictEqual(resolveTemperature('bedrock:us.anthropic.claude-haiku-4-5', undefined), 0);
  });

  it('sends the determinism default (0) for models that accept sampling', () => {
    assert.strictEqual(resolveTemperature('anthropic:claude-haiku-4-5', undefined), 0);
    assert.strictEqual(resolveTemperature('anthropic:claude-opus-4-6', undefined), 0);
    assert.strictEqual(resolveTemperature('google:gemini-3.5-flash', undefined), 0);
    assert.strictEqual(resolveTemperature('gemini-3.1-pro-preview', undefined), 0);
    assert.strictEqual(resolveTemperature('openai:gpt-5.4-mini', undefined), 0);
    assert.strictEqual(resolveTemperature('gpt-5.4', undefined), 0);
  });

  it('honors an explicitly requested temperature where sampling is accepted', () => {
    assert.strictEqual(resolveTemperature('openrouter:anthropic/claude-sonnet-4.6', 0.5), 0.5);
    assert.strictEqual(resolveTemperature('google:gemini-3.5-flash', 0.7), 0.7);
    assert.strictEqual(resolveTemperature('anthropic:claude-haiku-4-5', 0.5), 0.5);
    // ...but still omits it where the model rejects sampling entirely.
    assert.strictEqual(resolveTemperature('anthropic:claude-sonnet-5', 0.7), undefined);
  });
});
