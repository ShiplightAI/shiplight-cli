/**
 * wait_for_page_ready action - Wait for the page to be fully loaded
 */

import { Page } from 'playwright';
import { z } from 'zod';
import { ToolRegistry } from '../../llm_tools/registry';
import { ActionEntity, IAction } from '../types';

// ============================================================================
// Action Implementation
// ============================================================================

export class WaitForPageReadyAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity): Promise<void> {
    // Wait for network to be idle and DOM to be loaded
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
      // If network never idles (e.g., websocket connections), fall back to domcontentloaded
    });
    await page.waitForLoadState('domcontentloaded');
  }

  transpile(actionEntity: ActionEntity): string[] {
    return [`await page.waitForLoadState('domcontentloaded');`];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const WaitForPageReadyToolSchema = z.object({});

export function registerWaitForPageReadyTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'wait_for_page_ready',
    description: 'Wait for the page to be fully loaded (network idle and DOM ready). Use this when the page is still loading or not ready for interaction.',
    schema: WaitForPageReadyToolSchema,

    async execute(args, ctx) {
      const { page, agentServices, actionDescription } = ctx as any;

      try {
        const actionEntity: ActionEntity = {
          action_description: actionDescription || 'Wait for page to be ready',
          action_data: {
            action_name: 'wait_for_page_ready',
            kwargs: {},
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: 'Page is ready',
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: (actionDescription || 'Wait for page to be ready') + ' (failed)',
            action_data: {
              action_name: 'wait_for_page_ready',
              kwargs: {},
            },
            feedback: (error as Error).message,
          },
        };
      }
    },

    // Available for both OpenAI-style calls and MCP
    availability: {
      openai: false,
      mcp: false,
    },
  });
}
