/**
 * js_action - Execute cached JavaScript with self-healing support
 *
 * Unlike js_code (CODE: statements), js_action is used for intent: + js: shorthand
 * where the description serves as the intent for self-healing. If the cached JS
 * fails, agent.step() uses the description to regenerate the action via AI.
 */

import { Page } from 'playwright';
import { ActionEntity, IAction } from '../types';

export class JsAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: any): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    const code = actionData.kwargs.code;
    if (!code) {
      throw new Error('Missing code for js_action');
    }

    const agent = agentServices.agent;
    if (!agent) {
      throw new Error('Agent not initialized on AgentServices — js_action requires an agent reference');
    }
    const asyncFunction = new Function('page', 'agent', `
      return (async () => {
        ${code}
      })();
    `);

    await asyncFunction(page, agent);
  }

  transpile(actionEntity: ActionEntity): string[] {
    const code = actionEntity.action_data?.kwargs?.code;
    if (!code) {
      return [`// Skipping js_action: missing code`];
    }
    return code.split('\n');
  }
}
