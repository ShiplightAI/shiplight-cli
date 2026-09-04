/**
 * Model-fallback behavior of runTaskLoop (the incident fix): when the primary
 * web-agent model fails with an availability error (e.g. 429), the agent should
 * retry the request on the next model in WEB_AGENT_FALLBACK_MODELS; it should
 * NOT fall back on a malformed-request (400) error; and once it has failed over,
 * subsequent steps should stick to the working model.
 *
 * Drives the real runTaskLoop with `generateText` mocked via mock.module. The
 * `../../llm` getModel stub is identity so the generateText mock can see which
 * model string each call used.
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';
import { APICallError, RetryError } from 'ai';
import { configureSdk } from '../../../config';

const PRIMARY = 'google:gemini-3.1-pro-preview';
const FALLBACK = 'anthropic:claude-opus-4-7';

const DONE_TEXT = JSON.stringify({
  thinking: 'done',
  evaluation_previous_goal: 'N/A',
  memory: '',
  current_goal: 'complete task',
  actions: [{ action_name: 'done', description: 'Task complete', kwargs: { success: true, summary: 'done' } }],
});

const CONTINUE_TEXT = JSON.stringify({
  thinking: 'working',
  current_goal: 'still working',
  actions: [{ action_name: 'click', description: 'Click something', kwargs: { element_index: 0 } }],
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

function badRequest(): never {
  throw new APICallError({
    message: 'Invalid request',
    url: 'https://proxy/llm',
    requestBodyValues: {},
    statusCode: 400,
    isRetryable: false,
  });
}

// generateText mock — each test sets its own implementation.
const generateTextMock = mock.fn(async (_config: any) => ok(DONE_TEXT));

mock.module('ai', {
  namedExports: { generateText: generateTextMock, APICallError, RetryError },
});

// Identity getModel so the generateText mock can read config.model as a string.
mock.module('../../llm', {
  namedExports: {
    getModel: (m: string) => m,
    getProviderOptions: () => ({}),
    // This suite is about fallback ordering, not sampling params; keep the
    // temperature resolver a neutral passthrough (real behavior is covered in
    // executor.temperature.test.ts).
    resolveTemperature: (_m: string, t: number | undefined) => t ?? 0,
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

/** Models passed to generateText, in call order. */
function calledModels(): string[] {
  return generateTextMock.mock.calls.map((c) => (c.arguments[0] as any).model);
}

function apiError(statusCode: number): APICallError {
  return new APICallError({
    message: `status ${statusCode}`,
    url: 'https://proxy/llm',
    requestBodyValues: {},
    statusCode,
    isRetryable: statusCode >= 500 || statusCode === 429,
  });
}

