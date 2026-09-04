/**
 * Unit tests for runTaskLoop() maxSteps validation and defaults
 *
 * Uses mock.module to stub LLM and DOM dependencies.
 */

import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
// Real AI SDK error classes — the module mock below stubs `generateText` but
// must still expose these, which the model-fallback classifier imports from 'ai'.
import { APICallError, RetryError } from 'ai';

// --- Module-level mocks (before dynamic imports) ---

// Mock the 'ai' module to prevent real LLM calls
const generateTextMock = mock.fn(async () => ({
  text: JSON.stringify({
    thinking: 'done',
    evaluation_previous_goal: 'N/A',
    memory: '',
    current_goal: 'complete task',
    actions: [
      {
        action_name: 'done',
        description: 'Task complete',
        kwargs: { success: true, summary: 'done' },
      },
    ],
  }),
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
}));

mock.module('ai', {
  namedExports: {
    generateText: generateTextMock,
    APICallError,
    RetryError,
  },
});

// Mock the llm provider to avoid model initialization
mock.module('../../llm', {
  namedExports: {
    getModel: () => 'test-model',
    getProviderOptions: () => ({}),
    resolveTemperature: (_m: string, t: number | undefined) => t ?? 0,
  },
});

// Mock the dom module to prevent ?raw import chain
mock.module('../../../dom', {
  namedExports: {
    DomService: class MockDomService {
      getClickableElements = async () => ({
        elementTree: { clickableElementsToString: () => 'empty' },
        selectorMap: new Map(),
      });
      getClickableElementsWithScreenshot = async () => ({
        domState: {
          elementTree: { clickableElementsToString: () => 'empty' },
          selectorMap: new Map(),
        },
        screenshotBase64: '',
      });
    },
    HistoryTreeProcessor: class {},
  },
});

// Mock browser utils
mock.module('../../../browser/browserUtils', {
  namedExports: {
    waitForPageAndFramesLoad: async () => {},
  },
});

// Mock llm_tools registry
mock.module('../../../llm_tools/registry', {
  namedExports: {
    toolRegistry: {
      execute: async () => ({ success: true }),
      getTools: () => [],
    },
  },
});

// Mock llm_tools utils
mock.module('../../../llm_tools/utils', {
  namedExports: {
    getActionEntityLocatorInfo: async () => ({}),
    getFramePath: () => [],
  },
});

// --- Dynamic imports ---

const { runTaskLoop } = await import('../executor');

// --- Helpers ---

function createContext() {
  const page = {
    url: () => 'https://example.com',
    screenshot: async () => Buffer.from('fake'),
    evaluate: async () => ({}),
  } as any;

  const agentServices = {
    getModel: () => 'test-model',
    getFallbackModels: () => [],
    getDomServiceOptions: () => ({}),
    getInteractiveClassNames: () => [],
    getIframeFallbackDomains: () => [],
    getCurrentPage: async () => null,
    waitUntilStable: async () => {},
  } as any;

  return {
    page,
    agentServices,
    domService: {
      getClickableElements: async () => ({
        elementTree: { clickableElementsToString: () => 'empty' },
        selectorMap: new Map(),
      }),
      getClickableElementsWithScreenshot: async () => ({
        domState: {
          elementTree: { clickableElementsToString: () => 'empty' },
          selectorMap: new Map(),
        },
        screenshotBase64: '',
      }),
    } as any,
  };
}

// --- Tests ---

describe('runTaskLoop() maxSteps', () => {
  it('throws when maxSteps = 0', async () => {
    const context = createContext();

    await assert.rejects(
      () => runTaskLoop('Do something', context, { maxSteps: 0 }),
      { message: /maxSteps must be >= 1/ }
    );
  });

  it('throws when maxSteps = -1', async () => {
    const context = createContext();

    await assert.rejects(
      () => runTaskLoop('Do something', context, { maxSteps: -1 }),
      { message: /maxSteps must be >= 1/ }
    );
  });

  it('defaults to 15 when maxSteps is undefined', async () => {
    generateTextMock.mock.resetCalls();
    const context = createContext();

    // The mock returns a "done" response immediately, so the loop runs 1 step.
    const result = await runTaskLoop('Do something', context, {});

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.completed, true);
    assert.strictEqual(result.metadata.totalSteps, 1);
  });

  it('respects explicit maxSteps = 1', async () => {
    // Make the mock return a non-done action to test the loop limit
    const savedImpl = generateTextMock.mock.calls;
    generateTextMock.mock.mockImplementation(async () => ({
      text: JSON.stringify({
        thinking: 'working',
        current_goal: 'still working',
        actions: [
          {
            action_name: 'click',
            description: 'Click something',
            kwargs: { element_index: 0 },
          },
        ],
      }),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }));

    const context = createContext();
    const result = await runTaskLoop('Do something', context, { maxSteps: 1 });

    // Should hit the maxSteps limit without completing
    assert.strictEqual(result.completed, false);
    assert.strictEqual(result.metadata.totalSteps, 1);

    // Restore the "done" mock for subsequent tests
    generateTextMock.mock.restore();
  });
});
