/**
 * Deterministic unit tests for the NL -> action decision (elementBased.generateAction).
 *
 * Closes quality-evidence gap exp-nl-to-action-loop (001-web-agent-engine): the
 * core "natural-language step -> concrete ActionEntity" mapping previously had NO
 * CI-gated proof — only a live browser spec (tests/specs/generateAction.spec.ts)
 * that needs a real browser + API key.
 *
 * Strategy: mock the LLM call (`generateText` from 'ai') to return a canned
 * structured response, and mock the browser/DOM-dependent helpers, then run the
 * REAL generateAction and assert the ActionEntity it derives. No browser, no key.
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';
import { APICallError, RetryError, jsonSchema } from 'ai';
import { z } from 'zod';

// The structured LLM output the mocked generateText() will return for the next call.
let nextOutput: unknown = {};
// When set, the mocked generateText() throws this instead of returning output —
// used to exercise the NoObjectGeneratedError recovery path (only happens for a
// normal 'stop' finish where parsing fails).
let nextError: unknown = null;
// Per-model injection for model-fallback tests: throw `errorByModel[id]` / return
// `outputByModel[id]` when generateText is called with that resolved model id.
let errorByModel: Record<string, unknown> = {};
let outputByModel: Record<string, unknown> = {};
// The resolved model ids passed to generateText, in call order.
let calledModels: string[] = [];
// Abnormal-finish fields the real AI SDK puts on the (non-throwing) result when it
// finished early. The SDK only parses structured output on finishReason 'stop', so for
// 'length'/'content-filter' it returns output:undefined and these surface the cause.
let nextFinishReason: string | undefined;
let nextText: string | undefined;
let nextUsage: unknown;

// Minimal stand-in for the AI SDK's NoObjectGeneratedError (carries the raw model text,
// the finish reason, and usage — all of which the recovery path inspects).
class MockNoObjectGeneratedError extends Error {
  text?: string;
  finishReason?: string;
  usage?: unknown;
  constructor(opts: { text?: string; finishReason?: string; usage?: unknown } = {}) {
    super('No object generated: response did not match schema.');
    this.name = 'AI_NoObjectGeneratedError';
    this.text = opts.text;
    this.finishReason = opts.finishReason;
    this.usage = opts.usage;
  }
  static isInstance(e: unknown): e is MockNoObjectGeneratedError {
    return e instanceof MockNoObjectGeneratedError;
  }
}

// --- Module-level mocks (must be set up before dynamic import of elementBased) ---

mock.module('ai', {
  namedExports: {
    // generateText is the LLM boundary. Records the model each call used, throws a
    // per-model injected error (model-fallback tests) or the queued nextError, else
    // returns the per-model or canned output.
    generateText: async (config: any) => {
      const modelId = config?.model;
      if (typeof modelId === 'string') calledModels.push(modelId);
      if (modelId != null && modelId in errorByModel) throw errorByModel[modelId];
      if (nextError) throw nextError;
      const output = modelId != null && modelId in outputByModel ? outputByModel[modelId] : nextOutput;
      return {
        output,
        usage: nextUsage,
        reasoningText: 'mock-reasoning',
        finishReason: nextFinishReason,
        text: nextText,
      };
    },
    // Output.object({schema}) is passed to generateText (which we mock), so identity is fine.
    Output: { object: (cfg: unknown) => cfg },
    NoObjectGeneratedError: MockNoObjectGeneratedError,
    // Re-export the real availability-error classes so modelFallback's
    // APICallError/RetryError instanceof checks match errors the tests construct.
    // Real helper: strictSchema.ts builds the submission schema with it, and
    // this mock only stands in for the LLM boundary.
    jsonSchema,
    APICallError,
    RetryError,
  },
});

// buildPageContext is the DOM/browser-heavy step; stub it so no browser is needed.
// selectorMap has an element at index 5 so the element_index -> locator path runs.
mock.module('../../../utils/pageContext', {
  namedExports: {
    buildPageContext: async () => ({
      screenshotBase64: '',
      domState: { selectorMap: new Map<number, unknown>([[5, { tagName: 'button' }]]) },
      pageContext: { elementsText: '' },
    }),
  },
});

// Model resolution + provider options (would otherwise need provider wiring/keys).
const actualLlm = await import('../../llm');
mock.module('../../llm', {
  namedExports: {
    // Real resolveTemperature so temperature omission for sampling-free Claude
    // models is exercised; identity getModel lets the generateText mock read ids.
    resolveTemperature: actualLlm.resolveTemperature,
    // Identity so the generateText mock can read config.model as the model id string.
    getModel: (m: string) => m,
    getProviderOptions: () => ({}),
  },
});

// Locator info for an element_index — the self-healing locator attached to the action.
const MOCK_LOCATOR = { locator: "getByRole('button', { name: 'Login' })", xpath: '//button[1]' };
mock.module('../../../llm_tools/utils', {
  namedExports: {
    getActionEntityLocatorInfo: async () => ({ ...MOCK_LOCATOR }),
  },
});

// Tool registry / provider: only the action union schema + tool list are read.
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

// Prompt builders — return trivial strings.
mock.module('../actionPrompts', {
  namedExports: {
    getActionGenerationSystemPrompt: () => 'system',
    getActionGenerationUserPrompt: () => 'user',
  },
});

// Coordinates-based fallback (only used for perform_accurate_operation).
mock.module('../coordinatesBased', {
  namedExports: {
    generateAction: async () => ({
      status: 'success',
      actionEntity: { action_description: 'coords', action_data: { action_name: 'click', kwargs: {} } },
    }),
  },
});

// --- Dynamic import after mocks ---

const { generateAction } = await import('../elementBased');

// --- Helpers ---

function createContext(statement: string, fallbackModels: string[] = []) {
  const agentServices = {
    getModel: () => 'test-model',
    getFallbackModels: () => fallbackModels,
    retrieveKnowledges: async () => [],
    isSlicedScreenshotsEnabled: () => false,
    isResizeSlicedScreenshotsEnabled: () => false,
    isKnowledgeImagesEnabled: () => false,
    isAccessibilityTreeEnabled: () => false,
    isActionIntentFilteringEnabled: () => false,
  };
  return {
    statement,
    page: {} as any,
    agentServices: agentServices as any,
    variables: {},
    executionHistory: [],
    sensitiveKeys: [],
  } as any;
}

// --- Tests ---

describe('generateAction: NL step -> ActionEntity decision', () => {
  beforeEach(() => {
    nextOutput = {};
    nextError = null;
    nextFinishReason = undefined;
    nextText = undefined;
    nextUsage = undefined;
    errorByModel = {};
    outputByModel = {};
    calledModels = [];
  });

  it('maps a click decision to a click ActionEntity with the resolved locator', async () => {
    nextOutput = {
      thought: 'I should click the login button',
      description: 'Click the Login button',
      action: { click: { element_index: 5 } },
      completes_instruction: true,
    };

    const result = await generateAction('Click the login button', createContext('Click the login button'));

    assert.strictEqual(result.status, 'success');
    assert.ok(result.actionEntity, 'should produce an actionEntity');
    assert.strictEqual(result.actionEntity!.action_data.action_name, 'click');
    assert.strictEqual(result.actionEntity!.action_data.kwargs.element_index, 5);
    assert.strictEqual(result.actionEntity!.action_description, 'Click the Login button');
    // Self-healing locator info is attached from the DOM element the LLM referenced.
    assert.strictEqual(result.actionEntity!.locator, MOCK_LOCATOR.locator);
    assert.strictEqual(result.actionEntity!.xpath, MOCK_LOCATOR.xpath);
  });

  it('rewrites a verify decision to carry the original statement as the assertion', async () => {
    const statement = 'the dashboard greeting is visible';
    nextOutput = {
      thought: '',
      description: 'check greeting',
      action: { verify: {} },
      completes_instruction: true,
    };

    const result = await generateAction(statement, createContext(statement));

    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.actionEntity!.action_data.action_name, 'verify');
    // verify must use the original statement as both the description and the kwargs.statement
    assert.strictEqual(result.actionEntity!.action_data.kwargs.statement, statement);
    assert.strictEqual(result.actionEntity!.action_description, statement);
  });

  it('errors when the LLM returns no action', async () => {
    nextOutput = { thought: 'unsure', description: '', action: {}, completes_instruction: true };

    const result = await generateAction('do something', createContext('do something'));

    assert.strictEqual(result.status, 'error');
    assert.match(result.error ?? '', /did not generate any action/i);
  });

  it('recovers the model reasoning when the action schema rejects an empty action', async () => {
    // The model followed the prompt and returned an empty action because nothing matched;
    // the AI SDK's Output.object() then throws NoObjectGeneratedError carrying the raw text.
    // We should surface that reasoning, not the generic "response did not match schema".
    nextError = new MockNoObjectGeneratedError({
      finishReason: 'stop', // finished normally — this is a deliberate empty action
      text: JSON.stringify({
        thought: 'There is no matching item in the dropdown; returning an empty action.',
        action: {},
        completes_instruction: false,
      }),
    });

    const result = await generateAction('click the missing item', createContext('click the missing item'));

    assert.strictEqual(result.status, 'error');
    assert.match(result.error ?? '', /No matching element\/action/);
    assert.match(result.reasoning ?? '', /no matching item in the dropdown/i);
    // The original "did not match schema" text must not leak through as the surfaced error.
    assert.doesNotMatch(result.error ?? '', /did not match schema/);
  });

  it('surfaces recovered usage tokens on the no-match path', async () => {
    // NoObjectGeneratedError carries usage; the recovery must account for it, not drop it.
    nextError = new MockNoObjectGeneratedError({
      finishReason: 'stop',
      usage: { inputTokens: 120, outputTokens: 34, totalTokens: 154 },
      text: JSON.stringify({ thought: 'nothing matches', action: {}, completes_instruction: false }),
    });

    const result = await generateAction('click the missing item', createContext('click the missing item'));

    assert.strictEqual(result.status, 'error');
    const usages = result.debugInfo?.tokenUsages ?? [];
    assert.strictEqual(usages.length, 1, 'recovered usage should be recorded');
    assert.strictEqual(usages[0]!.prompt_tokens, 120);
    assert.strictEqual(usages[0]!.completion_tokens, 34);
    assert.strictEqual(usages[0]!.total_tokens, 154);
  });

  it('reports a truncation failure, not a no-match, when the response is cut off', async () => {
    // Token limit reached: the AI SDK does NOT throw for a non-'stop' finish — it returns
    // output:undefined. The post-call guard (not the catch) must surface the truncation.
    nextOutput = undefined;
    nextFinishReason = 'length';
    nextText = '{"thought":"I will click the'; // truncated, partial text
    nextUsage = { inputTokens: 200, outputTokens: 4096, totalTokens: 4296 };

    const result = await generateAction('click login', createContext('click login'));

    assert.strictEqual(result.status, 'error');
    assert.match(result.error ?? '', /truncated|token limit/i);
    assert.doesNotMatch(result.error ?? '', /No matching element\/action/);
    // Usage from the truncated call must still be recorded.
    assert.strictEqual((result.debugInfo?.tokenUsages ?? []).length, 1);
  });

  it('reports a content-filter failure, not a no-match', async () => {
    nextOutput = undefined;
    nextFinishReason = 'content-filter';

    const result = await generateAction('do the thing', createContext('do the thing'));

    assert.strictEqual(result.status, 'error');
    assert.match(result.error ?? '', /content filter/i);
    assert.doesNotMatch(result.error ?? '', /No matching element\/action/);
  });

  it('reports a generic early-stop failure for any other non-stop finish reason', async () => {
    nextOutput = undefined;
    nextFinishReason = 'other';

    const result = await generateAction('click login', createContext('click login'));

    assert.strictEqual(result.status, 'error');
    assert.match(result.error ?? '', /stopped before producing an action.*other/i);
    assert.doesNotMatch(result.error ?? '', /No matching element\/action/);
  });

  it('reports a schema-mismatch failure when a non-empty action fails validation', async () => {
    // The model intended to act but produced a malformed action (wrong field type). This is
    // a schema failure, NOT a deliberate empty action — it must not be reported as a no-match.
    nextError = new MockNoObjectGeneratedError({
      finishReason: 'stop',
      text: JSON.stringify({
        thought: 'clicking element 3',
        action: { click: { element_index: 'three' } }, // non-empty but invalid
        completes_instruction: true,
      }),
    });

    const result = await generateAction('click element 3', createContext('click element 3'));

    assert.strictEqual(result.status, 'error');
    assert.match(result.error ?? '', /did not match any known action schema/i);
    assert.doesNotMatch(result.error ?? '', /No matching element\/action/);
  });

  it('treats an explicit null action as a no-match (same as an empty action object)', async () => {
    nextError = new MockNoObjectGeneratedError({
      finishReason: 'stop',
      text: JSON.stringify({
        thought: 'No suitable element exists on the page.',
        action: null,
        completes_instruction: false,
      }),
    });

    const result = await generateAction('click the missing item', createContext('click the missing item'));

    assert.strictEqual(result.status, 'error');
    assert.match(result.error ?? '', /No matching element\/action/);
    assert.match(result.reasoning ?? '', /no suitable element/i);
  });

  it('reports a parse failure when the raw text is not JSON and there is no finish reason', async () => {
    nextError = new MockNoObjectGeneratedError({
      text: 'I am sorry, I cannot help with that.', // prose, not JSON; finishReason undefined
    });

    const result = await generateAction('click login', createContext('click login'));

    assert.strictEqual(result.status, 'error');
    assert.match(result.error ?? '', /could not be parsed/i);
    assert.doesNotMatch(result.error ?? '', /No matching element\/action/);
  });

  it('does not mislabel a missing error text as a no-match', async () => {
    // The SDK types NoObjectGeneratedError.text as string | undefined. With no text there is
    // nothing to recover, so this must NOT fall into the "no matching element" branch.
    nextError = new MockNoObjectGeneratedError({ finishReason: 'stop' }); // text undefined

    const result = await generateAction('click login', createContext('click login'));

    assert.strictEqual(result.status, 'error');
    assert.match(result.error ?? '', /could not be parsed/i);
    assert.doesNotMatch(result.error ?? '', /No matching element\/action/);
  });

  it("errors when the LLM signals 'done' instead of an action", async () => {
    nextOutput = { thought: 'finished', action: { done: {} }, completes_instruction: true };

    const result = await generateAction('finish up', createContext('finish up'));

    assert.strictEqual(result.status, 'error');
    assert.match(result.error ?? '', /done/i);
  });

  it('errors when the action cannot complete the instruction in one step', async () => {
    nextOutput = { action: { click: { element_index: 1 } }, completes_instruction: false };

    const result = await generateAction('log in and open settings', createContext('log in and open settings'));

    assert.strictEqual(result.status, 'error');
    assert.match(result.error ?? '', /complete the instruction in one action/i);
  });

  it('errors when the referenced element_index is negative', async () => {
    nextOutput = { action: { click: { element_index: -1 } }, completes_instruction: true };

    const result = await generateAction('click the missing button', createContext('click the missing button'));

    assert.strictEqual(result.status, 'error');
    assert.match(result.error ?? '', /did not generate any action/i);
  });

  it('routes to the coordinates-based (vision) generator for perform_accurate_operation', async () => {
    // When the element-based model decides the DOM is insufficient, it emits
    // perform_accurate_operation, which must hand off to the vision generator.
    nextOutput = { action: { perform_accurate_operation: {} }, completes_instruction: true };

    const result = await generateAction('drag the slider precisely', createContext('drag the slider precisely'));

    assert.strictEqual(result.status, 'success');
    // The mocked coordinatesBased generator returns this marker action.
    assert.strictEqual(result.actionEntity!.action_description, 'coords');
  });
});

/**
 * Model-fallback on the test-execution action-generation path (incident: prod
 * result 198883). A primary-model Vertex 429 previously failed the whole test
 * because generateAction used a single model and never tried the configured
 * WEB_AGENT_FALLBACK_MODELS — the fallback chain only wrapped the runTask loop,
 * not executeStep/generateAction. These lock in that the chain is now tried here.
 */