describe('runTaskLoop model fallback', () => {
  beforeEach(() => {
    generateTextMock.mock.resetCalls();
    generateTextMock.mock.restore();
    // The executor reads the timeout from getSdkConfig().env (NOT process.env).
    // Disable it by default so tests don't arm the real 150s timer; the timeout
    // test overrides this.
    configureSdk({ env: { WEB_AGENT_LLM_TIMEOUT_MS: '0' } });
  });

  it('falls over to the fallback model on a 429 and completes', async () => {
    generateTextMock.mock.mockImplementation(async (config: any) => {
      if (config.model === PRIMARY) rateLimited();
      return ok(DONE_TEXT);
    });

    const result = await runTaskLoop('Do something', createContext([FALLBACK]), { maxSteps: 3 });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.completed, true);
    assert.deepStrictEqual(calledModels(), [PRIMARY, FALLBACK]); // primary 429 → fallback ok
  });

  it('does NOT fall over on a 400 (malformed request) and surfaces the error', async () => {
    generateTextMock.mock.mockImplementation(async () => badRequest());

    const result = await runTaskLoop('Do something', createContext([FALLBACK]), { maxSteps: 3 });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(calledModels(), [PRIMARY]); // fallback never attempted
  });

  it('sticks to the fallback model on later steps instead of re-probing the primary', async () => {
    generateTextMock.mock.mockImplementation(async (config: any) => {
      if (config.model === PRIMARY) rateLimited();
      return ok(CONTINUE_TEXT); // never "done" → forces the loop to hit maxSteps
    });

    await runTaskLoop('Do something', createContext([FALLBACK]), { maxSteps: 2 });

    const models = calledModels();
    // Step 1: primary(429) → fallback(ok). Step 2: fallback only (sticky).
    assert.deepStrictEqual(models, [PRIMARY, FALLBACK, FALLBACK]);
    assert.strictEqual(models.filter((m) => m === PRIMARY).length, 1); // primary probed once
  });

  it('with no fallback configured, a 429 surfaces as before (no fallback)', async () => {
    generateTextMock.mock.mockImplementation(async () => rateLimited());

    const result = await runTaskLoop('Do something', createContext([]), { maxSteps: 3 });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(calledModels(), [PRIMARY]); // only the primary, no chain
  });

  it('falls over on a 5xx as well as a 429', async () => {
    generateTextMock.mock.mockImplementation(async (config: any) => {
      if (config.model === PRIMARY) throw apiError(503);
      return ok(DONE_TEXT);
    });

    const result = await runTaskLoop('Do something', createContext([FALLBACK]), { maxSteps: 3 });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(calledModels(), [PRIMARY, FALLBACK]);
  });

  it('dedupes the primary if it is also listed in the fallback chain', async () => {
    generateTextMock.mock.mockImplementation(async (config: any) => {
      if (config.model === PRIMARY) rateLimited();
      return ok(DONE_TEXT);
    });

    // Primary appears in the fallback list; it must be probed exactly once.
    const result = await runTaskLoop('Do something', createContext([PRIMARY, FALLBACK]), { maxSteps: 3 });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(calledModels(), [PRIMARY, FALLBACK]);
  });

  it('does NOT fall back on an external abort — it is terminal', async () => {
    const external = new AbortController();
    generateTextMock.mock.mockImplementation(async (config: any) => {
      if (config.model === PRIMARY) {
        external.abort(); // host cancels mid-call
        throw new DOMException('aborted', 'AbortError');
      }
      return ok(DONE_TEXT);
    });

    const result = await runTaskLoop('Do something', createContext([FALLBACK]), {
      maxSteps: 3,
      abortSignal: external.signal,
    });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(calledModels(), [PRIMARY]); // fallback never attempted
  });

  it('times out a hung primary and falls over to the fallback', async () => {
    configureSdk({ env: { WEB_AGENT_LLM_TIMEOUT_MS: '30' } }); // short per-attempt timeout
    generateTextMock.mock.mockImplementation(async (config: any) => {
      if (config.model === PRIMARY) {
        // Hang until the per-attempt timeout aborts the combined signal.
        return await new Promise((_resolve, reject) => {
          config.abortSignal?.addEventListener('abort', () =>
            reject(new DOMException('timed out', 'AbortError')),
          );
        });
      }
      return ok(DONE_TEXT);
    });

    const result = await runTaskLoop('Do something', createContext([FALLBACK]), { maxSteps: 3 });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(calledModels(), [PRIMARY, FALLBACK]); // primary timed out → fallback
  });

  it('re-sends the corrective message to the SAME model on unparseable JSON (regression)', async () => {
    let call = 0;
    generateTextMock.mock.mockImplementation(async () => {
      call += 1;
      return call === 1 ? ok('this is not json') : ok(DONE_TEXT);
    });

    const result = await runTaskLoop('Do something', createContext([FALLBACK]), { maxSteps: 1 });

    assert.strictEqual(result.success, true);
    // A parse failure re-prompts the SAME model (not the fallback)...
    assert.deepStrictEqual(calledModels(), [PRIMARY, PRIMARY]);
    // ...and the 2nd call must carry the corrective note. The pre-fix code built
    // generateConfig once with stale messages, so this note was dropped.
    const secondMessages = JSON.stringify((generateTextMock.mock.calls[1]!.arguments[0] as any).messages);
    assert.match(secondMessages, /not valid JSON/);
  });
});
