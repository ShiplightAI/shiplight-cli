/**
 * ai_extract action - AI-powered data extraction
 *
 * Uses dynamic import to avoid circular dependency
 * (handler.ts -> ai_extract -> agentHelpers -> handler.ts)
 */

import { z } from 'zod';
import { Page } from 'playwright';
import { IAction, ActionEntity } from '../types';
import type { AgentServices } from '../../agent/agentServices';
import { ToolRegistry } from '../../llm_tools/registry';

// ============================================================================
// Action Implementation
// ============================================================================

export class AiExtractAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    const elementDescription = actionData.kwargs.element_description;
    const variableName = actionData.kwargs.variable_name;

    if (!elementDescription || !variableName) {
      throw new Error('Missing element_description or variable_name for ai_extract');
    }

    // Construct the statement for AI to understand what to extract
    const statement = `Extract ${elementDescription} and save to ${variableName}`;

    // Dynamic import to avoid circular dependency
    const { executeStep } = await import('../../agent/agentHelpers');
    const result = await executeStep(statement, page, agentServices);

    if (result.status !== 'success') {
      throw new Error(result.error || 'Extraction failed');
    }
  }

  transpile(actionEntity: ActionEntity, stepId?: string): string[] {
    const elementDescription = actionEntity.action_data?.kwargs?.element_description;
    const variableName = actionEntity.action_data?.kwargs?.variable_name;
    if (!elementDescription || !variableName) {
      return [`// Skipping ai_extract: missing element_description or variable_name`];
    }
    const escapedElementDesc = JSON.stringify(elementDescription);
    const escapedVarName = JSON.stringify(variableName);
    return [`await agent.extract(page, ${escapedElementDesc}, ${escapedVarName}, '${stepId || ''}');`];
  }
}

// ============================================================================
// LLM Tool Schema & Registration (MCP-Only)
// ============================================================================

export const AiExtractToolSchema = z.object({
  element_description: z.string().describe('Description of the element to extract (e.g., "the price of the product")'),
  variable_name: z.string().describe('Name of the variable to store the extracted value'),
});

export function registerAiExtractTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'ai_extract',
    description: 'Use AI to extract information from the page and save it to a variable. MCP-only tool.',
    schema: AiExtractToolSchema,

    async execute(args, ctx) {
      const { element_description, variable_name } = args;
      const { page, agentServices } = ctx;

      try {
        const actionEntity: ActionEntity = {
          action_description: `Extract ${element_description} to ${variable_name}`,
          action_data: {
            action_name: 'ai_extract',
            kwargs: { element_description: element_description, variable_name: variable_name },
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Extracted ${element_description} to ${variable_name}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: `Extract ${element_description} (failed)`,
            action_data: {
              action_name: 'ai_extract',
              kwargs: { element_description: element_description, variable_name: variable_name },
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
