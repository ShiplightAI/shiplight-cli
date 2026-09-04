/**
 * switch_tab action - Switch to a different browser tab
 */

import { Page } from 'playwright';
import { z } from 'zod';
import type { AgentServices } from '../../agent/agentServices';
import { ToolRegistry } from '../../llm_tools/registry';
import { ActionEntity, IAction } from '../types';

// ============================================================================
// Action Implementation
// ============================================================================

export class SwitchTabAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices?: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }
    const pageId = actionData.kwargs.page_id ?? actionData.kwargs.tab_index ?? 0;

    if (typeof pageId === 'number') {
      const pages = page.context().pages();
      const targetPageIndex = pageId === -1 ? pages.length - 1 : pageId;

      if (agentServices) {
        const newPage = await agentServices.switchTab(targetPageIndex);
        await newPage.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
        await newPage.waitForTimeout(500);
      }
    } else {
      throw new Error('Missing page_id for switch_tab action');
    }
  }

  transpile(actionEntity: ActionEntity): string[] {
    const pageId = actionEntity.action_data?.kwargs?.page_id
      ?? actionEntity.action_data?.kwargs?.tab_index
      ?? 0;
    return [
      `await agent.execAction("switch_tab", page, {`,
      `  action_data: { kwargs: { page_id: ${pageId} } },`,
      `});`
    ];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const SwitchTabToolSchema = z.object({
  tab_index: z
    .number()
    .int()
    .nonnegative()
    .describe('Index of the tab to switch to (0-based). Use 0 for first tab, 1 for second, etc.'),
});

export function registerSwitchTabTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'switch_tab',
    description: 'Switch to a different browser tab by index (0-based).',
    schema: SwitchTabToolSchema,

    async execute(args, ctx) {
      const index = (args as any).tab_index;
      const { page, agentServices, actionDescription } = ctx as any;

      try {
        const actionEntity: ActionEntity = {
          action_description: actionDescription || `Switch to tab ${index}`,
          action_data: {
            action_name: 'switch_tab',
            kwargs: { page_id: index },
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Switched to tab ${index}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: (actionDescription || `Switch to tab ${index}`) + ' (failed)',
            action_data: {
              action_name: 'switch_tab',
              kwargs: { page_id: index },
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}
