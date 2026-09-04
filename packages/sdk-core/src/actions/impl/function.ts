/**
 * function action - Execute a custom function
 */

import { Page } from 'playwright';
import type { AgentServices } from '../../agent/agentServices';
import { ActionEntity, IAction } from '../types';

// ============================================================================
// Action Implementation
// ============================================================================

export class FunctionAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    // Generate function call code from kwargs
    const code = this.generateFunctionCallCode(actionData.kwargs);
    if (!code) {
      throw new Error('Missing function name for function action');
    }

    // Execute the function call in an async context with access to page and agent
    const agent = agentServices.agent;
    if (!agent) {
      throw new Error('Agent not initialized on AgentServices — FunctionAction requires an agent reference');
    }
    const asyncFunction = new Function('page', 'agent', `
      return (async () => {
        ${code}
      })();
    `);

    // Execute the code with page and agent as arguments
    await asyncFunction(page, agent);
  }

  transpile(actionEntity: ActionEntity): string[] {
    const code = this.generateFunctionCallCode(actionEntity.action_data?.kwargs || {});
    if (!code) {
      return [`// Skipping function: missing functionName`];
    }
    return [code.endsWith(';') ? code : `${code};`];
  }

  /**
   * Generate function call code from action kwargs
   * Follows the same logic as generateFunctionCallCode in packages/common/utils/functionUtils.ts
   */
  private generateFunctionCallCode(kwargs: Record<string, any>): string | null {
    const functionName = kwargs.functionName;
    if (!functionName) {
      return null;
    }

    // New format: args is a flat array of values
    // Legacy format: parameterNames + parameterValues zipped together
    let args: string[];
    if (Array.isArray(kwargs.args)) {
      args = kwargs.args.map(String);
    } else if (Array.isArray(kwargs.parameterNames)) {
      const paramValues = kwargs.parameterValues || [];
      args = kwargs.parameterNames.map((_: string, i: number) =>
        i < paramValues.length ? String(paramValues[i]) : 'undefined'
      );
    } else {
      return `await ${functionName}()`;
    }

    if (args.length === 0) {
      return `await ${functionName}()`;
    }

    const systemParams = ['page', 'testContext', 'request', 'agent'];
    const jsLiterals = ['undefined', 'null', 'true', 'false'];

    const valueStrings = args.map((value) => {
      if (systemParams.includes(value)) {
        return value;
      }
      if (jsLiterals.includes(value) || /^-?\d+(\.\d+)?$/.test(value)) {
        return value;
      }
      if (value.startsWith('$')) {
        return `agent.agentServices.readVariable('${value.substring(1)}')`;
      }
      return `"${value}"`;
    });

    return `await ${functionName}(${valueStrings.join(', ')})`;
  }
}

// No LLM tool registration for function action - it's only used during test playback
