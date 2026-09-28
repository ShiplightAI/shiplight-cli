/**
 * Gemini thinking-control selection.
 *
 * Gemini 2.x only accepts a token budget (`thinkingBudget`); Gemini 3 and later
 * take a level (`thinkingLevel`) and Vertex rejects the other field with a
 * non-retryable HTTP 400. Because a 400 does NOT trigger model fallback, the
 * wrong field fails the call outright. The production incident this guards:
 * every Gemini model except `gemini-3-flash-preview` was sent
 * `thinkingBudget: 512`, and from 2026-09-24 Vertex answered roughly half of the
 * `gemini-3.5-flash` (standard tier primary) calls with
 * "Thinking budget is not supported for this model.", which surfaced to
 * customers as failed assertions.
 *
 * The level itself is model-specific too: `minimal` is rejected by
 * `gemini-3.8-flash` and `gemini-3.1-pro-preview`, so it must not be applied
 * to the whole Gemini 3 family.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';
import { getGoogleProviderOptions, type GoogleProviderOptionsResult } from '../google';
import { getProviderOptions } from '../index';

/** The options object, whichever key (`google` / `vertex`) it is under. */
function optionsOf(result: GoogleProviderOptionsResult): GoogleGenerativeAIProviderOptions {
  const options = result.google ?? result.vertex;
  assert.ok(options, 'expected google or vertex provider options');
  return options;
}

describe('getGoogleProviderOptions thinking control', () => {
  it('sends a thinking level, never a budget, to Gemini 3 and later models', () => {
    for (const model of [
      'gemini-3.5-flash',
      'gemini-3.8-flash',
      'gemini-3.1-pro-preview',
      'gemini-4-flash',
    ]) {
      const { thinkingConfig } = optionsOf(getGoogleProviderOptions(1, model));
      assert.deepStrictEqual(
        thinkingConfig,
        { thinkingLevel: 'low', includeThoughts: true },
        model,
      );
    }
  });

  it('keeps the minimal level for gemini-3-flash-preview', () => {
    const { thinkingConfig } = optionsOf(getGoogleProviderOptions(1, 'gemini-3-flash-preview'));
    assert.deepStrictEqual(thinkingConfig, { thinkingLevel: 'minimal', includeThoughts: true });
  });

  it('keeps the token budget for Gemini 2.x models', () => {
    for (const model of ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
      const { thinkingConfig } = optionsOf(getGoogleProviderOptions(1, model));
      assert.deepStrictEqual(thinkingConfig, { thinkingBudget: 512, includeThoughts: true }, model);
    }
  });

  it('keeps the token budget for non-Gemini ids on the Google path', () => {
    const { thinkingConfig } = optionsOf(getGoogleProviderOptions(1, 'gemma-3-27b-it'));
    assert.deepStrictEqual(thinkingConfig, { thinkingBudget: 512, includeThoughts: true });
  });

  it('applies the same rule on the getProviderOptions path the agent uses', () => {
    const { thinkingConfig } = optionsOf(
      getProviderOptions('google:gemini-3.5-flash', 1) as GoogleProviderOptionsResult,
    );
    assert.deepStrictEqual(thinkingConfig, { thinkingLevel: 'low', includeThoughts: true });
  });
});

describe('getGoogleProviderOptions media resolution', () => {
  it('uses HIGH for gemini-3-flash-preview at any image count', () => {
    for (const imageCount of [0, 1, 3]) {
      const options = optionsOf(getGoogleProviderOptions(imageCount, 'gemini-3-flash-preview'));
      assert.strictEqual(options.mediaResolution, 'MEDIA_RESOLUTION_HIGH', `images=${imageCount}`);
    }
  });

  it('uses HIGH for other models only when the request has exactly one image', () => {
    for (const model of ['gemini-3.5-flash', 'gemini-2.5-pro']) {
      assert.strictEqual(
        optionsOf(getGoogleProviderOptions(1, model)).mediaResolution,
        'MEDIA_RESOLUTION_HIGH',
        model,
      );
      for (const imageCount of [0, 3]) {
        assert.strictEqual(
          optionsOf(getGoogleProviderOptions(imageCount, model)).mediaResolution,
          undefined,
          `${model} images=${imageCount}`,
        );
      }
    }
  });
});
