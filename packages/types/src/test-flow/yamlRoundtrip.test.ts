import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { testFlowToYaml, yamlToTestFlow } from './yamlFlowParser.js';
import { StatementType } from './testFlow.js';
import type { TestFlow, Action, Step } from './testFlow.js';

/**
 * Roundtrip stability for captured test flows.
 *
 * Closes quality-evidence gap exp-yaml-export (003-shiplightai-mcp-server): the
 * MCP server's promise is that "every interaction becomes a rerunnable test" —
 * a captured flow is serialized to YAML and must parse back into an equivalent,
 * replayable TestFlow. The existing yamlFlowParser tests assert each DIRECTION
 * separately; none assert that serialize -> parse -> serialize is stable, which
 * is what actually guarantees a captured session stays replayable.
 *
 * The most important invariant: an ACTION whose action_entity carries a concrete
 * locator/xpath must survive the roundtrip, because that is what makes replay
 * deterministic (vs. re-resolving via the LLM).
 */

function sampleFlow(): TestFlow {
  return {
    goal: 'Log in and confirm the dashboard',
    url: 'https://app.example.com',
    statements: [
      { uid: 'd1', type: StatementType.DRAFT, description: 'Open the login page' },
      {
        uid: 'c1',
        type: StatementType.ACTION,
        description: 'Click the Login button',
        action_entity: {
          action_description: 'Click the Login button',
          action_data: { action_name: 'click', kwargs: {} },
          locator: "getByRole('button', { name: 'Login' })",
          xpath: '//button[@id="login"]',
        },
      } as Action,
      {
        uid: 'v1',
        type: StatementType.ACTION,
        description: 'Verify the dashboard is visible',
        action_entity: {
          action_description: 'Verify the dashboard is visible',
          action_data: { action_name: 'verify', kwargs: { statement: 'the dashboard heading is visible' } },
        },
      } as Action,
      {
        uid: 's1',
        type: StatementType.STEP,
        description: 'Finish onboarding',
        statements: [
          { uid: 'd2', type: StatementType.DRAFT, description: 'Dismiss the welcome modal' },
        ],
      } as Step,
    ],
  };
}

describe('TestFlow <-> YAML roundtrip (captured-as-rerunnable)', () => {
  it('parses serialized YAML back into an equivalent flow', () => {
    const flow = sampleFlow();
    const parsed = yamlToTestFlow(testFlowToYaml(flow));

    assert.equal(parsed.goal, flow.goal);
    const parsedStatements = parsed.statements;
    const flowStatements = flow.statements;
    assert.ok(parsedStatements, 'parsed flow has statements');
    assert.ok(flowStatements, 'source flow has statements');
    assert.equal(parsedStatements.length, flowStatements.length, 'statement count preserved');
    assert.deepEqual(
      parsedStatements.map((s) => s.type),
      [StatementType.DRAFT, StatementType.ACTION, StatementType.ACTION, StatementType.STEP],
      'statement types preserved in order',
    );
  });

  it('preserves the concrete locator/xpath on a captured action (deterministic replay)', () => {
    const parsed = yamlToTestFlow(testFlowToYaml(sampleFlow()));
    assert.ok(parsed.statements, 'parsed flow has statements');
    const click = parsed.statements[1] as Action;

    assert.equal(click.type, StatementType.ACTION);
    assert.equal(click.action_entity?.action_data?.action_name, 'click');
    assert.equal(
      click.action_entity?.locator,
      "getByRole('button', { name: 'Login' })",
      'locator must survive the roundtrip so replay does not need the LLM',
    );
    assert.equal(click.action_entity?.xpath, '//button[@id="login"]', 'xpath fallback must survive too');
  });

  it('preserves a verify assertion through the roundtrip', () => {
    const parsed = yamlToTestFlow(testFlowToYaml(sampleFlow()));
    assert.ok(parsed.statements, 'parsed flow has statements');
    const verify = parsed.statements[2] as Action;

    assert.equal(verify.action_entity?.action_data?.action_name, 'verify');
    assert.equal(verify.action_entity?.action_data?.kwargs?.statement, 'the dashboard heading is visible');
  });

  it('is idempotent: re-serializing the parsed flow yields identical YAML', () => {
    const yaml1 = testFlowToYaml(sampleFlow());
    const yaml2 = testFlowToYaml(yamlToTestFlow(yaml1));
    assert.equal(yaml2, yaml1, 'serialize -> parse -> serialize must be stable');
  });
});
