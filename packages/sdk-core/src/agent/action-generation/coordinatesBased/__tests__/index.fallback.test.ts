/**
 * Computer-use (coordinatesBased / vision) model fallback. Mirrors the web-agent
 * action-gen/assert fix for the CUA path: a primary computer-use model that fails
 * with an availability error (429) should fail over to the next configured
 * COMPUTER_USE fallback model instead of failing the whole action.
 *
 * Drives the REAL coordinatesBased generateAction with the CUA providers mocked
 * (model-aware via ctx.modelId), so no live vision API is needed.
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';
import { APICallError, RetryError } from 'ai';

const PRIMARY = 'gemini-cua-primary';
const FALLBACK = 'gemini-cua-fallback';

// Resolved model ids the CUA providers were invoked with, in call order.
let calledModels: string[] = [];
// Per-model injected error (keyed by modelId) for the fallback tests.
let errorByModel: Record<string, unknown> = {};

function rateLimited429(): APICallError {
  return new APICallError({
    message: 'Resource exhausted',
    url: 'https://cua/llm',
    requestBodyValues: {},
    statusCode: 429,
    isRetryable: true,
  });
}

// Model-aware CUA provider stub: records ctx.modelId, throws the injected error
// for that model, else returns a success action tagged with the model.
function makeProvider(tag: string) {
  return async (ctx: any) => {
    calledModels.push(ctx.modelId);
    if (ctx.modelId in errorByModel) throw errorByModel[ctx.modelId];
    return {
      status: 'success',
      actionEntity: {
        action_description: `${tag}:${ctx.modelId}`,
        action_data: { action_name: 'click', kwargs: {} },
      },
    };
  };
}

mock.module('../gemini', { namedExports: { runGeminiCua: makeProvider('gemini') } });
mock.module('../openai', { namedExports: { runOpenAICua: makeProvider('openai') } });
// Minimal provider:model parser so explicit-provider rejection is exercised.
mock.module('../../../llm', {
  namedExports: {
    parseModel: (model: string) => {
      const separator = model.indexOf(':');
      return separator > 0
        ? { provider: model.slice(0, separator), modelId: model.slice(separator + 1) }
        : { provider: undefined, modelId: model };
    },
  },
});
mock.module('../shared', { namedExports: { prepareScreenshot: async () => 'screenshotB64' } });
// modelFallback (loaded transitively) reads these off 'ai' for its instanceof checks.
mock.module('ai', { namedExports: { APICallError, RetryError } });

const { generateAction } = await import('../index');

function createContext(primary: string | undefined, fallbacks: string[] = []) {
  return {
    page: { viewportSize: () => ({ width: 1280, height: 800 }) },
    agentServices: {
      getComputerUseModel: () => primary,
      getComputerUseFallbackModels: () => fallbacks,
    },
  } as any;
}

describe('coordinatesBased generateAction: computer-use model fallback', () => {
  beforeEach(() => {
    calledModels = [];
    errorByModel = {};
  });

  it('falls over to the fallback computer-use model on a 429', async () => {
    errorByModel[PRIMARY] = rateLimited429();

    const result = await generateAction('click the button', createContext(PRIMARY, [FALLBACK]));

    assert.strictEqual(result.status, 'success', 'should recover via the fallback CUA model');
    assert.strictEqual(result.actionEntity!.action_description, `gemini:${FALLBACK}`);
    assert.deepStrictEqual(calledModels, [PRIMARY, FALLBACK]); // primary 429 → fallback
  });

  it('crosses providers on fallover: gemini CUA 429 → openai CUA (re-detects per model)', async () => {
    // The headline capability: per-candidate provider re-detection lets a gemini
    // primary fail over to an OpenAI computer-use model on a different backend.
    const OPENAI_FALLBACK = 'openai-cua-fallback'; // detectProvider → "openai"
    errorByModel[PRIMARY] = rateLimited429();

    const result = await generateAction('click the button', createContext(PRIMARY, [OPENAI_FALLBACK]));

    assert.strictEqual(result.status, 'success');
    // Served by the OpenAI provider, proving detectProvider switched backends.
    assert.strictEqual(result.actionEntity!.action_description, `openai:${OPENAI_FALLBACK}`);
    assert.deepStrictEqual(calledModels, [PRIMARY, OPENAI_FALLBACK]);
  });

  it('unwraps an exhausted-retry RetryError (AI_RetryError) and still falls over', async () => {
    errorByModel[PRIMARY] = new RetryError({
      message: 'Failed after 5 attempts',
      reason: 'maxRetriesExceeded',
      errors: [rateLimited429()],
    });

    const result = await generateAction('click the button', createContext(PRIMARY, [FALLBACK]));

    assert.strictEqual(result.status, 'success');
    assert.deepStrictEqual(calledModels, [PRIMARY, FALLBACK]);
  });

  it('with no computer-use fallback configured, a 429 surfaces as an error (no chain)', async () => {
    errorByModel[PRIMARY] = rateLimited429();

    const result = await generateAction('click the button', createContext(PRIMARY, []));

    assert.strictEqual(result.status, 'error');
    assert.deepStrictEqual(calledModels, [PRIMARY]); // only the primary, no fallover
  });

  it('errors when no computer-use model is configured', async () => {
    const result = await generateAction('click the button', createContext(undefined, [FALLBACK]));

    assert.strictEqual(result.status, 'error');
    assert.match(result.error ?? '', /No computer use model/);
    assert.deepStrictEqual(calledModels, []);
  });

  it('rejects OpenRouter for coordinate-based computer use', async () => {
    const result = await generateAction(
      'click the button',
      createContext('openrouter:openai/gpt-4o'),
    );

    assert.strictEqual(result.status, 'error');
    assert.match(result.error ?? '', /OpenRouter computer use is not supported/);
    assert.deepStrictEqual(calledModels, []);
  });
});
