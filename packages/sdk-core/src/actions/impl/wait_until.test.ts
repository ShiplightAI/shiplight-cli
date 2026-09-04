/**
 * Tests for AiWaitUntilAction — the WAIT_UNTIL action, covering both the
 * natural-language (AI) path and the JS_CODE fast-path (condition_type).
 *
 * WAIT_UNTIL synchronizes but never fails the test: a timeout resolves with a
 * warning note instead of throwing, so these tests assert on the notes recorded
 * via agentServices.addNote.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// The AI path loads evaluateStatement via a dynamic import at call time, so a
// top-level module mock intercepts it without affecting the JS_CODE tests.
const evaluateStatementMock = mock.fn(async (): Promise<{ success: boolean }> => ({ success: false }));
mock.module('../../agent/agentHelpers', {
  namedExports: { evaluateStatement: evaluateStatementMock },
});

const { AiWaitUntilAction } = await import('./wait_until');
import type { ActionEntity } from '../types';
import type { AgentServices } from '../../agent/agentServices';

function fakePage() {
  return {
    waitForTimeout: async (ms: number) => {
      await new Promise((r) => setTimeout(r, ms));
    },
  } as never;
}

function fakeAgentServices(): { services: AgentServices; notes: string[] } {
  const notes: string[] = [];
  const services = {
    agent: undefined,
    addNote: (note: string) => notes.push(note),
  } as unknown as AgentServices;
  return { services, notes };
}

function jsEntity(condition: string, timeoutSeconds: number): ActionEntity {
  return {
    action_description: `Wait until: ${condition}`,
    action_data: {
      action_name: 'ai_wait_until',
      kwargs: { condition, condition_type: 'JS_CODE', timeout_seconds: timeoutSeconds },
    },
  };
}

describe('AiWaitUntilAction.transpile', () => {
  const action = new AiWaitUntilAction();

  it('emits agent.waitForJs for a JS_CODE condition (inlined, not stringified)', () => {
    const entity = jsEntity("!document.querySelector('.spinner')", 10);
    const lines = action.transpile(entity, 'step-1');
    assert.equal(lines.length, 1);
    assert.ok(
      lines[0].includes(
        "agent.waitForJs(page, async () => (!document.querySelector('.spinner')), 10, 'step-1')",
      ),
      `got: ${lines[0]}`,
    );
  });

  it('inlines the js kwarg and passes the intent as the description (sibling js: form)', () => {
    const entity: ActionEntity = {
      action_description: 'Wait until: The dashboard has finished loading',
      action_data: {
        action_name: 'ai_wait_until',
        kwargs: {
          condition: 'The dashboard has finished loading',
          condition_type: 'JS_CODE',
          js: "(await page.locator('.spinner').count()) === 0",
          timeout_seconds: 10,
        },
      },
    };
    const lines = action.transpile(entity, 'step-1b');
    assert.equal(lines.length, 1);
    assert.ok(
      lines[0].includes(
        "agent.waitForJs(page, async () => ((await page.locator('.spinner').count()) === 0), 10, 'step-1b', \"The dashboard has finished loading\")",
      ),
      `got: ${lines[0]}`,
    );
  });

  it('emits agent.waitUntilCondition for a natural-language condition', () => {
    const entity: ActionEntity = {
      action_description: 'Wait until spinner gone',
      action_data: {
        action_name: 'ai_wait_until',
        kwargs: { condition: 'the spinner has disappeared', timeout_seconds: 30 },
      },
    };
    const lines = action.transpile(entity, 'step-2');
    assert.ok(lines[0].includes('agent.waitUntilCondition(page,'));
    assert.ok(lines[0].includes('"the spinner has disappeared"'));
    assert.ok(!lines[0].includes('waitForJs'));
  });
});

describe('AiWaitUntilAction.execute (JS_CODE path)', () => {
  const action = new AiWaitUntilAction();

  it('returns without a note when the JS condition is met', async () => {
    const { services, notes } = fakeAgentServices();
    await action.execute(fakePage(), jsEntity('1 < 2', 5), services);
    assert.deepEqual(notes, []);
  });

  it('does not throw on timeout — records a not-met warning note instead', async () => {
    const { services, notes } = fakeAgentServices();
    await action.execute(fakePage(), jsEntity('false', 0.01), services);
    assert.equal(notes.length, 1);
    assert.ok(notes[0].includes('Condition not met within'), notes[0]);
    assert.ok(notes[0].includes('continuing'), notes[0]);
  });

  it('surfaces a never-evaluated predicate as a likely-invalid expression', async () => {
    const { services, notes } = fakeAgentServices();
    await action.execute(
      fakePage(),
      jsEntity("!document.querySelector('.spinner')", 0.01),
      services,
    );
    assert.equal(notes.length, 1);
    assert.ok(notes[0].includes('never evaluated successfully'), notes[0]);
    assert.ok(notes[0].includes('document is not defined'), notes[0]);
  });

  it('degrades an unparseable expression to the fixed wait with a parse-error note', async () => {
    const { services, notes } = fakeAgentServices();
    await action.execute(fakePage(), jsEntity('((', 0.01), services);
    assert.equal(notes.length, 1);
    assert.ok(notes[0].includes('could not be parsed'), notes[0]);
    assert.ok(notes[0].includes('continuing'), notes[0]);
  });

  it('evaluates a predicate that uses page', async () => {
    const { services, notes } = fakeAgentServices();
    const page = { count: async () => 1, waitForTimeout: async () => {} } as never;
    await action.execute(page, jsEntity('(await page.count()) >= 1', 5), services);
    assert.deepEqual(notes, []);
  });

  it('polls the js kwarg, not the intent, in the sibling js: form', async () => {
    const { services, notes } = fakeAgentServices();
    const entity: ActionEntity = {
      action_description: 'Wait until: The dashboard has finished loading',
      action_data: {
        action_name: 'ai_wait_until',
        kwargs: {
          // The intent is not valid JS — if it were compiled, the note would
          // report a parse failure instead of a met condition.
          condition: 'The dashboard has finished loading',
          condition_type: 'JS_CODE',
          js: '1 < 2',
          timeout_seconds: 5,
        },
      },
    };
    await action.execute(fakePage(), entity, services);
    assert.deepEqual(notes, []);
  });

  it('still throws on authoring errors (missing condition)', async () => {
    const { services } = fakeAgentServices();
    const entity: ActionEntity = {
      action_description: 'Wait until nothing',
      action_data: { action_name: 'ai_wait_until', kwargs: {} },
    };
    await assert.rejects(
      action.execute(fakePage(), entity, services),
      /Missing condition/,
    );
  });
});

describe('AiWaitUntilAction.execute (AI path)', () => {
  const action = new AiWaitUntilAction();

  function aiEntity(condition: string, timeoutSeconds: number): ActionEntity {
    return {
      action_description: `Wait until: ${condition}`,
      action_data: {
        action_name: 'ai_wait_until',
        kwargs: { condition, timeout_seconds: timeoutSeconds },
      },
    };
  }

  it('returns without a note when the AI condition is met', async () => {
    evaluateStatementMock.mock.mockImplementationOnce(async () => ({ success: true }));
    const { services, notes } = fakeAgentServices();
    await action.execute(fakePage(), aiEntity('Dashboard ready', 5), services);
    assert.deepEqual(notes, []);
  });

  it('does not throw on timeout — records a not-met warning note, capped at 300s', async (t) => {
    // Mock Date so the 5s poll interval can be ticked instantly; the stubbed
    // waitForTimeout advances the clock instead of sleeping. timeout_seconds
    // is 400 — the note naming 300s proves the documented cap is applied.
    t.mock.timers.enable({ apis: ['Date'] });
    evaluateStatementMock.mock.mockImplementation(async () => ({ success: false }));
    const page = {
      waitForTimeout: async (ms: number) => {
        t.mock.timers.tick(ms);
      },
    } as never;
    const { services, notes } = fakeAgentServices();

    await action.execute(page, aiEntity('Dashboard ready', 400), services);

    assert.equal(notes.length, 1);
    assert.ok(notes[0].includes('Condition not met within 300s'), notes[0]);
    assert.ok(notes[0].includes('continuing'), notes[0]);
    assert.ok(evaluateStatementMock.mock.callCount() > 1, 'should have polled repeatedly');
  });
});
