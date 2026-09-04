/**
 * go_back action - Navigate back in browser history
 */

import { Page } from 'playwright';
import { z } from 'zod';
import { ToolRegistry } from '../../llm_tools/registry';
import { ActionEntity, IAction } from '../types';
import { GOTO_TIMEOUT } from '../utils';

// ============================================================================
// Action Implementation
// ============================================================================

export class GoBackAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity): Promise<void> {
    await page.goBack({ timeout: GOTO_TIMEOUT });
    await page.waitForLoadState('load', { timeout: GOTO_TIMEOUT });
    await page.waitForTimeout(1000);
  }

  transpile(actionEntity: ActionEntity): string[] {
    return [`await agent.execAction("go_back", page, {});`];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const GoBackToolSchema = z.object({});

export function registerGoBackTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'go_back',
    description: 'Navigate back to the previous page in browser history.',
    schema: GoBackToolSchema,

    async execute(args, ctx) {
      const { page, agentServices, actionDescription } = ctx as any;

      try {
        const actionEntity: ActionEntity = {
          action_description: actionDescription || 'Go back',
          action_data: {
            action_name: 'go_back',
            kwargs: {},
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: 'Navigated back',
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: (actionDescription || 'Go back') + ' (failed)',
            action_data: {
              action_name: 'go_back',
              kwargs: {},
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}
