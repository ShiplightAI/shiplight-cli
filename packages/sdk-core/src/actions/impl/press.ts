/**
 * press action - Press a keyboard key
 */

import { Page } from 'playwright';
import { z } from 'zod';
import { ToolRegistry } from '../../llm_tools/registry';
import { ActionEntity, IAction } from '../types';

// ============================================================================
// Action Implementation
// ============================================================================

export class PressAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    const keys = actionData.kwargs.keys;
    if (!keys || typeof keys !== 'string') {
      throw new Error('Missing or invalid keys for press action');
    }

    await page.keyboard.press(keys);
    await page.waitForTimeout(500);
  }

  transpile(actionEntity: ActionEntity): string[] {
    const keys = actionEntity.action_data?.kwargs?.keys;
    return [`await page.keyboard.press(${JSON.stringify(keys)});`];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const PressToolSchema = z.object({
  keys: z.string().describe('A single key or key combination to press (e.g. Escape, Backspace, Insert, PageDown, Delete, Tab, Enter). Key combinations like `Control+o`, `Control+Shift+T`, `ControlOrMeta+a` are supported. Note: This does NOT support sequences - to press multiple keys in sequence (e.g., Control+A then Backspace), call this action multiple times.'),
});

export function registerPressTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'press',
    description: 'Press a single keyboard key or key combination. Supports combinations like `Control+A` for select all. Does NOT support sequences - call this action multiple times to press keys in sequence.',
    schema: PressToolSchema,

    async execute(args, ctx) {
      const { keys } = args;
      const { page, agentServices, actionDescription } = ctx as any;

      try {
        const actionEntity: ActionEntity = {
          action_description: actionDescription || `Press keys "${keys}"`,
          action_data: {
            action_name: 'press',
            kwargs: { keys },
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Pressed keys "${keys}"`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: (actionDescription || `Press keys "${keys}"`) + ' (failed)',
            action_data: {
              action_name: 'press',
              kwargs: { keys },
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}
