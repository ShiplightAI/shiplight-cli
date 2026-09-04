/**
 * Unit tests for public Agent class maxSteps passthrough
 *
 * Uses mock.module to stub sdk-core and intercept WebAgent method calls.
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';

// --- Module-level mocks ---

const stepMock = mock.fn(async () => undefined);
const runMock = mock.fn(async () => ({
  success: true,
  details: 'done',
}));

// Mock sdk-core to intercept WebAgent construction and method calls
mock.module('sdk-core', {
  namedExports: {
    Agent: class MockWebAgent {
      step = stepMock;
      run = runMock;
      performAction = mock.fn(async () => ({ success: true }));
      assert = mock.fn(async () => true);
      evaluate = mock.fn(async () => true);
      extract = mock.fn(async () => {});
      // The public Agent.login() now delegates to sdk-core WebAgent.login()
      // (which builds the LoginConfig and calls loginPage internally).
      login = mock.fn(async () => true);
      loginPage = mock.fn(async () => ({ success: true }));
    },
    createAgentContext: () => ({
      model: 'test-model',
      variableStore: {
        has: () => false,
        set: () => {},
        get: () => undefined,
        getAll: () => ({}),
        getAllSensitiveKeys: () => new Set(),
      },
      executionHistory: [],
      tokenUsages: [],
      aiActionDetails: [],
    }),
    toolRegistry: {
      register: () => {},
    },
    LoginType: { PASSWORD: 'password' },
  },
});

// Mock shiplight-types VariableStore
mock.module('shiplight-types', {
  namedExports: {
    VariableStore: class MockVariableStore {
      set() {}
      get() { return undefined; }
      has() { return false; }
      getAll() { return {}; }
      getAllSensitiveKeys() { return new Set(); }
    },
    // Used by variableResolution.ts to resolve custom action arguments
    replaceVariables: (text: string) => text,
    TwoFactorAuthType: { TOTP: 'totp' },
  },
});

// --- Dynamic imports ---

const { Agent } = await import('../agent');

// --- Helpers ---

function createPageStub() {
  return {} as any;
}

// --- Tests ---

describe('Public Agent.step() maxSteps', () => {
  beforeEach(() => {
    stepMock.mock.resetCalls();
  });

  it('passes maxSteps=5 (default) when no options provided', async () => {
    const agent = new Agent({ model: 'test-model' });
    const page = createPageStub();

    await agent.step(page, async () => {}, 'Click button');

    assert.strictEqual(stepMock.mock.callCount(), 1);
    const args = stepMock.mock.calls[0].arguments;
    // step(page, action, description, stepId, stmtUid, canSelfHeal, maxSteps)
    const maxSteps = args[6]; // 7th argument
    assert.strictEqual(maxSteps, 5, 'should default to maxSteps=5');
  });

  it('passes maxSteps=3 when options.maxSteps=3', async () => {
    const agent = new Agent({ model: 'test-model' });
    const page = createPageStub();

    await agent.step(page, async () => {}, 'Click button', { maxSteps: 3 });

    assert.strictEqual(stepMock.mock.callCount(), 1);
    const args = stepMock.mock.calls[0].arguments;
    const maxSteps = args[6];
    assert.strictEqual(maxSteps, 3, 'should pass maxSteps=3');
  });

  it('passes maxSteps=1 when options.maxSteps=1', async () => {
    const agent = new Agent({ model: 'test-model' });
    const page = createPageStub();

    await agent.step(page, async () => {}, 'Click button', { maxSteps: 1 });

    assert.strictEqual(stepMock.mock.callCount(), 1);
    const args = stepMock.mock.calls[0].arguments;
    const maxSteps = args[6];
    assert.strictEqual(maxSteps, 1, 'should pass maxSteps=1');
  });
});

describe('Public Agent.run() maxSteps', () => {
  beforeEach(() => {
    runMock.mock.resetCalls();
  });

  it('passes undefined maxSteps when no options provided', async () => {
    const agent = new Agent({ model: 'test-model' });
    const page = createPageStub();

    await agent.run(page, 'Fill form');

    assert.strictEqual(runMock.mock.callCount(), 1);
    const args = runMock.mock.calls[0].arguments;
    // run(page, task, stepId, options)
    const options = args[3];
    assert.strictEqual(options.maxSteps, undefined, 'should pass undefined maxSteps by default');
  });

  it('passes maxSteps=10 when options.maxSteps=10', async () => {
    const agent = new Agent({ model: 'test-model' });
    const page = createPageStub();

    await agent.run(page, 'Fill form', { maxSteps: 10 });

    assert.strictEqual(runMock.mock.callCount(), 1);
    const args = runMock.mock.calls[0].arguments;
    const options = args[3];
    assert.strictEqual(options.maxSteps, 10, 'should pass maxSteps=10');
  });
});
