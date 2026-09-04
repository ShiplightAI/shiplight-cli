/**
 * WebAgent.step() records the two runtime facts an execution-scoped action-entity
 * cache metric needs:
 *
 *   - `stmtUid` — which YAML statement this step was. The transpiler knows which
 *     statements resolved from the cache but not which ones RAN; only steps that
 *     reach here ran, so this UID is the join key between the two.
 *   - `healFailed` — self-healing fired and did not recover the step. Without it a
 *     failed heal leaves no trace at all (no healed entity is produced), and the
 *     statement stays indistinguishable from one whose entity simply worked.
 *
 * Mock setup mirrors webAgent.maxSteps.test.ts.
 */

import assert from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, mock, beforeEach } from 'node:test';
import type { Page } from 'playwright';
import type { StepExecutionResult } from '../../core/types';

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

const { WebAgent } = await import('../webAgent');
const { VariableStore } = await import('shiplight-types');

// --- Helpers ---

interface AgentInternals {
  context: {
    stepTracking?: {
      results: Record<string, StepExecutionResult>;
      artifactsDir?: string;
    };
  };
}

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

/** An agent with step tracking on — the only mode in which these fields are recorded. */
function createTrackingAgent(): { agent: InstanceType<typeof WebAgent>; results: Record<string, StepExecutionResult> } {
  const agent = new WebAgent({
    model: 'test-model',
    variableStore: new VariableStore(),
    executionHistory: [],
    tokenUsages: [],
    aiActionDetails: [],
  });
  const results: Record<string, StepExecutionResult> = {};
  (agent as unknown as AgentInternals).context.stepTracking = { results };
  return { agent, results };
}

// --- Tests ---

describe('WebAgent.step() statement UID recording', () => {
  beforeEach(() => {
    executeStepMock.mock.resetCalls();
    runTaskMock.mock.resetCalls();
  });

  it('stamps the statement UID on a step that succeeded', async () => {
    const { agent, results } = createTrackingAgent();

    await agent.step(createPageStub(), async () => 'ok', 'Click Save', 'main.0', 'stmt-abc');

    assert.strictEqual(results['main.0'].stmtUid, 'stmt-abc');
  });

  it('replaces the main step screenshot when a JS assertion requests a post-assertion capture', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'shiplight-js-assertion-'));
    try {
      const { agent, results } = createTrackingAgent();
      (agent as unknown as AgentInternals).context.stepTracking!.artifactsDir = tempDir;
      let screenshotCount = 0;
      const page = {
        ...createPageStub(),
        screenshot: async (options: { path?: string }) => {
          screenshotCount += 1;
          if (options.path) {
            await writeFile(options.path, screenshotCount === 1 ? 'before' : 'after');
          }
          return Buffer.from('');
        },
      } as unknown as Page;

      await agent.step(page, async () => {
        await agent.replaceStepScreenshot(page, 'main.0');
      }, 'Verify heading', 'main.0', undefined, false);

      assert.strictEqual(screenshotCount, 2);
      assert.ok(results['main.0'].screenshot);
      assert.strictEqual(await readFile(results['main.0'].screenshot!, 'utf8'), 'after');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('records runtime variable values in the reported step description', async () => {
    const { agent, results } = createTrackingAgent();
    agent.agentServices.saveVariable('tab_name', '数据明细');

    await agent.step(
      createPageStub(),
      async () => 'ok',
      '切换到数据Tab"{{tab_name}}"',
      'main.0',
    );

    assert.strictEqual(results['main.0'].description, '切换到数据Tab"数据明细"');
  });

  it('preserves sensitive placeholders in the reported step description', async () => {
    const { agent, results } = createTrackingAgent();
    agent.agentServices.addSensitive('password', 'do-not-leak');

    await agent.step(
      createPageStub(),
      async () => 'ok',
      'Use password {{password}}',
      'main.0',
    );

    assert.strictEqual(results['main.0'].description, 'Use password {{password}}');
  });

  it('stamps the statement UID on a step that failed', async () => {
    // The UID must survive the failure path too: a statement that ran and broke is
    // exactly the one the cache metric needs to account for.
    executeStepMock.mock.mockImplementationOnce(async () => { throw new Error('heal blew up'); });
    const { agent, results } = createTrackingAgent();

    await assert.rejects(() => agent.step(
      createPageStub(),
      async () => { throw new Error('element not found: #save'); },
      'Click Save',
      'main.0',
      'stmt-abc',
    ));

    assert.strictEqual(results['main.0'].stmtUid, 'stmt-abc');
  });

  it('leaves stmtUid unset when the caller has no statement behind the step', async () => {
    // Hand-written agent.step() calls in TS tests pass no UID. They must not be
    // counted as YAML statements the cache could have served.
    const { agent, results } = createTrackingAgent();

    await agent.step(createPageStub(), async () => 'ok', 'Click Save', 'main.0');

    assert.strictEqual(results['main.0'].stmtUid, undefined);
  });

  it('re-stamps the UID when a step id repeats, as a WHILE body does', async () => {
    // createStepResult returns early for a step id it has already seen, so stamping
    // inside it would leave the second iteration unstamped. The two calls must pass
    // DIFFERENT UIDs for this to prove anything: with the same UID the first stamp
    // already satisfies the assertion and the regression ships green.
    const { agent, results } = createTrackingAgent();

    await agent.step(createPageStub(), async () => 'ok', 'Click Save', 'main.0', 'stmt-first');
    await agent.step(createPageStub(), async () => 'ok', 'Click Save', 'main.0', 'stmt-second');

    assert.strictEqual(results['main.0'].stmtUid, 'stmt-second');
  });
});

