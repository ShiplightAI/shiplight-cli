/**
 * js_code action - Execute custom JavaScript code
 */

import { Page } from 'playwright';
import { expect } from '@playwright/test';
import { z } from 'zod';
import type { AgentServices } from '../../agent/agentServices';
import { ToolRegistry } from '../../llm_tools/registry';
import { ActionEntity, IAction } from '../types';

// ============================================================================
// Action Implementation
// ============================================================================

export class JsCodeAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    const code = actionData.kwargs.code;
    if (!code) {
      throw new Error('Missing code for js_code action');
    }

    // Execute the JavaScript code in an async context with access to page, expect, and agent.
    // This mirrors generated Playwright tests, where CODE blocks run in a file that imports expect.
    const agent = agentServices.agent;
    if (!agent) {
      throw new Error('Agent not initialized on AgentServices — js_code requires an agent reference');
    }
    const asyncFunction = new Function('page', 'expect', 'agent', `
      return (async () => {
        ${code}
      })();
    `);

    await asyncFunction(page, expect, agent);
  }

  transpile(actionEntity: ActionEntity): string[] {
    const code = actionEntity.action_data?.kwargs?.code;
    if (!code) {
      return [`// Skipping js_code: missing code`];
    }
    const lines: string[] = ['{'];
    const codeLines = code.split('\n');
    for (const codeLine of codeLines) {
      lines.push(`  ${codeLine}`);
    }
    lines.push('}');
    return lines;
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const JsCodeToolSchema = z.object({
  code: z.string().describe('JavaScript code to execute in the browser context'),
});

export function registerJsCodeTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'js_code',
    description: 'Execute custom JavaScript code in the browser context. Use for advanced interactions not covered by other tools.',
    schema: JsCodeToolSchema,
    availability: {
      openai: false, // Not exposed to agent - implementation detail only
      mcp: true,     // Available for human debugging via MCP
    },

    async execute(args, ctx) {
      const { code } = args;
      const { page, agentServices } = ctx;

      try {
        const actionEntity: ActionEntity = {
          action_description: `Execute JS: ${code.substring(0, 50)}${code.length > 50 ? '...' : ''}`,
          action_data: {
            action_name: 'js_code',
            kwargs: { code },
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: 'Executed JavaScript code',
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: `Execute JS (failed)`,
            action_data: {
              action_name: 'js_code',
              kwargs: { code },
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}
