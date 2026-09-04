/**
 * Unit tests for WebAgent.waitForJs — the step-tracking wrapper around
 * agentWait.waitForJs. Mocks agentWait.waitForJs so we can drive met=true
 * (success), met=false (timeout, no throw), and throw, and assert the
 * resulting step status. A WAIT_UNTIL synchronizes but never fails the test,
 * so the met=false → 'warning' translation is the wrapper's own logic (the
 * primitive resolves rather than throwing on timeout). The real
 * formatJsWaitOutcome is kept in the mock so message wording is covered too.
 *
 * Uses the same module-mock scaffolding as webAgent.maxSteps.test.ts to keep
 * WebAgent's import chain (dom ?raw assets, browser modules) out of the test.
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';
import { formatJsWaitOutcome, JsWaitResult } from '../agentWait';

function jsWaitResult(overrides: Partial<JsWaitResult>): JsWaitResult {
  return { met: false, evalCount: 1, errorCount: 0, elapsedMs: 100, ...overrides };
}

const waitForJsMock = mock.fn(async (): Promise<JsWaitResult> => jsWaitResult({ met: true }));

mock.module('../agentHelpers', {
  namedExports: {
    executeStep: mock.fn(),
    runTask: mock.fn(),
    evaluateStatement: mock.fn(),
    generateActionStep: mock.fn(),
  },
});

mock.module('../../dom', {
  namedExports: {
    DomService: class MockDomService {},
    HistoryTreeProcessor: class {},
  },
});

mock.module('../agentWait', {
  namedExports: {
    waitUntilStable: async () => {},
    waitUntilCondition: async () => true,
    waitForJs: waitForJsMock,
    formatJsWaitOutcome,
  },
});

mock.module('../../browser/browserUtils', {
  namedExports: {
    waitForPageAndFramesLoad: async () => {},
    getBrowserCdpUrl: async () => '',
    getPageInfo: async () => ({}),
    getPageWsUrl: () => '',
    newBrowserContext: async () => ({}),
    setWindowBounds: async () => {},
  },
});

mock.module('../../browser/tabManager', {
  namedExports: {
    TabManager: class MockTabManager {
      getCurrentPage() {
        return null;
      }
    },
  },
});

const { WebAgent } = await import('../webAgent');
const { VariableStore } = await import('shiplight-types');

function createPageStub() {
  const page = {
    url: () => 'https://example.com',
    screenshot: async () => Buffer.from(''),
    evaluate: async () => ({}),
    isClosed: () => false,
    context: () => ({ storageState: async () => ({}), pages: () => [page] }),
    on: () => {},
    waitForTimeout: async () => {},
  } as never;
  return page;
}

function createAgentWithStepTracking() {
  const variableStore = new VariableStore();
  const stepTracking = {
    results: {} as Record<string, { status?: string; message?: string; description?: string }>,
  };
  const context = {
    model: 'test-model',
    variableStore,
    executionHistory: [],
    tokenUsages: [],
    aiActionDetails: [],
    stepTracking,
  } as never;
  return { agent: new WebAgent(context), stepTracking };
}

describe('WebAgent.waitForJs step tracking', () => {
  beforeEach(() => {
    waitForJsMock.mock.resetCalls();
  });

  it('marks the step success when the condition is met', async () => {
    waitForJsMock.mock.mockImplementationOnce(async () =>
      jsWaitResult({ met: true, evalCount: 3, elapsedMs: 700 }),
    );
    const { agent, stepTracking } = createAgentWithStepTracking();

    const met = await agent.waitForJs(createPageStub(), () => true, 5, 'step-1');

    assert.equal(met, true);
    assert.equal(stepTracking.results['step-1'].status, 'success');
    assert.match(stepTracking.results['step-1'].message ?? '', /Condition met after 0\.7s/);
  });

  it('marks the step warning on timeout (met=false, no throw)', async () => {
    waitForJsMock.mock.mockImplementationOnce(async () =>
      jsWaitResult({ met: false, evalCount: 20, elapsedMs: 5000 }),
    );
    const { agent, stepTracking } = createAgentWithStepTracking();

    const met = await agent.waitForJs(createPageStub(), () => false, 5, 'step-2');

    assert.equal(met, false);
    assert.equal(stepTracking.results['step-2'].status, 'warning');
    assert.match(stepTracking.results['step-2'].message ?? '', /Condition not met within .* — continuing/);
  });

  it('marks the step warning with the error when the predicate never evaluated cleanly', async () => {
    waitForJsMock.mock.mockImplementationOnce(async () =>
      jsWaitResult({
        met: false,
        evalCount: 20,
        errorCount: 20,
        lastError: 'document is not defined',
        elapsedMs: 5000,
      }),
    );
    const { agent, stepTracking } = createAgentWithStepTracking();

    const met = await agent.waitForJs(createPageStub(), () => false, 5, 'step-2b');

    assert.equal(met, false);
    assert.equal(stepTracking.results['step-2b'].status, 'warning');
    assert.match(
      stepTracking.results['step-2b'].message ?? '',
      /never evaluated successfully.*document is not defined/,
    );
  });

  it('marks the step failure and rethrows when the wait throws', async () => {
    waitForJsMock.mock.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const { agent, stepTracking } = createAgentWithStepTracking();

    await assert.rejects(
      agent.waitForJs(createPageStub(), () => true, 5, 'step-3'),
      /boom/,
    );
    assert.equal(stepTracking.results['step-3'].status, 'failure');
  });

  it('labels the step with the intent when a description is passed', async () => {
    waitForJsMock.mock.mockImplementationOnce(async () => jsWaitResult({ met: true }));
    const { agent, stepTracking } = createAgentWithStepTracking();

    await agent.waitForJs(
      createPageStub(),
      () => true,
      5,
      'step-4',
      'The dashboard has finished loading',
    );

    assert.equal(stepTracking.results['step-4'].description, 'The dashboard has finished loading');
  });

  it('defaults the step label when no description is passed', async () => {
    waitForJsMock.mock.mockImplementationOnce(async () => jsWaitResult({ met: true }));
    const { agent, stepTracking } = createAgentWithStepTracking();

    await agent.waitForJs(createPageStub(), () => true, 5, 'step-5');

    assert.equal(stepTracking.results['step-5'].description, 'Wait for JS condition');
  });

  it('does not create a step result when no stepId is passed', async () => {
    waitForJsMock.mock.mockImplementationOnce(async () => jsWaitResult({ met: true }));
    const { agent, stepTracking } = createAgentWithStepTracking();

    const met = await agent.waitForJs(createPageStub(), () => true, 5);

    assert.equal(met, true);
    assert.deepEqual(stepTracking.results, {});
  });
});
