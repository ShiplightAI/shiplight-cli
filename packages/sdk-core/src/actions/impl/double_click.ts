/**
 * double_click action - Double-click an element
 */

import { Page } from 'playwright';
import { z } from 'zod';
import type { AgentServices } from '../../agent/agentServices';
import { ToolRegistry } from '../../llm_tools/registry';
import { getActionEntityLocatorInfo, getDomElementByIndex } from '../../llm_tools/utils';
import { ActionEntity, IAction } from '../types';
import { getActionTimeoutMs, getLocator } from '../utils';

// ============================================================================
// Action Implementation
// ============================================================================

export class DoubleClickAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const locator = getLocator(page, actionEntity);
    const timeout = getActionTimeoutMs(agentServices, actionEntity.action_data?.kwargs?.timeout_ms);
    if (locator) {
      await locator.dblclick({ timeout });
    } else {
      throw new Error('No locator found for double_click action');
    }
  }

  transpile(actionEntity: ActionEntity): string[] {
    const parts: string[] = [];
    if (actionEntity.locator) {
      parts.push(`locator: ${JSON.stringify(actionEntity.locator)}`);
    } else if (actionEntity.xpath) {
      parts.push(`xpath: ${JSON.stringify(actionEntity.xpath)}`);
    }
    if (actionEntity.frame_path && actionEntity.frame_path.length > 0) {
      parts.push(`frame_path: ${JSON.stringify(actionEntity.frame_path)}`);
    }

    if (parts.length === 0) {
      return [`await agent.execAction("double_click", page, {});`];
    }

    return [
      `await agent.execAction("double_click", page, {`,
      ...parts.map(p => `  ${p},`),
      `});`
    ];
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

export const DoubleClickToolSchema = z.object({
  element_index: z.number().int().describe('Index of the element to double-click'),
  timeout_ms: z.number().optional().describe('Per-action timeout in ms. Overrides the default 5s action timeout. Set this only when the instruction states a timeout; otherwise leave it unset so the configured default applies.'),
});

export function registerDoubleClickTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'double_click',
    description: 'Double-click an interactive element.',
    schema: DoubleClickToolSchema,
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
              `Double-click element ${element_index}`,
              'double_click',
              { index: element_index }
            ),
          };
        }

        const description = actionDescription || `Double-click element ${element_index}`;
        const actionEntity = await createActionEntityFromIndex(
          'double_click',
          description,
          domElement,
          page
        );

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Double-clicked element ${element_index}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: createErrorActionEntity(
            `Double-click element ${element_index}`,
            'double_click',
            { index: element_index }
          ),
        };
      }
    },
  });
}
