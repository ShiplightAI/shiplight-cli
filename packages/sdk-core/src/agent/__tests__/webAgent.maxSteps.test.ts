/**
 * Unit tests for WebAgent maxSteps behavior in execute() and step()
 *
 * Uses mock.module to intercept agentHelpers (prevents real LLM calls)
 * and the dom module (prevents ?raw import that fails outside bundlers).
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';

// --- Module-level mocks (must be set up before dynamic imports) ---

const executeStepMock = mock.fn(async () => ({
  status: 'success' as const,
  completed: true,
  actionEntities: [{ action_description: 'test', action_data: { action_name: 'click', kwargs: {} } }],
  explanation: 'done',
}));

const runTaskMock = mock.fn(async () => ({
  status: 'success' as const,
  completed: true,
  actionEntities: [{ action_description: 'test', action_data: { action_name: 'click', kwargs: {} } }],
  explanation: 'done',
  tokenUsages: [],
}));

// Mock agentHelpers to prevent LLM calls
mock.module('../agentHelpers', {
  namedExports: {
    executeStep: executeStepMock,
    runTask: runTaskMock,
    evaluateStatement: mock.fn(),
    generateActionStep: mock.fn(),
  },
});

// Mock the dom module to prevent ?raw import chain
mock.module('../../dom', {
  namedExports: {
    DomService: class MockDomService {},
    HistoryTreeProcessor: class {},
  },
});

// Mock agentWait to prevent browser dependency
mock.module('../agentWait', {
  namedExports: {
    waitUntilStable: async () => {},
    waitUntilCondition: async () => true,
  },
});

// Mock browserUtils to prevent real browser calls in AgentServices
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

// Mock tabManager
mock.module('../../browser/tabManager', {
  namedExports: {
    TabManager: class MockTabManager {
      getCurrentPage() { return null; }
    },
  },
});

// --- Dynamic imports (after mocks are set up) ---

const { WebAgent } = await import('../webAgent');
const { VariableStore } = await import('shiplight-types');

// --- Helpers ---

function createPageStub() {
  const page = {
    url: () => 'https://example.com',
    screenshot: async () => Buffer.from(''),
    evaluate: async () => ({}),
    isClosed: () => false,
    context: () => ({ storageState: async () => ({}), pages: () => [page] }),
    on: () => {},
  } as any;
  return page;
}

function createAgent() {
  const variableStore = new VariableStore();
  const context = {
    model: 'test-model',
    variableStore,
    executionHistory: [],
    tokenUsages: [],
    aiActionDetails: [],
  };
  return new WebAgent(context);
}

// --- Tests ---

describe('WebAgent.execute() maxSteps', () => {
  beforeEach(() => {
    executeStepMock.mock.resetCalls();
    runTaskMock.mock.resetCalls();
  });

  it('throws when maxSteps = 0', async () => {
    const agent = createAgent();
    const page = createPageStub();

    await assert.rejects(
      () => agent.execute(page, 'Click button', undefined, false, 0),
      { message: /maxSteps must be >= 1/ }
    );
  });

  it('throws when maxSteps = -1', async () => {
    const agent = createAgent();
    const page = createPageStub();

    await assert.rejects(
      () => agent.execute(page, 'Click button', undefined, false, -1),
      { message: /maxSteps must be >= 1/ }
    );
  });

  it('calls single-step path when maxSteps is undefined', async () => {
    const agent = createAgent();
    const page = createPageStub();

    await agent.execute(page, 'Click button', undefined, false, undefined);

    assert.strictEqual(executeStepMock.mock.callCount(), 1, 'should call executeStep');
    assert.strictEqual(runTaskMock.mock.callCount(), 0, 'should not call runTask');
  });

  it('calls single-step path when maxSteps = 1', async () => {
    const agent = createAgent();
    const page = createPageStub();

    await agent.execute(page, 'Click button', undefined, false, 1);

    assert.strictEqual(executeStepMock.mock.callCount(), 1, 'should call executeStep');
    assert.strictEqual(runTaskMock.mock.callCount(), 0, 'should not call runTask');
  });

  it('fails when single-step action is valid but completed=false', async () => {
    executeStepMock.mock.mockImplementationOnce(async () => ({
      status: 'success' as const,
      completed: false,
      actionEntities: [{ action_description: 'test', action_data: { action_name: 'click', kwargs: {} } }],
      explanation: 'Partial progress only',
    }));

    const agent = createAgent();
    const page = createPageStub();

    await assert.rejects(
      () => agent.execute(page, 'Click button', undefined, false, 1),
      /Action failed: Partial progress only/,
    );

    assert.strictEqual(executeStepMock.mock.callCount(), 1, 'should call executeStep');
    assert.strictEqual(runTaskMock.mock.callCount(), 0, 'should not call runTask');
  });

  it('calls multi-step path when maxSteps = 2', async () => {
    const agent = createAgent();
    const page = createPageStub();

    await agent.execute(page, 'Fill form and submit', undefined, false, 2);

    assert.strictEqual(executeStepMock.mock.callCount(), 0, 'should not call executeStep');
    assert.strictEqual(runTaskMock.mock.callCount(), 1, 'should call runTask');
  });

  it('passes maxSteps to runTask when maxSteps = 10', async () => {
    const agent = createAgent();
    const page = createPageStub();

    await agent.execute(page, 'Fill form and submit', undefined, false, 10);

    assert.strictEqual(runTaskMock.mock.callCount(), 1, 'should call runTask');
    // runTask signature: (task, page, agentServices, onEvent, options)
    const callArgs = runTaskMock.mock.calls[0].arguments;
    const options = callArgs[4]; // 5th arg = options
    assert.strictEqual(options.maxSteps, 10, 'should pass maxSteps=10 to runTask');
  });
});

describe('WebAgent.step() self-healing maxSteps', () => {
  beforeEach(() => {
    executeStepMock.mock.resetCalls();
    runTaskMock.mock.resetCalls();
  });

  it('returns result directly when fn succeeds (no self-healing)', async () => {
    const agent = createAgent();
    const page = createPageStub();

    const result = await agent.step(
      page,
      async () => 'ok',
      'Click button',
      'step-1',
      undefined,
      true,
      undefined
    );

    assert.strictEqual(result, 'ok');
    assert.strictEqual(executeStepMock.mock.callCount(), 0, 'should not call executeStep');
    assert.strictEqual(runTaskMock.mock.callCount(), 0, 'should not call runTask');
  });

  it('uses the runtime-resolved description throughout step execution', async () => {
    const agent = createAgent();
    const page = createPageStub();
    agent.agentServices.saveVariable('tab_name', '数据明细');

    await agent.step(
      page,
      async () => { throw new Error('not found'); },
      '切换到数据Tab"{{tab_name}}"',
      'step-runtime-description',
    );

    assert.strictEqual(
      executeStepMock.mock.calls[0].arguments[0],
      '切换到数据Tab"数据明细"',
    );
  });

  it('throws without calling execute when canSelfHeal=false', async () => {
    const agent = createAgent();
    const page = createPageStub();

    await assert.rejects(
      () => agent.step(
        page,
        async () => { throw new Error('element not found'); },
        'Click button',
        'step-2',
        undefined,
        false, // canSelfHeal = false
        undefined
      ),
      { message: /element not found/ }
    );

    assert.strictEqual(executeStepMock.mock.callCount(), 0, 'should not call executeStep');
  });

  it('calls execute with effectiveMaxSteps=1 when maxSteps is undefined', async () => {
    const agent = createAgent();
    const page = createPageStub();

    // The step will fail, triggering self-healing which calls execute()
    await agent.step(
      page,
      async () => { throw new Error('not found'); },
      'Click button',
      'step-3',
      undefined,
      true,
      undefined // maxSteps undefined -> defaults to MAX_SELF_HEALING_STEPS (1)
    );

    // execute() is called internally which dispatches to executeStep or runTask.
    // With maxSteps=1, it should go to executeStep (single-step path).
    assert.strictEqual(executeStepMock.mock.callCount(), 1, 'should call executeStep for single-step self-healing');
    assert.strictEqual(runTaskMock.mock.callCount(), 0, 'should not call runTask');
  });

  it('calls execute with effectiveMaxSteps=3 when maxSteps=3', async () => {
    const agent = createAgent();
    const page = createPageStub();

    await agent.step(
      page,
      async () => { throw new Error('not found'); },
      'Click button',
      'step-4',
      undefined,
      true,
      3 // explicit maxSteps=3
    );

    assert.strictEqual(runTaskMock.mock.callCount(), 1, 'should call runTask');
    const callArgs = runTaskMock.mock.calls[0].arguments;
    const options = callArgs[4];
    assert.strictEqual(options.maxSteps, 3, 'should pass maxSteps=3');
  });

  it('calls single-step execute when maxSteps=1', async () => {
    const agent = createAgent();
    const page = createPageStub();

    await agent.step(
      page,
      async () => { throw new Error('not found'); },
      'Click button',
      'step-5',
      undefined,
      true,
      1 // maxSteps=1 -> single-step self-healing
    );

    // maxSteps=1 in execute() goes to single-step path (executeStep)
    assert.strictEqual(executeStepMock.mock.callCount(), 1, 'should call executeStep for single-step self-healing');
    assert.strictEqual(runTaskMock.mock.callCount(), 0, 'should not call runTask');
  });
});
