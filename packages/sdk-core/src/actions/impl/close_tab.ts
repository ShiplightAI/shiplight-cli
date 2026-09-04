/**
 * close_tab action - Close a browser tab
 */

import { Page } from 'playwright';
import { z } from 'zod';
import { ToolRegistry } from '../../llm_tools/registry';
import { ActionEntity, IAction } from '../types';
import { AgentServices } from '../../agent/agentServices';

// ============================================================================
// Action Implementation
// ============================================================================

export class CloseTabAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices?: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }
    let pageId = actionData.kwargs.page_id ?? actionData.kwargs.index;
    if (pageId === undefined) {
      const currentPageIndex = page.context().pages().indexOf(page);
      pageId = currentPageIndex;
    }

    if (typeof pageId === 'number') {
      if (pageId === 0) {
        throw new Error('Cannot close the first tab (page_id 0). Skipping close_tab action.');
      }

      if (agentServices) {
        await agentServices.closeTab(pageId);
      }
    } else {
      throw new Error('Missing page_id for close_tab action');
    }
  }

  transpile(actionEntity: ActionEntity): string[] {
    let pageId = actionEntity.action_data?.kwargs?.page_id;
    pageId = pageId ?? actionEntity.action_data?.kwargs?.index;
    return [
      `await agent.execAction("close_tab", page, {`,
      `  action_data: { kwargs: { page_id: ${pageId} } },`,
      `});`
    ];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const CloseTabToolSchema = z.object({
  index: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Index of the tab to close (0-based). Defaults to current tab if not specified.'),
});

export function registerCloseTabTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'close_tab',
    description: 'Close a browser tab by index. If no index is specified, closes the current tab.',
    schema: CloseTabToolSchema,

    async execute(args, ctx) {
      const { index } = args;
      const { page, agentServices, actionDescription } = ctx as any;

      try {
        const actionEntity: ActionEntity = {
          action_description: actionDescription || `Close tab ${index}`,
          action_data: {
            action_name: 'close_tab',
            kwargs: { page_id: index },
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Closed tab ${index}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: (actionDescription || 'Close tab') + ' (failed)',
            action_data: {
              action_name: 'close_tab',
              kwargs: {},
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}
