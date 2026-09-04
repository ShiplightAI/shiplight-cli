/**
 * Temperature request-shaping on the ASSERTION path (agentCore.evaluate).
 *
 * Companion to executor.temperature.test.ts (runTask loop) and the action-gen
 * coverage. The web agent sends temperature 0 for determinism, but Anthropic's
 * sampling-free models (Opus 4.7/4.8, Sonnet 5, Fable 5) reject a non-default
 * temperature with a non-retryable HTTP 400 — which does NOT trigger model
 * fallback, so an unconditional temperature silently kills those models
 * mid-chain. evaluate() must resolve temperature PER candidate model (it lives
 * inside runWithModelFallback) and omit the field for sampling-free Claude while
 * keeping the determinism default (0) everywhere else.
 *
 * Drives the REAL evaluate() with the REAL resolveTemperature wired through the
 * `../../llm` mock; the generateText mock records the (model, temperature) pair.
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';
import { APICallError, RetryError, jsonSchema } from 'ai';

import { validateStrictMode } from '../../../llm_tools/schema';

// The (model, temperature) pairs generateText was called with, in order.
let calls: Array<{ model: string; temperature: number | undefined; output?: any }> = [];
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

mock.module('ai', {
  namedExports: {
    generateText: async (config: any) => {
      const model = config?.model;
      calls.push({ model, temperature: config?.temperature, output: config?.output });
      if (model != null && model in errorByModel) throw errorByModel[model];
      return {
        output: { conclusion: 'true', explanation: 'because', screenshotDescription: 'desc' },
        usage: undefined,
      };
    },
    Output: { object: (cfg: unknown) => cfg },
    // The real helper — agentCore builds its submission schema with it.
    jsonSchema,
    APICallError,
    RetryError,
  },
});

// DOM/browser-heavy step — stub it so no browser is needed.
mock.module('../../../utils/pageContext', {
  namedExports: {
    buildPageContext: async () => ({
      domTree: '',
      screenshotBase64: '',
      slicedScreenshotsBase64: [],
      domState: {},
      pageContext: { currentTabText: '', tabsText: '' },
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

mock.module('../../../services/knowledgeService', {
  namedExports: {
    createKnowledgeParts: () => [],
    countKnowledgeImages: () => 0,
  },
});

// agentCore imports both action generators at module top for its dispatcher
// (unused by evaluate). Stub them so their heavy transitive graphs don't load.
mock.module('../../action-generation/coordinatesBased', {
  namedExports: { generateAction: async () => ({ status: 'error' }) },
});
mock.module('../../action-generation/elementBased', {
  namedExports: { generateAction: async () => ({ status: 'error' }) },
});

const { evaluate } = await import('../agentCore');

function createContext(model: string, fallbacks: string[] = []) {
  return {
    page: {} as any,
    executionHistory: [],
    variables: {},
    sensitiveKeys: new Set<string>(),
    agentServices: {
      getModel: () => model,
      getFallbackModels: () => fallbacks,
      isSlicedScreenshotsEnabled: () => false,
      isResizeSlicedScreenshotsEnabled: () => false,
      isKnowledgeImagesEnabled: () => false,
      isAccessibilityTreeEnabled: () => false,
      retrieveKnowledges: async () => [],
    },
  } as any;
}

describe('agentCore.evaluate: temperature request-shaping per model', () => {
  beforeEach(() => {
    calls = [];
    errorByModel = {};
  });

  it('omits temperature entirely for a sampling-free Claude model (Sonnet 5)', async () => {
    const result = await evaluate('the dashboard is visible', createContext('anthropic:claude-sonnet-5'));

    assert.strictEqual(result.success, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]!.model, 'anthropic:claude-sonnet-5');
    // No temperature key at all — the exact request-shaping the fix guarantees.
    assert.strictEqual(calls[0]!.temperature, undefined);
  });

  it('sends the determinism default (0) for Gemini', async () => {
    const result = await evaluate('the dashboard is visible', createContext('google:gemini-3.5-flash'));

    assert.strictEqual(result.success, true);
    assert.strictEqual(calls[0]!.temperature, 0);
  });

  it('sends the determinism default (0) for OpenAI', async () => {
    const result = await evaluate('the dashboard is visible', createContext('openai:gpt-5.4-mini'));

    assert.strictEqual(result.success, true);
    assert.strictEqual(calls[0]!.temperature, 0);
  });

  it('sends the determinism default (0) for a Claude model that still accepts sampling (Haiku 4.5)', async () => {
    const result = await evaluate('the dashboard is visible', createContext('anthropic:claude-haiku-4-5'));

    assert.strictEqual(result.success, true);
    assert.strictEqual(calls[0]!.temperature, 0);
  });

  it('resolves temperature PER candidate: a fallback landing on Sonnet 5 omits temperature while the primary sent 0', async () => {
    // This is the invariant the fix exists for: resolveTemperature runs INSIDE
    // the fallback loop. Hoisting it outside (resolving once for the primary)
    // would pass every single-candidate case above yet re-send temperature 0 to
    // the Sonnet 5 fallback and 400 mid-chain. A Gemini primary (temperature 0)
    // is rate-limited, so the chain fails over to the sampling-free Sonnet 5.
    errorByModel['google:gemini-3.5-flash'] = rateLimited429();

    const result = await evaluate(
      'the dashboard is visible',
      createContext('google:gemini-3.5-flash', ['anthropic:claude-sonnet-5']),
    );

    assert.strictEqual(result.success, true, 'assertion resolves via the Sonnet 5 fallback');
    assert.deepStrictEqual(
      calls.map((c) => c.model),
      ['google:gemini-3.5-flash', 'anthropic:claude-sonnet-5'],
    );
    assert.strictEqual(calls[0]!.temperature, 0, 'Gemini primary keeps the determinism default');
    assert.strictEqual(calls[1]!.temperature, undefined, 'Sonnet 5 fallback omits temperature');
  });

  it('submits a strict-valid schema, not the raw Zod one', async () => {
    // agentCore's assertion schema has no optional fields today, so the transform
    // is a no-op on its content — but the call site still has to apply it, or a
    // later optional field silently reinstates the AI_APICallError that killed
    // the AI fallback. Asserting the submitted object is a JSON-Schema
    // submission view is what makes dropping the call fail here.
    await evaluate('the dashboard is visible', createContext('openai:gpt-5.4-mini'));

    const submitted = calls[0]?.output?.schema;
    assert.ok(
      submitted && typeof submitted === 'object' && 'jsonSchema' in submitted,
      'evaluate() passed a raw Zod schema to Output.object — toStrictOutputSchema was dropped',
    );
    assert.deepStrictEqual(validateStrictMode(submitted.jsonSchema), []);
  });
});
