/**
 * scroll_on_element action - Scroll within a specific element
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

export class ScrollOnElementAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }
    const x = actionData.kwargs.delta_x || 0;
    const y = actionData.kwargs.delta_y || 0;
    const locator = getLocator(page, actionEntity);

    const timeout = getActionTimeoutMs(agentServices, actionEntity.action_data?.kwargs?.timeout_ms);
    if (locator) {
      await locator.hover({ timeout });
      await page.mouse.wheel(x, y);
    } else {
      throw new Error('No locator found for scroll_on_element action');
    }
  }

  transpile(actionEntity: ActionEntity): string[] {
    const locatorExpr = getPageLocatorExpression(actionEntity);
    if (!locatorExpr) {
      const delta_x = actionEntity.action_data?.kwargs?.delta_x || 0;
      const delta_y = actionEntity.action_data?.kwargs?.delta_y || 0;
      return [
        `await agent.execAction("scroll_on_element", page, {`,
        `  action_data: { kwargs: { delta_x: ${delta_x}, delta_y: ${delta_y} } },`,
        `});`
      ];
    }
    const delta_x = actionEntity.action_data?.kwargs?.delta_x || 0;
    const delta_y = actionEntity.action_data?.kwargs?.delta_y || 0;
    return [
      `await ${locatorExpr}.hover({ timeout: ${getActionTimeoutMs()} });`,
      `await page.mouse.wheel(${delta_x}, ${delta_y});`,
    ];
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function createScrollActionEntity(
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
    action_description: `${description} (failed)`,
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

export const ScrollOnElementToolSchema = z.object({
  element_index: z.number().int().describe('Index of the scrollable element'),
  delta_x: z.number().optional().describe('The number of pixels to scroll horizontally. Positive values scroll right, negative values scroll left.'),
  delta_y: z.number().optional().describe('The number of pixels to scroll vertically. Positive values scroll down, negative values scroll up.'),
  timeout_ms: z.number().optional().describe('Per-action timeout in ms. Overrides the default 5s action timeout. Set this only when the instruction states a timeout; otherwise leave it unset so the configured default applies.'),
});

export function registerScrollOnElementTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'scroll_on_element',
    description: 'Scroll on a scrollable element horizontally and vertically.',
    schema: ScrollOnElementToolSchema,
    usesElementIndex: true,

    async execute(args, ctx) {
      const { element_index, delta_x, delta_y } = args;
      const { page, agentServices } = ctx;

      try {
        const domElement = await getDomElementByIndex(ctx, element_index);

        if (!domElement) {
          return {
            success: false,
            error: `Element with index ${element_index} not found`,
            actionEntity: createErrorActionEntity(
              `Scroll on element ${element_index} horizontally: ${delta_x}px, vertically: ${delta_y}px`,
              'scroll_on_element',
              { index: element_index, delta_x, delta_y }
            ),
          };
        }

        const actionEntity = await createScrollActionEntity(
          'scroll_on_element',
          `Scroll on element ${element_index} horizontally: ${delta_x}px, vertically: ${delta_y}px`,
          domElement,
          page,
          { delta_x, delta_y }
        );

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Scrolled on element ${element_index} horizontally: ${delta_x}px, vertically: ${delta_y}px`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: createErrorActionEntity(
            `Scroll on element ${element_index} horizontally: ${delta_x}px, vertically: ${delta_y}px`,
            'scroll_on_element',
            { index: element_index, delta_x, delta_y }
          ),
        };
      }
    },
  });
}