describe('WebAgent.step() failed self-heal recording', () => {
  beforeEach(() => {
    executeStepMock.mock.resetCalls();
    runTaskMock.mock.resetCalls();
  });

  it('marks healFailed when self-healing ran and did not recover the step', async () => {
    executeStepMock.mock.mockImplementationOnce(async () => { throw new Error('could not locate the Save button'); });
    const { agent, results } = createTrackingAgent();

    await assert.rejects(() => agent.step(
      createPageStub(),
      async () => { throw new Error('element not found: #save'); },
      'Click Save',
      'main.0',
      'stmt-abc',
    ));

    assert.strictEqual(results['main.0'].healFailed, true);
    assert.notStrictEqual(results['main.0'].autoHealed, true, 'a failed heal must not read as healed');
  });

  it('marks healFailed when self-healing returns an unsuccessful result', async () => {
    // The other way a heal loses: execute() resolves but reports failure.
    executeStepMock.mock.mockImplementationOnce(async () => ({
      status: 'success' as const,
      completed: false,
      actionEntities: [{ action_description: 'test', action_data: { action_name: 'click', kwargs: {} } }],
      explanation: 'Partial progress only',
    }));
    const { agent, results } = createTrackingAgent();

    await assert.rejects(() => agent.step(
      createPageStub(),
      async () => { throw new Error('element not found: #save'); },
      'Click Save',
      'main.0',
      'stmt-abc',
    ));

    assert.strictEqual(results['main.0'].healFailed, true);
  });

  it('marks autoHealed and NOT healFailed when self-healing recovers the step', async () => {
    const { agent, results } = createTrackingAgent();

    await agent.step(
      createPageStub(),
      // Fails once, so self-healing runs; the mocked executeStep then succeeds.
      (() => {
        let called = false;
        return async () => {
          if (!called) { called = true; throw new Error('element not found: #save'); }
          return 'ok';
        };
      })(),
      'Click Save',
      'main.0',
      'stmt-abc',
    );

    assert.strictEqual(results['main.0'].autoHealed, true);
    assert.notStrictEqual(results['main.0'].healFailed, true);
  });

  it('marks autoHealed, not healFailed, when the heal worked but post-heal bookkeeping threw', async () => {
    // The catch that stamps healFailed wraps far more than the model call: the
    // post-heal page.url() / DOM snapshot throw if the healed action closed the
    // page. The heal itself succeeded and its entity was already written to
    // _newActionEntities, so recording a failed heal would contradict the cache
    // summary, which counts that same statement as healed.
    const { agent, results } = createTrackingAgent();
    let healed = false;
    const page = createPageStub();
    (page as unknown as { url: () => string }).url = () => {
      if (healed) throw new Error('Target page, context or browser has been closed');
      return 'https://example.com';
    };
    executeStepMock.mock.mockImplementationOnce(async () => {
      healed = true;
      return {
        status: 'success' as const,
        completed: true,
        actionEntities: [{ action_description: 'test', action_data: { action_name: 'click', kwargs: {} } }],
        explanation: 'done',
      };
    });

    await assert.rejects(() => agent.step(
      page,
      async () => { throw new Error('element not found: #save'); },
      'Click Save',
      'main.0',
      'stmt-abc',
    ));

    assert.strictEqual(results['main.0'].autoHealed, true);
    assert.notStrictEqual(results['main.0'].healFailed, true);
  });

  it('does not mark healFailed when no heal was attempted', async () => {
    // canSelfHeal:false — the action failed, but the model was never called, so this
    // is not an auto-heal that fired and lost.
    const { agent, results } = createTrackingAgent();

    await assert.rejects(() => agent.step(
      createPageStub(),
      async () => { throw new Error('element not found: #save'); },
      'Click Save',
      'main.0',
      'stmt-abc',
      false,
    ));

    assert.strictEqual(results['main.0'].healFailed, undefined);
    assert.strictEqual(executeStepMock.mock.callCount(), 0, 'no model call may have happened');
  });
});