describe('generateAction: model fallback on availability failure', () => {
  beforeEach(() => {
    nextOutput = {};
    nextError = null;
    nextFinishReason = undefined;
    nextText = undefined;
    nextUsage = undefined;
    errorByModel = {};
    outputByModel = {};
    calledModels = [];
  });

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

  it('falls over to the fallback model when the primary is rate-limited (429)', async () => {
    errorByModel['test-model'] = rateLimited429(); // primary Vertex quota exhausted
    outputByModel['fallback-model'] = {
      thought: 'clicking',
      description: 'Click the Login button',
      action: { click: { element_index: 5 } },
      completes_instruction: true,
    };
    // Usage from the (only) successful call — the fallback's — so we can assert
    // token attribution below.
    nextUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

    const result = await generateAction('click login', createContext('click login', ['fallback-model']));

    assert.strictEqual(result.status, 'success', 'should recover via the fallback model');
    assert.strictEqual(result.actionEntity!.action_data.action_name, 'click');
    assert.deepStrictEqual(calledModels, ['test-model', 'fallback-model']); // primary 429 → fallback
    // Token usage must be attributed to the model that actually served (the
    // fallback), NOT the primary — guards the `usedModel` labeling on the success
    // path (a revert to `model` here would mislabel it 'test-model').
    const usages = result.actionEntity!.action_data ? result.debugInfo?.tokenUsages ?? [] : [];
    assert.strictEqual(usages.length, 1, 'success path should record one token usage');
    assert.strictEqual(usages[0]!.model, 'fallback-model');
  });

  it('probes the primary exactly once even if it is also listed as a fallback (dedup)', async () => {
    errorByModel['test-model'] = rateLimited429();
    outputByModel['fallback-model'] = {
      action: { click: { element_index: 5 } },
      completes_instruction: true,
    };

    // Primary duplicated in the fallback list — the chain build must dedupe it.
    const result = await generateAction(
      'click login',
      createContext('click login', ['test-model', 'fallback-model']),
    );

    assert.strictEqual(result.status, 'success');
    assert.deepStrictEqual(calledModels, ['test-model', 'fallback-model']); // primary tried once
  });

  it('unwraps an exhausted-retry RetryError (AI_RetryError) and still falls over', async () => {
    // The real failure was `AI_RetryError: Failed after 5 attempts` wrapping a 429.
    errorByModel['test-model'] = new RetryError({
      message: 'Failed after 5 attempts',
      reason: 'maxRetriesExceeded',
      errors: [rateLimited429()],
    });
    outputByModel['fallback-model'] = {
      action: { click: { element_index: 5 } },
      completes_instruction: true,
    };

    const result = await generateAction('click login', createContext('click login', ['fallback-model']));

    assert.strictEqual(result.status, 'success');
    assert.deepStrictEqual(calledModels, ['test-model', 'fallback-model']);
  });

  it('does NOT fall back on a 400 (malformed request) — surfaces the error, primary only', async () => {
    errorByModel['test-model'] = badRequest400();
    outputByModel['fallback-model'] = { action: { click: { element_index: 5 } }, completes_instruction: true };

    await assert.rejects(
      generateAction('click login', createContext('click login', ['fallback-model'])),
      /Invalid request|400/,
    );
    assert.deepStrictEqual(calledModels, ['test-model']); // fallback never attempted
  });

  it('with no fallback configured, a primary 429 surfaces as before (no chain)', async () => {
    errorByModel['test-model'] = rateLimited429();

    await assert.rejects(
      generateAction('click login', createContext('click login', [])),
      /Resource exhausted|429/,
    );
    assert.deepStrictEqual(calledModels, ['test-model']);
  });
});
