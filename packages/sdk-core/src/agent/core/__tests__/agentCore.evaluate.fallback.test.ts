/**
 * Model fallback on the ASSERTION path (agentCore.evaluate). Companion to
 * elementBased.generateAction's fallback coverage — the incident (result 198883)
 * also 429'd on assert steps (webAgent.assert). A primary-model availability
 * failure on an assertion must fail over to the configured fallback model instead
 * of failing the assertion.
 *
 * Drives the REAL evaluate() with the LLM + page/knowledge helpers mocked.
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';
import { APICallError, RetryError, jsonSchema } from 'ai';

// Resolved model ids passed to generateText, in call order.
let calledModels: string[] = [];
// Per-model injected error / conclusion for the fallback tests.
let errorByModel: Record<string, unknown> = {};
let conclusionByModel: Record<string, string> = {};
let fallbackLogs: string[] = [];
let debugLogs: string[] = [];

function rateLimited429(): APICallError {
  return new APICallError({
    message: 'Resource exhausted',
    url: 'https://proxy/llm',
    requestBodyValues: {},
    statusCode: 429,
    isRetryable: true,
  });
}

function badRequest400(): APICallError {
  return new APICallError({
    message: 'Invalid request',
    url: 'https://proxy/llm',
    requestBodyValues: {},
    statusCode: 400,
    isRetryable: false,
  });
}

mock.module('ai', {
  namedExports: {
    generateText: async (config: any) => {
      const modelId = config?.model;
      if (typeof modelId === 'string') calledModels.push(modelId);
      if (modelId != null && modelId in errorByModel) throw errorByModel[modelId];
      const conclusion = (modelId != null && conclusionByModel[modelId]) || 'true';
      return { output: { conclusion, explanation: 'because', screenshotDescription: 'desc' }, usage: undefined };
    },
    Output: { object: (cfg: unknown) => cfg },
    // Real helper: strictSchema.ts builds the submission schema with it, and
    // this mock only stands in for the LLM boundary.
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

// Model resolution + provider options (identity so the mock sees the model id).
const actualLlm = await import('../../llm');
mock.module('../../llm', {
  namedExports: {
    // Real resolveTemperature so temperature omission for sampling-free Claude
    // models is exercised; identity getModel lets the generateText mock read ids.
    resolveTemperature: actualLlm.resolveTemperature,
    getModel: (m: string) => m,
    getProviderOptions: () => ({}),
  },
});

mock.module('../../../services/knowledgeService', {
  namedExports: {
    createKnowledgeParts: () => [],
    countKnowledgeImages: () => 0,
  },
});

mock.module('../../../utils/agentLogger', {
  namedExports: {
    agentLogger: {
      log: (message: string) => fallbackLogs.push(message),
    },
  },
});

mock.module('../../../utils/logger', {
  defaultExport: {
    debug: (message: string) => debugLogs.push(message),
  },
});

// agentCore imports both action generators at module top (for its dispatcher,
// which evaluate() doesn't use). Stub them so their heavy transitive graphs
// (CUA providers, DOM) don't load under the mocked `../../llm` barrel.
mock.module('../../action-generation/coordinatesBased', {
  namedExports: { generateAction: async () => ({ status: 'error' }) },
});
mock.module('../../action-generation/elementBased', {
  namedExports: { generateAction: async () => ({ status: 'error' }) },
});

const { evaluate } = await import('../agentCore');

function createContext(fallbacks: string[] = []) {
  return {
    page: {} as any,
    executionHistory: [],
    variables: {},
    sensitiveKeys: new Set<string>(),
    agentServices: {
      getModel: () => 'test-model',
      getFallbackModels: () => fallbacks,
      isSlicedScreenshotsEnabled: () => false,
      isResizeSlicedScreenshotsEnabled: () => false,
      isKnowledgeImagesEnabled: () => false,
      isAccessibilityTreeEnabled: () => false,
      retrieveKnowledges: async () => [],
    },
  } as any;
}

describe('agentCore.evaluate: model fallback on availability failure', () => {
  beforeEach(() => {
    calledModels = [];
    errorByModel = {};
    conclusionByModel = {};
    fallbackLogs = [];
    debugLogs = [];
  });

  it('falls over to the fallback model when the primary is rate-limited (429)', async () => {
    errorByModel['test-model'] = rateLimited429();
    conclusionByModel['fallback-model'] = 'true';

    const result = await evaluate('the dashboard is visible', createContext(['fallback-model']));

    assert.strictEqual(result.success, true, 'assertion should resolve via the fallback model');
    assert.deepStrictEqual(calledModels, ['test-model', 'fallback-model']); // primary 429 → fallback
    assert.equal(fallbackLogs.length, 1);
    assert.match(fallbackLogs[0]!, /test-model.*Resource exhausted.*fallback-model/);
    assert.deepStrictEqual(debugLogs, fallbackLogs);
  });

  it('unwraps an exhausted-retry RetryError (AI_RetryError) and still falls over', async () => {
    errorByModel['test-model'] = new RetryError({
      message: 'Failed after 3 attempts',
      reason: 'maxRetriesExceeded',
      errors: [rateLimited429()],
    });
    conclusionByModel['fallback-model'] = 'true';

    const result = await evaluate('the dashboard is visible', createContext(['fallback-model']));

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(calledModels, ['test-model', 'fallback-model']);
  });

  it('does NOT fall back on a 400 (malformed) — surfaces the failure, primary only', async () => {
    errorByModel['test-model'] = badRequest400();
    conclusionByModel['fallback-model'] = 'true';

    const result = await evaluate('the dashboard is visible', createContext(['fallback-model']));

    // evaluate swallows the thrown error into { success: false, error }.
    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(calledModels, ['test-model']); // fallback never attempted
  });

  it('with no fallback configured, a primary 429 surfaces as a failed assertion (no chain)', async () => {
    errorByModel['test-model'] = rateLimited429();

    const result = await evaluate('the dashboard is visible', createContext([]));

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(calledModels, ['test-model']);
  });
});
