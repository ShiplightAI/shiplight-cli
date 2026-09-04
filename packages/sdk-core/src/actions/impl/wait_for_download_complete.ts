/**
 * wait_for_download_complete action - Wait for a download to complete
 */

import { Page } from 'playwright';
import { z } from 'zod';
import type { AgentServices } from '../../agent/agentServices';
import { ToolRegistry } from '../../llm_tools/registry';
import { ActionEntity, IAction } from '../types';

// ============================================================================
// Action Implementation
// ============================================================================

export class WaitForDownloadCompleteAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    const timeoutSeconds = actionData.kwargs.timeout_seconds || 10;
    await agentServices.waitForDownloadComplete(page, timeoutSeconds);
  }

  transpile(actionEntity: ActionEntity): string[] {
    const timeoutSeconds = actionEntity.action_data?.kwargs?.timeout_seconds || 10;
    return [
      `await agent.execAction("wait_for_download_complete", page, {`,
      `  action_data: { kwargs: { timeout_seconds: ${timeoutSeconds} } },`,
      `});`
    ];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const WaitForDownloadCompleteToolSchema = z.object({
  timeout_seconds: z.number().positive().optional().describe('Maximum time in seconds to wait for download to complete. Set this only when the instruction states a timeout; otherwise leave it unset so the 10s default applies.'),
});

export function registerWaitForDownloadCompleteTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'wait_for_download_complete',
    description: 'Wait for an in-progress download to complete.',
    schema: WaitForDownloadCompleteToolSchema,

    async execute(args, ctx) {
      const { timeout_seconds = 10 } = args;
      const { page, agentServices } = ctx;

      try {
        const actionEntity: ActionEntity = {
          action_description: `Wait for download to complete (timeout: ${timeout_seconds}s)`,
          action_data: {
            action_name: 'wait_for_download_complete',
            kwargs: { timeout_seconds },
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Download completed`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: `Wait for download to complete (failed)`,
            action_data: {
              action_name: 'wait_for_download_complete',
              kwargs: { timeout_seconds },
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}
