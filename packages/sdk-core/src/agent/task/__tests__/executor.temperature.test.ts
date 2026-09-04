/**
 * Regression / smoke test for the failed-fallback incident.
 *
 * Production repro: the primary web-agent model (Gemini) got throttled (429) and
 * the agent failed over to the `anthropic:claude-sonnet-5` fallback — but the
 * request carried `temperature: 0`, which Sonnet 5 (a sampling-free model)
 * rejects with a non-retryable HTTP 400. shouldFallBackToNextModel correctly
 * treats 400 as terminal, so the step just died and the run went back to
 * hammering the throttled Gemini model: 0 of 3 fallback attempts got any relief.
 *
 * The fix omits `temperature` for models that reject it (via resolveTemperature).
 * This test drives the real runTaskLoop with the REAL resolveTemperature wired
 * through the `../../llm` mock, and a generateText mock that mimics Anthropic's
 * 400-on-non-default-temperature. Before the fix it fails (the fallback 400s and
 * the run does not complete); after the fix the fallback omits temperature and
 * the run completes.
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';
import { APICallError, RetryError } from 'ai';
import { configureSdk } from '../../../config';

const PRIMARY = 'google:gemini-3.1-pro-preview';
const SAMPLING_FREE_FALLBACK = 'anthropic:claude-sonnet-5'; // rejects temperature
const SAMPLING_OK_FALLBACK = 'anthropic:claude-haiku-4-5'; // accepts temperature

const DONE_TEXT = JSON.stringify({
  thinking: 'done',
  evaluation_previous_goal: 'N/A',
  memory: '',
  current_goal: 'complete task',
  actions: [{ action_name: 'done', description: 'Task complete', kwargs: { success: true, summary: 'done' } }],
});

function ok(text: string) {
  return { text, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
}

function rateLimited(): never {
  throw new APICallError({
    message: 'Resource exhausted',
    url: 'https://proxy/llm',
    requestBodyValues: {},
    statusCode: 429,
    isRetryable: true,
  });
}

/** Anthropic's rejection of a non-default sampling parameter. */
function anthropicRejectsTemperature(): never {
  throw new APICallError({
    message: 'temperature: Extra inputs are not permitted',
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode: 400,
    isRetryable: false,
  });
}

const generateTextMock = mock.fn(async (_config: any) => ok(DONE_TEXT));

mock.module('ai', {
  namedExports: { generateText: generateTextMock, APICallError, RetryError },
});

// Wire the REAL resolveTemperature through the llm mock so the fix is exercised;
// getModel is identity so the generateText mock can read config.model as a string.
const actualLlm = await import('../../llm');
mock.module('../../llm', {
  namedExports: {
    getModel: (m: string) => m,
    getProviderOptions: () => ({}),
    resolveTemperature: actualLlm.resolveTemperature,
  },
});

mock.module('../../../dom', {
  namedExports: {
    DomService: class {
      getClickableElements = async () => ({
        elementTree: { clickableElementsToString: () => 'empty' },
        selectorMap: new Map(),
      });
      getClickableElementsWithScreenshot = async () => ({
        domState: { elementTree: { clickableElementsToString: () => 'empty' }, selectorMap: new Map() },
        screenshotBase64: '',
      });
    },
    HistoryTreeProcessor: class {},
  },
});
mock.module('../../../browser/browserUtils', {
  namedExports: { waitForPageAndFramesLoad: async () => {} },
});
mock.module('../../../llm_tools/registry', {
  namedExports: { toolRegistry: { execute: async () => ({ success: true }), getTools: () => [] } },
});
mock.module('../../../llm_tools/utils', {
  namedExports: { getActionEntityLocatorInfo: async () => ({}), getFramePath: () => [] },
});

const { runTaskLoop } = await import('../executor');

function createContext(fallbackModels: string[]) {
  const domState = {
    getClickableElements: async () => ({
      elementTree: { clickableElementsToString: () => 'empty' },
      selectorMap: new Map(),
    }),
    getClickableElementsWithScreenshot: async () => ({
      domState: { elementTree: { clickableElementsToString: () => 'empty' }, selectorMap: new Map() },
      screenshotBase64: '',
    }),
  };
  return {
    page: { url: () => 'https://example.com', screenshot: async () => Buffer.from('x'), evaluate: async () => ({}) } as any,
    agentServices: {
      getModel: () => PRIMARY,
      getFallbackModels: () => fallbackModels,
      getDomServiceOptions: () => ({}),
      getInteractiveClassNames: () => [],
      getIframeFallbackDomains: () => [],
      getCurrentPage: async () => null,
      waitUntilStable: async () => {},
    } as any,
    domService: domState as any,
  };
}

/** The (model, temperature) pairs generateText was called with, in order. */
function calls(): Array<{ model: string; temperature: number | undefined }> {
  return generateTextMock.mock.calls.map((c) => {
    const cfg = c.arguments[0] as any;
    return { model: cfg.model as string, temperature: cfg.temperature };
  });
}

describe('runTaskLoop temperature handling on fallback', () => {
  beforeEach(() => {
    generateTextMock.mock.resetCalls();
    generateTextMock.mock.restore();
    configureSdk({ env: { WEB_AGENT_LLM_TIMEOUT_MS: '0' } });
  });

  it('omits temperature for the Sonnet 5 fallback so a throttled primary actually recovers', async () => {
    generateTextMock.mock.mockImplementation(async (config: any) => {
      const model = config.model as string;
      if (model === PRIMARY) rateLimited(); // 429 → fall over
      // Sonnet 5 rejects a non-default temperature. Pre-fix the executor sent
      // temperature: 0 here, producing a 400 that killed the fallback.
      if (model === SAMPLING_FREE_FALLBACK && config.temperature !== undefined) {
        anthropicRejectsTemperature();
      }
      return ok(DONE_TEXT);
    });

    const result = await runTaskLoop('Do something', createContext([SAMPLING_FREE_FALLBACK]), { maxSteps: 3 });

    // The whole point: the fallback now succeeds and the run completes.
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.completed, true);

    const observed = calls();
    assert.deepStrictEqual(
      observed.map((c) => c.model),
      [PRIMARY, SAMPLING_FREE_FALLBACK],
    );
    // Primary (Google) still gets the determinism default; the Sonnet 5 request
    // carries NO temperature key — the exact request-shaping the fix guarantees.
    assert.strictEqual(observed[0]!.temperature, 0);
    assert.strictEqual(observed[1]!.temperature, undefined);
  });

  it('still sends temperature to a fallback model that accepts sampling (Haiku 4.5)', async () => {
    generateTextMock.mock.mockImplementation(async (config: any) => {
      if ((config.model as string) === PRIMARY) rateLimited();
      return ok(DONE_TEXT);
    });

    const result = await runTaskLoop('Do something', createContext([SAMPLING_OK_FALLBACK]), { maxSteps: 3 });

    assert.strictEqual(result.success, true);
    const observed = calls();
    assert.deepStrictEqual(
      observed.map((c) => c.model),
      [PRIMARY, SAMPLING_OK_FALLBACK],
    );
    assert.strictEqual(observed[1]!.temperature, 0); // Haiku 4.5 keeps determinism
  });
});
