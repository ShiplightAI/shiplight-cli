/**
 * scroll action - Generic scroll to bring element into view
 */

import { Page } from 'playwright';
import { z } from 'zod';
import { ToolRegistry } from '../../llm_tools/registry';
import { ActionEntity, IAction } from '../types';

// ============================================================================
// Action Implementation
// ============================================================================

export class ScrollAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }
    const down = actionData.kwargs.down ?? true;
    const num_pages = actionData.kwargs.num_pages ?? 1;

    const direction = down ? 1 : -1;
    await page.evaluate(`window.scrollBy(0, window.innerHeight * ${num_pages} * ${direction})`);
  }

  transpile(actionEntity: ActionEntity): string[] {
    const down = actionEntity.action_data?.kwargs?.down ?? true;
    const num_pages = actionEntity.action_data?.kwargs?.num_pages ?? 1;
    const direction = down ? 1 : -1;
    return [`await page.evaluate('window.scrollBy(0, window.innerHeight * ${num_pages * direction})');`];
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function createScrollActionEntity(
  actionName: string,
  description: string,
  kwargs: any = {}
): Promise<ActionEntity> {
  return {
    action_description: description,
    action_data: {
      action_name: actionName,
      kwargs: { ...kwargs },
    },
  };
}

function createErrorActionEntity(
  description: string,
  actionName: string,
  kwargs: any
): ActionEntity {
  return {
    action_description: `${description} (failed)`,
    action_data: {
      action_name: actionName,
      kwargs,
    },
    feedback: 'Scroll failed!',
  };
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const ScrollToolSchema = z.object({
  down: z.boolean().describe('True to scroll down, False to scroll up'),
  num_pages: z.number().nonnegative().describe('Number of pages to scroll (0.5 = half page, 1.0 = one page, etc.)'),
});

export function registerScrollTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'scroll',
    description: 'Scroll the page by specified number of pages (set down=True to scroll down, down=False to scroll up, num_pages=number of pages to scroll like 0.5 for half page, 1.0 for one page, etc.). ',
    schema: ScrollToolSchema,

    async execute(args, ctx) {
      const { down, num_pages } = args;
      const { page, agentServices, actionDescription } = ctx as any;

      try {
        const description = actionDescription || `Scroll ${down ? 'down' : 'up'} ${num_pages} page(s)`;
        const actionEntity = await createScrollActionEntity(
          'scroll',
          description,
          {
            down,
            num_pages,
          }
        );

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Scrolled ${down ? 'down' : 'up'} ${num_pages} page(s)`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: createErrorActionEntity(
            actionDescription || `Scroll ${down ? 'down' : 'up'} ${num_pages} page(s)`,
            'scroll',
            {
              down,
              num_pages,
            }
          ),
        };
      }
    },
  });
}
