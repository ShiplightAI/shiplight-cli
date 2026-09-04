/**
 * ai_assert action - AI-powered assertion verification
 *
 * Supports two modes:
 * - AI mode (kwargs.statement): Uses AI to evaluate natural language assertions
 * - JS mode (kwargs.code): Executes Playwright expect expressions directly
 *
 * Uses dynamic import to avoid circular dependency
 * (handler.ts -> ai_assert -> agentHelpers -> handler.ts)
 */

import { z } from 'zod';
import { Page } from 'playwright';
import { expect } from '@playwright/test';
import { IAction, ActionEntity } from '../types';
import type { AgentServices } from '../../agent/agentServices';
import { ToolRegistry } from '../../llm_tools/registry';
import { isValidJavaScriptSyntax } from '../../utils/codeValidation';
import logger from '../../utils/logger';

// ============================================================================
// Action Implementation
// ============================================================================

export class AiAssertAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const kwargs = actionEntity.action_data?.kwargs;

    const hasCode = typeof kwargs?.code === 'string';
    const statement = hasCode
      ? kwargs?.statement || actionEntity.action_description
      : actionEntity.action_description || kwargs?.statement;

    // JS code with AI fallback: try code first, fall back to AI if statement exists
    if (hasCode && statement) {
      const t = Date.now();
      try {
        await this.executeJSAssertion(page, kwargs.code, agentServices);
        logger.info(`[VERIFY:JS] ✓ ${((Date.now() - t) / 1000).toFixed(1)}s: ${statement}`);
        agentServices.addNote(`Assertion passed: ${statement}`);
        return;
      } catch (err) {
        const elapsed = ((Date.now() - t) / 1000).toFixed(1);
        logger.info(`[VERIFY:JS→AI] JS failed ${elapsed}s (${err instanceof Error ? err.message : String(err)}), falling back to AI: ${statement}`);
      }
    } else if (hasCode) {
      // JS-only mode (no statement to fall back to)
      const t = Date.now();
      await this.executeJSAssertion(page, kwargs.code, agentServices);
      logger.info(`[VERIFY:JS] ✓ ${((Date.now() - t) / 1000).toFixed(1)}s: ${statement || 'js-only'}`);
      agentServices.addNote(`Assertion passed: ${statement || 'js-only'}`);
      return;
    }

    // AI mode: use statement
    if (!statement) {
      throw new Error('Missing statement or code for verify action');
    }

    const t = Date.now();
    logger.info(`[VERIFY:AI] Evaluating: ${statement}`);

    // Dynamic import to avoid circular dependency
    const { evaluateStatement } = await import('../../agent/agentHelpers');
    const result = await evaluateStatement(statement, page, agentServices, {
      useCleanScreenshotForAssertion: true,
    });

    // Save explanation to agentNote so it can be returned to frontend
    const explanation = result.explanation || result.error || (result.success ? `Assertion passed: ${statement}` : 'Assertion failed');
    agentServices.addNote(explanation);

    if (!result.success) {
      logger.info(`[VERIFY:AI] ✗ ${((Date.now() - t) / 1000).toFixed(1)}s: ${statement}`);
      throw new Error(result.error || result.explanation || 'Assertion failed');
    }
    logger.info(`[VERIFY:AI] ✓ ${((Date.now() - t) / 1000).toFixed(1)}s: ${statement}`);
  }

  private async executeJSAssertion(page: Page, code: string, agentServices: AgentServices): Promise<void> {
    const agent = agentServices.agent;
    if (!agent) {
      throw new Error('Agent not initialized on AgentServices — ai_assert requires an agent reference');
    }
    try {
      const asyncFunction = new Function('page', 'expect', 'agent', `
        return (async () => {
          ${code}
        })();
      `);

      await asyncFunction(page, expect, agent);
    } catch (error) {
      throw new Error(`Assertion failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  transpile(actionEntity: ActionEntity, stepId?: string): string[] {
    const kwargs = actionEntity.action_data?.kwargs;
    const hasCode = typeof kwargs?.code === 'string';
    const statement = hasCode
      ? kwargs?.statement || actionEntity.action_description
      : actionEntity.action_description || kwargs?.statement;
    const escapedStepId = JSON.stringify(stepId || '');

    // JS code path: validate syntax first
    if (hasCode) {
      const code = kwargs.code;
      if (!isValidJavaScriptSyntax(code)) {
        return [`throw new Error("Invalid assertion code syntax: " + ${JSON.stringify(code)});`];
      }

      // Both code and statement: try/catch with AI fallback
      if (statement) {
        const codeLines = code.split('\n');
        const escapedStatement = JSON.stringify(statement);
        return [
          `{ const _t = Date.now(); try {`,
          `  try {`,
          ...codeLines.map((line: string) => `    ${line}`),
          `  } finally {`,
          `    await agent.replaceStepScreenshot(page, ${escapedStepId});`,
          `  }`,
          `  console.log(\`[VERIFY:JS] ✓ \${((Date.now()-_t)/1000).toFixed(1)}s: ${escapedStatement}\`);`,
          `} catch (_e) {`,
          `  console.log(\`[VERIFY:JS→AI] JS failed \${((Date.now()-_t)/1000).toFixed(1)}s: (\${_e instanceof Error ? _e.message : String(_e)}), falling back to AI: ${escapedStatement}\`);`,
          `  await agent.assert(page, ${escapedStatement}, ${escapedStepId});`,
          `} }`,
        ];
      }

      // JS-only mode
      return [
        `try {`,
        ...code.split('\n').map((line: string) => `  ${line}`),
        `} finally {`,
        `  await agent.replaceStepScreenshot(page, ${escapedStepId});`,
        `}`,
      ];
    }

    // AI mode: use agent.assert
    if (!statement) {
      return [`// Skipping verify: missing statement or code`];
    }
    const escapedStatement = JSON.stringify(statement);
    return [`await agent.assert(page, ${escapedStatement}, ${escapedStepId});`];
  }
}

// ============================================================================
// LLM Tool Schema & Registration (MCP-Only)
// ============================================================================

export const AiAssertToolSchema = z.object({
  statement: z.string().describe('The nature language statement to verify (e.g., "The login was successful")'),
});

export function registerAiAssertTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'verify',
    description: 'Verify that a statement is true based on the current page state. Use this to check assertions about the page content, element visibility, or any condition.',
    schema: AiAssertToolSchema,

    async execute(args, ctx) {
      const { statement } = args;
      const { page, agentServices } = ctx;

      try {
        const actionEntity: ActionEntity = {
          action_description: `${statement}`,
          action_data: {
            action_name: 'verify',
            kwargs: { statement },
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Assertion verified: ${statement}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: `Verify: ${statement} (failed)`,
            action_data: {
              action_name: 'verify',
              kwargs: { statement },
            },
            feedback: (error as Error).message,
          },
        };
      }
    },

    // Available for both OpenAI-style calls and MCP
    availability: {
      openai: true,
      mcp: true,
    },
  });
}
