/**
 * ai_step action - AI-powered multi-action step execution
 *
 * Uses dynamic import to avoid circular dependency
 * (handler.ts -> ai_step -> agentHelpers -> handler.ts)
 */

import { z } from 'zod';
import { Page } from 'playwright';
import { IAction, ActionEntity } from '../types';
import type { AgentServices } from '../../agent/agentServices';
import { ToolRegistry } from '../../llm_tools/registry';

// ============================================================================
// Action Implementation
// ============================================================================

export class AiStepAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    const statement = actionData.kwargs.statement;
    if (!statement) {
      throw new Error('Missing statement for ai_step');
    }

    // Dynamic import to avoid circular dependency
    const { runTask } = await import('../../agent/agentHelpers');
    const result = await runTask(statement, page, agentServices);

    if (result.status !== 'success') {
      throw new Error(result.error || 'Task execution failed');
    }
  }

  transpile(actionEntity: ActionEntity, stepId?: string): string[] {
    const statement = actionEntity.action_data?.kwargs?.statement;
    if (!statement) {
      return [`// Skipping ai_step: missing statement`];
    }
    const escapedStatement = JSON.stringify(statement);
    return [`await agent.run(page, ${escapedStatement}, '${stepId || ''}');`];
  }
}

// ============================================================================
// LLM Tool Schema & Registration (MCP-Only)
// ============================================================================

export const AiStepToolSchema = z.object({
  statement: z.string().describe('The complete step to execute (e.g., "fill in the login form and submit")'),
});

export function registerAiStepTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'ai_step',
    description: 'Use AI to execute a complete multi-action step. MCP-only tool.',
    schema: AiStepToolSchema,

    async execute(args, ctx) {
      const { statement } = args;
      const { page, agentServices } = ctx;

      try {
        const actionEntity: ActionEntity = {
          action_description: statement,
          action_data: {
            action_name: 'ai_step',
            kwargs: { statement },
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Executed step: ${statement}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: `${statement} (failed)`,
            action_data: {
              action_name: 'ai_step',
              kwargs: { statement },
            },
            feedback: (error as Error).message,
          },
        };
      }
    },

    // MCP-only: Not available for OpenAI function calling
    availability: {
      openai: false,
      mcp: true,
    },
  });
}
