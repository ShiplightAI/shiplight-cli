/**
 * Temperature request-shaping on the ACTION-GENERATION path (generateAction).
 *
 * Companion to executor.temperature.test.ts (runTask loop) and
 * agentCore.evaluate.temperature.test.ts (assert). The web agent sends
 * temperature 0 for determinism, but Anthropic's sampling-free models
 * (Opus 4.7/4.8, Sonnet 5, Fable 5) reject a non-default temperature with a
 * non-retryable HTTP 400 that does NOT trigger model fallback. generateAction
 * previously computed `const temperature = options.temperature ?? 0` ONCE outside
 * the runWithModelFallback chain, so a fallback onto Sonnet 5 still 400'd. The fix
 * resolves temperature PER candidate model and omits the field for sampling-free
 * Claude while keeping the determinism default (0) everywhere else.
 *
 * Drives the REAL generateAction with the REAL resolveTemperature wired through
 * the `../../llm` mock; the generateText mock records the (model, temperature).
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';
import { APICallError, RetryError, jsonSchema } from 'ai';
import { z } from 'zod';

// The (model, temperature) pairs generateText was called with, in order.
let calls: Array<{ model: string; temperature: number | undefined }> = [];
// Per-model injected availability error (fallback tests).
let errorByModel: Record<string, unknown> = {};

function rateLimited429(): APICallError {
  return new APICallError({
    message: 'Resource exhausted',
    url: 'https://proxy/llm',
    requestBodyValues: {},
    statusCode: 429,
    isRetryable: true,
  });
}

// A valid click decision so generateAction returns success and we only assert
// the request shaping.
const CLICK_OUTPUT = {
  thought: 'clicking',
  description: 'Click the Login button',
  action: { click: { element_index: 5 } },
  completes_instruction: true,
};

mock.module('ai', {
  namedExports: {
    generateText: async (config: any) => {
      const model = config?.model;
      calls.push({ model, temperature: config?.temperature });
      if (model != null && model in errorByModel) throw errorByModel[model];
      return { output: CLICK_OUTPUT, usage: undefined, reasoningText: '', finishReason: 'stop', text: '' };
    },
    Output: { object: (cfg: unknown) => cfg },
    NoObjectGeneratedError: class extends Error {
      static isInstance() {
        return false;
      }
    },
    // Real helper: strictSchema.ts builds the submission schema with it, and
    // this mock only stands in for the LLM boundary.
    jsonSchema,
    APICallError,
    RetryError,
  },
});

// buildPageContext is the DOM/browser-heavy step; stub it (element 5 present so
// the element_index -> locator path runs).
mock.module('../../../utils/pageContext', {
  namedExports: {
    buildPageContext: async () => ({
      screenshotBase64: '',
      domState: { selectorMap: new Map<number, unknown>([[5, { tagName: 'button' }]]) },
      pageContext: { elementsText: '' },
    }),
  },
});

// Real resolveTemperature so the sampling-free omission is actually exercised;
// identity getModel lets the generateText mock read config.model as the id.
const actualLlm = await import('../../llm');
mock.module('../../llm', {
  namedExports: {
    getModel: (m: string) => m,
    getProviderOptions: () => ({}),
    resolveTemperature: actualLlm.resolveTemperature,
  },
});

mock.module('../../../llm_tools/utils', {
  namedExports: {
    getActionEntityLocatorInfo: async () => ({ locator: "getByRole('button')", xpath: '//button[1]' }),
  },
});
mock.module('../../../llm_tools/registry', {
  namedExports: {
    toolRegistry: { buildActionUnionSchema: () => z.any() },
  },
});
mock.module('../../../llm_tools/providers/openai', {
  namedExports: {
    OpenAIToolProvider: class {
      getToolDefinitions() {
        return [];
      }
    },
  },
});
mock.module('../actionPrompts', {
  namedExports: {
    getActionGenerationSystemPrompt: () => 'system',
    getActionGenerationUserPrompt: () => 'user',
  },
});
mock.module('../coordinatesBased', {
  namedExports: { generateAction: async () => ({ status: 'error' }) },
});

const { generateAction } = await import('../elementBased');

function createContext(model: string, fallbacks: string[] = []) {
  return {
    statement: 'click login',
    page: {} as any,
    agentServices: {
      getModel: () => model,
      getFallbackModels: () => fallbacks,
      retrieveKnowledges: async () => [],
      isSlicedScreenshotsEnabled: () => false,
      isResizeSlicedScreenshotsEnabled: () => false,
      isKnowledgeImagesEnabled: () => false,
      isAccessibilityTreeEnabled: () => false,
      isActionIntentFilteringEnabled: () => false,
    } as any,
    variables: {},
    executionHistory: [],
    sensitiveKeys: [],
  } as any;
}

describe('generateAction: temperature request-shaping per model', () => {
  beforeEach(() => {
    calls = [];
    errorByModel = {};
  });

  it('omits temperature entirely for a sampling-free Claude model (Sonnet 5)', async () => {
    const result = await generateAction('click login', createContext('anthropic:claude-sonnet-5'));

    assert.strictEqual(result.status, 'success');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]!.model, 'anthropic:claude-sonnet-5');
    // No temperature key at all — the exact request-shaping the fix guarantees.
    assert.strictEqual(calls[0]!.temperature, undefined);
  });

  it('sends the determinism default (0) for Gemini', async () => {
    const result = await generateAction('click login', createContext('google:gemini-3.5-flash'));

    assert.strictEqual(result.status, 'success');
    assert.strictEqual(calls[0]!.temperature, 0);
  });

  it('sends the determinism default (0) for OpenAI', async () => {
    const result = await generateAction('click login', createContext('openai:gpt-5.4-mini'));

    assert.strictEqual(result.status, 'success');
    assert.strictEqual(calls[0]!.temperature, 0);
  });

  it('sends the determinism default (0) for a Claude model that still accepts sampling (Haiku 4.5)', async () => {
    const result = await generateAction('click login', createContext('anthropic:claude-haiku-4-5'));

    assert.strictEqual(result.status, 'success');
    assert.strictEqual(calls[0]!.temperature, 0);
  });

  it('resolves temperature PER candidate: a fallback landing on Sonnet 5 omits temperature while the primary sent 0', async () => {
    // This is the invariant the fix exists for: the deleted loop-invariant
    // `const temperature = options.temperature ?? 0` was hoisted OUTSIDE the
    // fallback loop, so it sent temperature 0 to every candidate — including a
    // sampling-free Sonnet 5 fallback, which 400s mid-chain. Resolving per
    // candidate fixes it. A Gemini primary (temperature 0) is rate-limited, so
    // the chain fails over to Sonnet 5, which must omit temperature.
    errorByModel['google:gemini-3.5-flash'] = rateLimited429();

    const result = await generateAction(
      'click login',
      createContext('google:gemini-3.5-flash', ['anthropic:claude-sonnet-5']),
    );

    assert.strictEqual(result.status, 'success', 'recovers via the Sonnet 5 fallback');
    assert.deepStrictEqual(
      calls.map((c) => c.model),
      ['google:gemini-3.5-flash', 'anthropic:claude-sonnet-5'],
    );
    assert.strictEqual(calls[0]!.temperature, 0, 'Gemini primary keeps the determinism default');
    assert.strictEqual(calls[1]!.temperature, undefined, 'Sonnet 5 fallback omits temperature');
  });
});
