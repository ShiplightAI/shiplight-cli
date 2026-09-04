/**
 * Regression tests for issue #2209 — when self-healing fails, WebAgent.step()
 * used to `throw healError` and drop the original action error entirely.
 *
 * That is how a navigation failure got reported as
 * `AI_InvalidArgumentError: baseURL must be a non-empty string`: the message is
 * about the *LLM client's* baseURL, an unrelated setting, and it happens to be
 * worded almost identically to the Playwright error for a relative URL with no
 * `test.use({ baseURL })`. With the original error gone, the only thing left in
 * the output pointed at AI provider config instead of the test's own navigation.
 *
 * Mock setup mirrors webAgent.maxSteps.test.ts.
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';
import type { Page } from 'playwright';

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

mock.module('../agentHelpers', {
  namedExports: {
    executeStep: executeStepMock,
    runTask: runTaskMock,
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
      getCurrentPage() { return null; }
    },
  },
});

// --- Dynamic imports (after mocks are set up) ---

const { WebAgent, buildSelfHealFailureError } = await import('../webAgent');
const { LLMProviderNotConfiguredError } = await import('../llm/errors');
const { VariableStore } = await import('shiplight-types');

// --- Helpers ---

/** The slice of the state-transition record these tests read back. */
interface RecordedTransition {
  type: string;
  status?: string;
  errorMessage?: string;
}

/** The private surface these tests reach into to observe step tracking. */
interface AgentInternals {
  context: {
    stepTracking?: {
      results: Record<string, unknown>;
      artifactsDir: string;
      captureStateTransitions?: boolean;
      stateTransitions?: RecordedTransition[];
    };
  };
}

/**
 * Minimal Page stand-in — only the handful of methods WebAgent.step() touches.
 * Cast through `unknown` rather than `any` so the object literal above is still
 * type-checked; widening to Page is the single deliberate unsound step.
 */
function createPageStub(): Page {
  const page = {
    url: () => 'https://example.com',
    screenshot: async () => Buffer.from(''),
    evaluate: async () => ({}),
    isClosed: () => false,
    context: () => ({ storageState: async () => ({}), pages: () => [page] }),
    on: () => {},
  };
  return page as unknown as Page;
}

function createAgent() {
  return new WebAgent({
    model: 'test-model',
    variableStore: new VariableStore(),
    executionHistory: [],
    tokenUsages: [],
    aiActionDetails: [],
  });
}

/** The exact shape the AI SDK throws when the LLM client has no baseURL. */
function providerConfigError(): Error {
  const err = new Error('baseURL must be a non-empty string');
  err.name = 'AI_InvalidArgumentError';
  return err;
}

// --- Tests ---

