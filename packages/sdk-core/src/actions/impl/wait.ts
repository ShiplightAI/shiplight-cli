/**
 * wait action - Wait for a specified duration
 */

import { Page } from 'playwright';
import { z } from 'zod';
import { ToolRegistry } from '../../llm_tools/registry';
import { ActionEntity, IAction } from '../types';

// ============================================================================
// Action Implementation
// ============================================================================

export class WaitAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }
    const seconds = actionData.kwargs.seconds || 1;
    await page.waitForTimeout(seconds * 1000);
  }

  transpile(actionEntity: ActionEntity): string[] {
    const seconds = actionEntity.action_data?.kwargs?.seconds || 1;
    return [`await page.waitForTimeout(${seconds * 1000});`];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const WaitToolSchema = z.object({
  seconds: z.number().positive().describe('Number of seconds to wait'),
});

export function registerWaitTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'wait',
    description: 'Wait for a specified number of seconds before continuing.',
    schema: WaitToolSchema,

    async execute(args, ctx) {
      const { seconds } = args;
      const { page, agentServices, actionDescription } = ctx as any;

      try {
        const actionEntity: ActionEntity = {
          action_description: actionDescription || `Wait ${seconds} seconds`,
          action_data: {
            action_name: 'wait',
            kwargs: { seconds },
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Waited ${seconds} seconds`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: (actionDescription || `Wait ${seconds} seconds`) + ' (failed)',
            action_data: {
              action_name: 'wait',
              kwargs: { seconds },
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}
