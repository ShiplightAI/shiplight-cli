/**
 * Temperature request-shaping on the email-extraction LLM path
 * (mailgun.extractContentWithLLM).
 *
 * Companion to the executor / evaluate / generateAction / aiAnalysis temperature
 * coverage. The web agent sends temperature 0 for determinism, but Anthropic's
 * sampling-free models (Opus 4.7/4.8, Sonnet 5, Fable 5) reject a non-default
 * temperature with a non-retryable HTTP 400. extractContentWithLLM issues a
 * single generateText with NO fallback, so an unconditional temperature would
 * hard-fail email content extraction for those models. It must omit temperature
 * for sampling-free Claude and keep the determinism default (0) elsewhere.
 *
 * Drives the REAL extractContentWithLLM with the REAL resolveTemperature wired
 * through the '../../agent/llmProvider' mock; the generateText mock records the
 * temperature it was called with.
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';

// The temperature generateText was called with on the most recent call.
let lastTemperature: number | undefined;
let temperatureKeyPresent = false;

mock.module('ai', {
  namedExports: {
    generateText: async (config: any) => {
      temperatureKeyPresent = config != null && 'temperature' in config;
      lastTemperature = config?.temperature;
      return { text: 'CODE-123', usage: undefined };
    },
  },
});

// Real resolveTemperature so the sampling-free omission is actually exercised;
// identity getModel lets the generateText mock read config.model as the id.
const actualLlm = await import('../../agent/llm');
mock.module('../../agent/llmProvider', {
  namedExports: {
    getModel: (m: string) => m,
    getProviderOptions: () => ({}),
    resolveTemperature: actualLlm.resolveTemperature,
  },
});

const { extractContentWithLLM } = await import('../mailgun');

describe('mailgun.extractContentWithLLM: temperature request-shaping per model', () => {
  beforeEach(() => {
    lastTemperature = undefined;
    temperatureKeyPresent = false;
  });

  it('omits temperature entirely for a sampling-free Claude model (Sonnet 5)', async () => {
    const result = await extractContentWithLLM('email body', 'extract the code', 'anthropic:claude-sonnet-5');

    assert.strictEqual(result, 'CODE-123');
    // No temperature key at all — a non-default value would 400 and hard-fail
    // extraction (no fallback on this path).
    assert.strictEqual(temperatureKeyPresent, false, 'temperature key must be omitted');
    assert.strictEqual(lastTemperature, undefined);
  });

  it('sends the determinism default (0) for a non-Claude model', async () => {
    const result = await extractContentWithLLM('email body', 'extract the code', 'gemini-3.5-flash');

    assert.strictEqual(result, 'CODE-123');
    assert.strictEqual(temperatureKeyPresent, true);
    assert.strictEqual(lastTemperature, 0);
  });

  it('sends the determinism default (0) for a Claude model that still accepts sampling (Haiku 4.5)', async () => {
    await extractContentWithLLM('email body', 'extract the code', 'anthropic:claude-haiku-4-5');

    assert.strictEqual(lastTemperature, 0);
  });
});