describe('WebAgent.step() error reporting when self-healing fails', () => {
  beforeEach(() => {
    executeStepMock.mock.resetCalls();
    runTaskMock.mock.resetCalls();
  });

  it('reports the original action error, not just the self-heal error', async () => {
    executeStepMock.mock.mockImplementationOnce(async () => { throw providerConfigError(); });

    const agent = createAgent();

    await assert.rejects(
      () => agent.step(
        createPageStub(),
        async () => { throw new Error('page.goto: Invalid URL "/"'); },
        'Navigate to /',
        'beforeEach.0',
        undefined,
        true,
        undefined,
      ),
      (err: Error) => {
        assert.match(err.message, /page\.goto: Invalid URL "\/"/, 'original action error must survive');
        return true;
      },
    );
  });

  it('also reports why self-healing could not run', async () => {
    executeStepMock.mock.mockImplementationOnce(async () => { throw providerConfigError(); });

    const agent = createAgent();

    await assert.rejects(
      () => agent.step(
        createPageStub(),
        async () => { throw new Error('page.goto: Invalid URL "/"'); },
        'Navigate to /',
        'beforeEach.0',
        undefined,
        true,
        undefined,
      ),
      (err: Error) => {
        assert.match(err.message, /self-heal/i, 'must say the self-heal attempt is the secondary failure');
        assert.match(err.message, /baseURL must be a non-empty string/, 'must keep the self-heal error text');
        return true;
      },
    );
  });

  it('names the AI provider as the unconfigured subsystem, not the test', async () => {
    executeStepMock.mock.mockImplementationOnce(async () => { throw providerConfigError(); });

    const agent = createAgent();

    await assert.rejects(
      () => agent.step(
        createPageStub(),
        async () => { throw new Error('page.goto: Invalid URL "/"'); },
        'Navigate to /',
        'beforeEach.0',
        undefined,
        true,
        undefined,
      ),
      (err: Error) => {
        assert.match(
          err.message,
          /AI (self-heal|provider)[^\n]*(unavailable|not configured)/i,
          'must attribute the failure to AI provider config',
        );
        return true;
      },
    );
  });

  it('keeps the original error reachable as `cause`', async () => {
    executeStepMock.mock.mockImplementationOnce(async () => { throw providerConfigError(); });

    const agent = createAgent();

    await assert.rejects(
      () => agent.step(
        createPageStub(),
        async () => { throw new Error('page.goto: Invalid URL "/"'); },
        'Navigate to /',
        'beforeEach.0',
        undefined,
        true,
        undefined,
      ),
      (err: Error) => {
        assert.ok(err.cause instanceof Error, 'cause must be the original action error');
        assert.match((err.cause as Error).message, /page\.goto: Invalid URL "\/"/);
        return true;
      },
    );
  });

  it('does not add AI-provider wording when self-healing fails for an ordinary reason', async () => {
    executeStepMock.mock.mockImplementationOnce(async () => {
      throw new Error('Action failed: could not locate the Save button');
    });

    const agent = createAgent();

    await assert.rejects(
      () => agent.step(
        createPageStub(),
        async () => { throw new Error('element not found: #save'); },
        'Click Save',
        'main.0',
        undefined,
        true,
        undefined,
      ),
      (err: Error) => {
        assert.match(err.message, /element not found: #save/, 'original error must survive');
        assert.match(err.message, /could not locate the Save button/, 'heal error must survive');
        assert.doesNotMatch(err.message, /not configured|unavailable/i);
        return true;
      },
    );
  });
});

describe('WebAgent.step() state-transition record on self-heal failure', () => {
  beforeEach(() => {
    executeStepMock.mock.resetCalls();
    runTaskMock.mock.resetCalls();
  });

  it('records both errors, so the report and debugger do not show only the self-heal error', async () => {
    executeStepMock.mock.mockImplementationOnce(async () => { throw providerConfigError(); });

    const agent = createAgent();
    const internals = agent as unknown as AgentInternals;
    internals.context.stepTracking = {
      results: {},
      artifactsDir: '/tmp',
      captureStateTransitions: true,
      stateTransitions: [],
    };

    await assert.rejects(() => agent.step(
      createPageStub(),
      async () => { throw new Error('page.goto: Invalid URL "/"'); },
      'Navigate to /',
      'beforeEach.0',
      undefined,
      true,
      undefined,
    ));

    const transitions = internals.context.stepTracking?.stateTransitions ?? [];
    const failedAction = transitions.find((t) => t.type === 'action' && t.status === 'failure');
    assert.ok(failedAction, 'a failed action entry must be recorded');
    assert.match(failedAction!.errorMessage!, /page\.goto: Invalid URL "\/"/, 'must record the original error');
    assert.match(failedAction!.errorMessage!, /baseURL must be a non-empty string/, 'must record the heal error too');
  });
});

describe('buildSelfHealFailureError', () => {
  it('does not double the "Self-healing failed" prefix', () => {
    // execute() throws `Self-healing failed: <details>` on an unsuccessful
    // result; wrapping that produced "Self-healing also failed: Self-healing
    // failed: <details>".
    const combined = buildSelfHealFailureError(
      new Error('element not found: #save'),
      new Error('Self-healing failed: could not locate the Save button'),
    );

    assert.match(combined.message, /could not locate the Save button/);
    assert.doesNotMatch(combined.message, /Self-healing (also )?failed:.*[Ss]elf-healing failed:/);
  });

  it('recognizes the providers\' own not-configured error', () => {
    const combined = buildSelfHealFailureError(
      new Error('page.goto: Invalid URL "/"'),
      new LLMProviderNotConfiguredError(
        'Google API key is missing. Set GOOGLE_API_KEY in SDK config or environment.',
      ),
    );

    assert.match(combined.message, /AI self-heal unavailable/i);
    assert.match(combined.message, /GOOGLE_API_KEY/);
  });

  it('keeps the full message in the stack, so non-Playwright consumers see the guidance', () => {
    const original = new Error('page.goto: Invalid URL "/"');
    const combined = buildSelfHealFailureError(original, new Error('heal blew up'));

    assert.ok(combined.stack, 'must have a stack');
    assert.match(combined.stack!, /page\.goto: Invalid URL/, 'stack must carry the original message');
    assert.match(combined.stack!, /heal blew up/, 'stack must carry the self-heal message too');
  });

  it('keeps the original error\'s stack frames', () => {
    const original = new Error('page.goto: Invalid URL "/"');
    original.stack = 'Error: page.goto: Invalid URL "/"\n    at theOriginalFrame (repro.spec.ts:7:3)';

    const combined = buildSelfHealFailureError(original, new Error('heal blew up'));

    assert.match(combined.stack!, /at theOriginalFrame \(repro\.spec\.ts:7:3\)/);
  });

  it('tolerates a non-Error original with no stack', () => {
    const combined = buildSelfHealFailureError('plain string failure', new Error('heal blew up'));

    assert.match(combined.message, /plain string failure/);
    assert.match(combined.message, /heal blew up/);
  });
});
