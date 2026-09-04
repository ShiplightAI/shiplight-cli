/**
 * reload_page action - Reload the current page
 */

import { Page } from 'playwright';
import { z } from 'zod';
import { ToolRegistry } from '../../llm_tools/registry';
import { ActionEntity, IAction } from '../types';
import { GOTO_TIMEOUT } from '../utils';

// ============================================================================
// Action Implementation
// ============================================================================

export class ReloadPageAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity): Promise<void> {
    await page.reload({ timeout: GOTO_TIMEOUT });
    await page.waitForLoadState('load', { timeout: GOTO_TIMEOUT });
    await page.waitForTimeout(1000);
  }

  transpile(actionEntity: ActionEntity): string[] {
    return [`await agent.execAction("reload_page", page, {});`];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const ReloadPageToolSchema = z.object({});

export function registerReloadPageTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'reload_page',
    description: 'Reload the current page. WARNING: This will reset any in-progress forms or multi-step flows (like login). Only use when you need to refresh stale data or clear a stuck state. Do NOT use during login, checkout, or form submission flows.',
    schema: ReloadPageToolSchema,

    async execute(args, ctx) {
      const { page, agentServices } = ctx;

      try {
        const actionEntity: ActionEntity = {
          action_description: 'Reload page',
          action_data: {
            action_name: 'reload_page',
            kwargs: {},
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Reloaded ${page.url()}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: 'Reload page (failed)',
            action_data: {
              action_name: 'reload_page',
              kwargs: {},
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}
