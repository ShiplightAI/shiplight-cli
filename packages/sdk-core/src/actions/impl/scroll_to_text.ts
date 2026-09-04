/**
 * scroll_to_text action - Scroll until text is visible
 */

import { Page } from 'playwright';
import { z } from 'zod';
import { ToolRegistry } from '../../llm_tools/registry';
import { ActionEntity, IAction } from '../types';

// ============================================================================
// Action Implementation
// ============================================================================

export class ScrollToTextAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }
    const text = actionData.kwargs.text;

    if (text) {
      const locator = page.getByText(text, { exact: false });
      await locator.first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    } else {
      throw new Error('Missing text for scroll_to_text action');
    }
  }

  transpile(actionEntity: ActionEntity): string[] {
    const text = actionEntity.action_data?.kwargs?.text || '';
    return [`await page.getByText(${JSON.stringify(text)}, { exact: false }).first().scrollIntoViewIfNeeded();`];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const ScrollToTextToolSchema = z.object({
  text: z.string().describe('Text to scroll to on the page'),
});

export function registerScrollToTextTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'scroll_to_text',
    description: 'Scroll the page until specified text becomes visible.',
    schema: ScrollToTextToolSchema,

    async execute(args, ctx) {
      const { text } = args;
      const { page, agentServices, actionDescription } = ctx as any;

      try {
        const actionEntity: ActionEntity = {
          action_description: actionDescription || `Scroll to text "${text}"`,
          action_data: {
            action_name: 'scroll_to_text',
            kwargs: { text },
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Scrolled to text "${text}"`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: (actionDescription || `Scroll to text "${text}"`) + ' (failed)',
            action_data: {
              action_name: 'scroll_to_text',
              kwargs: { text },
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}
