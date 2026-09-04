/**
 * done action - Mark task as complete
 */

import { z } from 'zod';
import { Page } from 'playwright';
import { IAction, ActionEntity } from '../types';
import { ToolRegistry } from '../../llm_tools/registry';

// ============================================================================
// Action Implementation
// ============================================================================

export class DoneAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity): Promise<void> {
    // Done action is a no-op - it just signals completion
    // The task loop handles the actual completion logic
  }

  transpile(actionEntity: ActionEntity): string[] {
    return [`// Done - no action needed`];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const DoneToolSchema = z.object({
  success: z.boolean().describe('Whether the task was completed successfully'),
  summary: z.string().describe('Summary of what was accomplished or why it failed'),
});

export function registerDoneTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'done',
    description: 'Mark the current task as complete. Use when you have finished all requested actions.',
    schema: DoneToolSchema,

    async execute(args, ctx) {
      const { page, agentServices } = ctx;

      try {
        const actionEntity: ActionEntity = {
          action_description: 'Task completed',
          action_data: {
            action_name: 'done',
            kwargs: {},
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: 'Task marked as complete',
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: 'Task completed (failed)',
            action_data: {
              action_name: 'done',
              kwargs: {},
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}
