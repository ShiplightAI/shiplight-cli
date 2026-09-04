/**
 * save_variable action - Save a value to a named variable
 */

import { Page } from 'playwright';
import { z } from 'zod';
import type { AgentServices } from '../../agent/agentServices';
import { ToolRegistry } from '../../llm_tools/registry';
import { ActionEntity, IAction } from '../types';

// ============================================================================
// Action Implementation
// ============================================================================

export class SaveVariableAction implements IAction {
  async execute(
    page: Page,
    actionEntity: ActionEntity,
    agentServices: AgentServices
  ): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    let variableName = actionData.kwargs.name;
    const variableValue = actionData.kwargs.value;

    if (!variableName || variableValue === undefined) {
      throw new Error('Missing variable name or value for save_variable');
    }

    // Remove $ prefix if present
    if (variableName.startsWith('$')) {
      variableName = variableName.slice(1);
    }

    // Save the variable using the agent
    agentServices.saveVariable(variableName, variableValue);
  }

  transpile(actionEntity: ActionEntity): string[] {
    const name = actionEntity.action_data?.kwargs?.name || '';
    const value = actionEntity.action_data?.kwargs?.value;
    return [
      `await agent.execAction("save_variable", page, {`,
      `  action_data: { kwargs: { name: ${JSON.stringify(name)}, value: ${JSON.stringify(value)} } },`,
      `});`
    ];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const SaveVariableToolSchema = z.object({
  name: z.string().describe('Variable name to save'),
  value: z.string().describe('Value to save in the variable'),
});

export function registerSaveVariableTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'save_variable',
    description: 'Save a value to a named variable for later use in the test.',
    schema: SaveVariableToolSchema,

    async execute(args, ctx) {
      const { name, value } = args;
      const { page, agentServices } = ctx;

      try {
        const actionEntity: ActionEntity = {
          action_description: `Save variable "${name}" = "${value}"`,
          action_data: {
            action_name: 'save_variable',
            kwargs: { name, value },
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Saved variable "${name}"`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: `Save variable "${name}" (failed)`,
            action_data: {
              action_name: 'save_variable',
              kwargs: { name, value },
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}
