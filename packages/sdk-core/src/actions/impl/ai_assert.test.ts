/**
 * Unit tests for ai_assert — verify `agent` is in scope for JS assertions (not just `agentServices`)
 *
 * Reproduces the bug where VERIFY js: code referencing `agent.agentServices.someMethod()`
 * fails because `executeJSAssertion` passes `agentServices` instead of `agent`.
 */

import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { AiAssertAction } from './ai_assert';
import { ActionEntity } from '../types';

// ---------------------------------------------------------------------------
// Helpers (same pattern as js_action.test.ts)
// ---------------------------------------------------------------------------

function makeMockPage() {
  return {
    goto: mock.fn(async () => {}),
    waitForTimeout: mock.fn(async () => {}),
    locator: mock.fn(() => ({
      textContent: mock.fn(async () => 'some text'),
    })),
  } as any;
}

function makeMockAgent() {
  const agent: any = {
    agentServices: {
      replaceVariables: (s: string) => s,
      readVariable: (name: string) => `mock-${name}`,
      saveVariable: mock.fn(),
      validatePage: (p: any) => p,
      addNote: mock.fn(),
      agent: null as any, // circular ref set below
    },
    execAction: mock.fn(async () => {}),
    step: mock.fn(async (_page: any, fn: () => Promise<any>) => fn()),
  };
  agent.agentServices.agent = agent;
  return agent;
}

function makeVerifyEntity(code: string, statement?: string): ActionEntity {
  return {
    action_description: statement || 'test assertion',
    action_data: {
      action_name: 'verify',
      kwargs: { code, ...(statement ? { statement } : {}) },
    },
  };
}

// ---------------------------------------------------------------------------
// AiAssertAction — JS assertion scope tests
// ---------------------------------------------------------------------------

describe('AiAssertAction.executeJSAssertion scope', () => {
  const action = new AiAssertAction();

  it('should have `agent` available in JS assertion scope', async () => {
    const page = makeMockPage();
    const agent = makeMockAgent();

    const entity = makeVerifyEntity(
      'if (!agent) throw new Error("agent not in scope");',
    );
    await action.execute(page, entity, agent.agentServices);
  });

  it('should have `agent.agentServices` accessible in JS assertion scope', async () => {
    const page = makeMockPage();
    const agent = makeMockAgent();

    const entity = makeVerifyEntity(
      'if (!agent.agentServices) throw new Error("agentServices not accessible via agent");',
    );
    await action.execute(page, entity, agent.agentServices);
  });

  it('should be able to call agent.agentServices.readVariable() in JS assertion', async () => {
    const page = makeMockPage();
    const agent = makeMockAgent();

    const entity = makeVerifyEntity(
      'const v = agent.agentServices.readVariable("foo"); if (v !== "mock-foo") throw new Error("wrong value: " + v);',
    );
    await action.execute(page, entity, agent.agentServices);
  });

  it('should have `page` available in JS assertion scope', async () => {
    const page = makeMockPage();
    const agent = makeMockAgent();

    const entity = makeVerifyEntity(
      'if (!page) throw new Error("page not in scope");',
    );
    await action.execute(page, entity, agent.agentServices);
  });

  it('should have `expect` available in JS assertion scope', async () => {
    const page = makeMockPage();
    const agent = makeMockAgent();

    const entity = makeVerifyEntity(
      'if (typeof expect !== "function") throw new Error("expect not in scope");',
    );
    await action.execute(page, entity, agent.agentServices);
  });
});
