/**
 * click action - Click an element
 */

import { Page } from 'playwright';
import { z } from 'zod';
import type { AgentServices } from '../../agent/agentServices';
import { ToolRegistry } from '../../llm_tools/registry';
import { getActionEntityLocatorInfo, getDomElementByIndex } from '../../llm_tools/utils';
import { ActionEntity, IAction } from '../types';
import { getActionTimeoutMs, getLocator, getPageLocatorExpression } from '../utils';

// ============================================================================
// Action Implementation
// ============================================================================

export class ClickAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const locator = getLocator(page, actionEntity);
    const timeout = getActionTimeoutMs(agentServices, actionEntity.action_data?.kwargs?.timeout_ms);
    if (locator) {
      await locator.click({ timeout });
    } else {
      throw new Error('No locator found for click action');
    }
  }

  transpile(actionEntity: ActionEntity): string[] {
    const locatorExpr = getPageLocatorExpression(actionEntity);
    if (!locatorExpr) {
      return [`await agent.execAction("click", page, {});`];
    }
    const timeout = getActionTimeoutMs();
    return [`await ${locatorExpr}.click({ timeout: ${timeout} });`];
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function createActionEntityFromIndex(
  actionName: string,
  description: string,
  domElement: any,
  page: Page,
  kwargs: any = {}
): Promise<ActionEntity> {
  const locatorInfo = await getActionEntityLocatorInfo(page, domElement);

  return {
    ...locatorInfo,
    action_description: description,
    action_data: {
      action_name: actionName,
      kwargs: { ...kwargs },
    },
  };
}

function createErrorActionEntity(
  description: string,
  actionName: string,
  kwargs: any
): ActionEntity {
  return {
    action_description: `${description} (failed - element not found)`,
    action_data: {
      action_name: actionName,
      kwargs,
    },
    feedback: 'Element not found in DOM',
  };
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const ClickToolSchema = z.object({
  element_index: z.number().int().describe('Index of the element to click (0-based). Return -1 if no element found'),
  timeout_ms: z.number().optional().describe('Per-action timeout in ms. Overrides the default 5s action timeout. Set this only when the instruction states a timeout; otherwise leave it unset so the configured default applies.'),
});

export function registerClickTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'click',
    description: 'Click an interactive element.',
    schema: ClickToolSchema,
    usesElementIndex: true,

    async execute(args, ctx) {
      const { element_index } = args;
      const { page, agentServices, actionDescription } = ctx as any;

      try {
        const domElement = await getDomElementByIndex(ctx, element_index);

        if (!domElement) {
          return {
            success: false,
            error: `Element with index ${element_index} not found.`,
            actionEntity: createErrorActionEntity(
              `Click element ${element_index}`,
              'click',
              { index: element_index }
            ),
          };
        }

        const description = actionDescription || `Click element ${element_index}`;
        const actionEntity = await createActionEntityFromIndex(
          'click',
          description,
          domElement,
          page
        );

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Clicked element ${element_index}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: createErrorActionEntity(
            `Click element ${element_index}`,
            'click',
            { index: element_index }
          ),
        };
      }
    },
  });
}
