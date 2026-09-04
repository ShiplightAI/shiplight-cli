/**
 * Unit tests for js_action and js_code — verify `agent` is in scope (not just `agentServices`)
 */

import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { JsAction } from '../impl/js_action';
import { JsCodeAction } from '../impl/js_code';
import { ActionEntity } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockPage() {
  return {
    goto: mock.fn(async () => {}),
    waitForTimeout: mock.fn(async () => {}),
  } as any;
}

function makeMockAgent() {
  const agent: any = {
    agentServices: {
      replaceVariables: (s: string) => s,
      readVariable: (name: string) => `mock-${name}`,
      saveVariable: mock.fn(),
      validatePage: (p: any) => p,
      agent: null as any, // circular ref set below
    },
    execAction: mock.fn(async () => {}),
    step: mock.fn(async (_page: any, fn: () => Promise<any>) => fn()),
  };
  agent.agentServices.agent = agent;
  return agent;
}

function makeEntity(code: string): ActionEntity {
  return {
    action_description: 'test',
    action_data: { action_name: 'js_action', kwargs: { code } },
  };
}

// ---------------------------------------------------------------------------
// JsAction
// ---------------------------------------------------------------------------

describe('JsAction.execute', () => {
  const action = new JsAction();

  it('should have `agent` available in scope', async () => {
    const page = makeMockPage();
    const agent = makeMockAgent();

    // Code that accesses agent — should not throw
    const entity = makeEntity('const a = agent; if (!a) throw new Error("agent not in scope");');
    await action.execute(page, entity, agent.agentServices);
  });

  it('should have `agent.agentServices` accessible', async () => {
    const page = makeMockPage();
    const agent = makeMockAgent();

    const entity = makeEntity('if (!agent.agentServices) throw new Error("agentServices not accessible");');
    await action.execute(page, entity, agent.agentServices);
  });

  it('should have `page` available in scope', async () => {
    const page = makeMockPage();
    const agent = makeMockAgent();

    const entity = makeEntity('if (!page) throw new Error("page not in scope");');
    await action.execute(page, entity, agent.agentServices);
  });

  it('should be able to call agent.agentServices.readVariable()', async () => {
    const page = makeMockPage();
    const agent = makeMockAgent();

    const entity = makeEntity('const v = agent.agentServices.readVariable("foo"); if (v !== "mock-foo") throw new Error("wrong value: " + v);');
    await action.execute(page, entity, agent.agentServices);
  });

  it('should throw when agent is not set on agentServices', async () => {
    const page = makeMockPage();
    const agentServices = { agent: null } as any;
    const entity = makeEntity('return 1;');

    await assert.rejects(
      () => action.execute(page, entity, agentServices),
      /Agent not initialized/
    );
  });

  it('should throw when code is missing', async () => {
    const page = makeMockPage();
    const agent = makeMockAgent();
    const entity: ActionEntity = {
      action_description: 'test',
      action_data: { action_name: 'js_action', kwargs: {} },
    };

    await assert.rejects(
      () => action.execute(page, entity, agent.agentServices),
      /Missing code/
    );
  });
});

// ---------------------------------------------------------------------------
// JsCodeAction
// ---------------------------------------------------------------------------

describe('JsCodeAction.execute', () => {
  const action = new JsCodeAction();

  it('should have `agent` available in scope', async () => {
    const page = makeMockPage();
    const agent = makeMockAgent();

    const entity: ActionEntity = {
      action_description: 'test',
      action_data: { action_name: 'js_code', kwargs: { code: 'if (!agent) throw new Error("no agent");' } },
    };
    await action.execute(page, entity, agent.agentServices);
  });

  it('should have `agent.agentServices` accessible', async () => {
    const page = makeMockPage();
    const agent = makeMockAgent();

    const entity: ActionEntity = {
      action_description: 'test',
      action_data: { action_name: 'js_code', kwargs: { code: 'if (!agent.agentServices) throw new Error("no agentServices");' } },
    };
    await action.execute(page, entity, agent.agentServices);
  });

  it('should have Playwright `expect` available in scope', async () => {
    const page = makeMockPage();
    const agent = makeMockAgent();

    const entity: ActionEntity = {
      action_description: 'test',
      action_data: { action_name: 'js_code', kwargs: { code: 'expect("123").toBe("123");' } },
    };
    await action.execute(page, entity, agent.agentServices);
  });

  it('should throw when agent is not set on agentServices', async () => {
    const page = makeMockPage();
    const agentServices = { agent: null } as any;
    const entity: ActionEntity = {
      action_description: 'test',
      action_data: { action_name: 'js_code', kwargs: { code: 'return 1;' } },
    };

    await assert.rejects(
      () => action.execute(page, entity, agentServices),
      /Agent not initialized/
    );
  });
});
