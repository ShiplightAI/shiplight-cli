/**
 * ai_wait_until action - AI-powered condition waiting
 *
 * Uses dynamic import to avoid circular dependency
 * (handler.ts -> ai_wait_until -> agentHelpers -> handler.ts)
 */

import { z } from 'zod';
import { Page } from 'playwright';
import { expect } from '@playwright/test';
import { ConditionType } from 'shiplight-types';
import { IAction, ActionEntity } from '../types';
import type { AgentServices } from '../../agent/agentServices';
import { ToolRegistry } from '../../llm_tools/registry';
import { waitForJs, formatJsWaitOutcome } from '../../agent/agentWait';
import logger from '../../utils/logger';

// ============================================================================
// Action Implementation
// ============================================================================

/** Outcome of a WAIT_UNTIL condition — met or not, plus a one-line message. */
export interface WaitUntilOutcome {
  met: boolean;
  message: string;
}

/**
 * Run a WAIT_UNTIL condition to completion. WAIT_UNTIL is an optimization of a
 * fixed wait — it synchronizes but never fails the test, so a timeout resolves
 * with `met: false` instead of throwing. Throws only on authoring errors
 * (missing action data / condition).
 */
export async function runWaitUntil(
  page: Page,
  actionEntity: ActionEntity,
  agentServices: AgentServices,
): Promise<WaitUntilOutcome> {
  const actionData = actionEntity.action_data;
  if (!actionData) {
    throw new Error('Action data not found');
  }

  const condition = actionData.kwargs.condition;
  if (!condition) {
    throw new Error('Missing condition for ai_wait_until');
  }

  const timeoutSeconds = actionData.kwargs.timeout_seconds || 60;
  const maxWaitSeconds = Math.min(timeoutSeconds, 300);

  // JS_CODE condition: poll a JavaScript predicate in-process — no model calls.
  // Like js_code, the code runs in an async fn with page/expect/agent in scope; here
  // it wraps an *expression* (as IF/WHILE js: do), and `agent` may be undefined.
  // The intent + sibling `js:` form stores the polled expression in `js` (with the
  // human-readable intent in `condition`); the bare prefix form stores it in `condition`.
  if (actionData.kwargs.condition_type === ConditionType.JS_CODE) {
    const expression = typeof actionData.kwargs.js === 'string' ? actionData.kwargs.js : condition;
    let predicate: (p: Page, e: typeof expect, a: unknown) => Promise<unknown>;
    try {
      predicate = new Function('page', 'expect', 'agent', `
        return (async () => (${expression}))();
      `) as typeof predicate;
    } catch (error) {
      // An unparseable expression can't be polled — degrade to the fixed wait
      // the author intended and surface the parse error as the outcome.
      await page.waitForTimeout(maxWaitSeconds * 1000);
      return {
        met: false,
        message:
          `Condition could not be parsed as JavaScript: ${(error as Error).message}. ` +
          `Waited the full ${maxWaitSeconds}s — continuing`,
      };
    }

    const result = await waitForJs(
      page,
      () => predicate(page, expect, agentServices.agent),
      maxWaitSeconds,
    );
    return { met: result.met, message: formatJsWaitOutcome(result) };
  }

  const timeoutMs = maxWaitSeconds * 1000;
  const interval = 5000; // Check every 5 seconds
  const startTime = Date.now();

  // Dynamic import to avoid circular dependency
  const { evaluateStatement } = await import('../../agent/agentHelpers');
  while (Date.now() - startTime < timeoutMs) {
    const result = await evaluateStatement(condition, page, agentServices, {});
    if (result.success) {
      return { met: true, message: `Condition met: ${condition}` };
    }
    await page.waitForTimeout(interval);
  }

  return {
    met: false,
    message: `Condition not met within ${maxWaitSeconds}s: ${condition} — continuing`,
  };
}

export class AiWaitUntilAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const outcome = await runWaitUntil(page, actionEntity, agentServices);
    if (!outcome.met) {
      // Soft outcome — surface via the agent note so the step result and
      // execution history carry the warning without failing the statement.
      logger.warn(outcome.message);
      agentServices.addNote?.(outcome.message);
    }
  }

  transpile(actionEntity: ActionEntity, stepId: string): string[] {
    const condition = actionEntity.action_data?.kwargs?.condition;
    const timeoutSeconds = actionEntity.action_data?.kwargs?.timeout_seconds || 60;
    if (!condition) {
      return [`// Skipping ai_wait_until: missing condition`];
    }
    // JS_CODE condition: inline the expression as a predicate polled in-process (no model calls).
    // In the intent + sibling `js:` form, the expression lives in `js` and `condition`
    // holds the intent, which is passed through as the step description.
    if (actionEntity.action_data?.kwargs?.condition_type === ConditionType.JS_CODE) {
      const js = actionEntity.action_data?.kwargs?.js;
      const expression = typeof js === 'string' ? js : condition;
      const intentArg = typeof js === 'string' ? `, ${JSON.stringify(condition)}` : '';
      return [`await agent.waitForJs(page, async () => (${expression}), ${timeoutSeconds}, '${stepId}'${intentArg});`];
    }
    const escapedCondition = JSON.stringify(condition);
    return [`await agent.waitUntilCondition(page, ${escapedCondition}, ${timeoutSeconds}, '${stepId}');`];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const AiWaitUntilToolSchema = z.object({
  condition: z.string().describe('The condition to wait for (e.g., "the loading spinner disappears")'),
  timeout_seconds: z.number().positive().optional().describe('Timeout in seconds. Set this only when the instruction states a timeout; otherwise leave it unset so the 60s default applies.'),
});

export function registerAiWaitUntilTool(registry: ToolRegistry) {
  registry.register({
    name: 'ai_wait_until',
    description: 'Wait until a specific condition is met on the page (e.g., "page loads", "spinner disappears", "button becomes enabled"). Use this instead of wait when the goal is to wait for something to happen rather than waiting a fixed duration.',
    schema: AiWaitUntilToolSchema,

    async execute(args, ctx) {
      const { condition, timeout_seconds = 60 } = args;
      const { page, agentServices } = ctx;

      try {
        const actionEntity: ActionEntity = {
          action_description: `Wait until: ${condition}`,
          action_data: {
            action_name: 'ai_wait_until',
            kwargs: { condition, timeout_seconds },
          },
        };

        // A wait never fails the test — a timeout is a successful (soft)
        // outcome whose message tells the agent the condition was not met.
        const outcome = await runWaitUntil(page, actionEntity, agentServices);
        if (!outcome.met) {
          agentServices.addNote?.(outcome.message);
        }

        return {
          success: true,
          actionEntity,
          message: outcome.message,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: `Wait until: ${condition} (failed)`,
            action_data: {
              action_name: 'ai_wait_until',
              kwargs: { condition, timeout_seconds },
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}
