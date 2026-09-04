/**
 * ai_action action - AI-powered action execution
 *
 * Uses dynamic import to avoid circular dependency
 * (handler.ts -> ai_action -> agentHelpers -> handler.ts)
 */

import { Page } from 'playwright';
import { z } from 'zod';
import { ToolRegistry } from '../../llm_tools/registry';
import { ActionEntity, IAction } from '../types';
import type { AgentServices } from '../../agent/agentServices';

// ============================================================================
// Action Implementation
// ============================================================================

export class AiActionAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    const statement = actionData.kwargs.statement;
    if (!statement) {
      throw new Error('Missing statement for ai_action');
    }

    const usePureVision = actionData.kwargs.use_pure_vision;

    // Dynamic import to avoid circular dependency
    const { executeStep } = await import('../../agent/agentHelpers');
    const result = await executeStep(statement, page, agentServices, { usePureVision });

    if (result.status !== 'success') {
      throw new Error(result.error || 'Action execution failed');
    }
  }

  transpile(actionEntity: ActionEntity, stepId?: string): string[] {
    const statement = actionEntity.action_data?.kwargs?.statement;
    if (!statement) {
      return [`// Skipping ai_action: missing statement`];
    }
    const escapedStatement = JSON.stringify(statement);
    const usePureVision = actionEntity.action_data?.kwargs?.use_pure_vision;
    return [`await agent.execute(page, ${escapedStatement}, '${stepId || ''}', ${usePureVision});`];
  }
}

// ============================================================================
// LLM Tool Schema & Registration (MCP-Only)
// ============================================================================

export const AiActionToolSchema = z.object({
  statement: z.string().describe('The action to perform (e.g., "click the submit button")'),
});

export function registerAiActionTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'ai_action',
    description: 'Use AI to perform a specific action on the page. MCP-only tool.',
    schema: AiActionToolSchema,

    async execute(args, ctx) {
      const { statement } = args;
      const { page, agentServices } = ctx;

      try {
        const actionEntity: ActionEntity = {
          action_description: statement,
          action_data: {
            action_name: 'ai_action',
            kwargs: { statement },
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Performed action: ${statement}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: `${statement} (failed)`,
            action_data: {
              action_name: 'ai_action',
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
