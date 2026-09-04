/**
 * select_dropdown_option action - Select an option from a dropdown
 */

import { z } from 'zod';
import { Page } from 'playwright';
import type { AgentServices } from '../../agent/agentServices';
import { IAction, ActionEntity } from '../types';
import { getActionTimeoutMs, getLocator } from '../utils';
import { ToolRegistry } from '../../llm_tools/registry';
import { getActionEntityLocatorInfo, getDomElementByIndex } from '../../llm_tools/utils';

// ============================================================================
// Action Implementation
// ============================================================================

export class SelectDropdownOptionAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    const optionLabel = actionData.kwargs.text || actionData.kwargs.option;
    const locator = getLocator(page, actionEntity);

    const timeout = getActionTimeoutMs(agentServices, actionEntity.action_data?.kwargs?.timeout_ms);
    if (locator && optionLabel) {
      await locator.selectOption(optionLabel, { timeout });
    } else {
      throw new Error('Missing locator or option label for select_dropdown_option action');
    }
  }

  transpile(actionEntity: ActionEntity): string[] {
    const text = actionEntity.action_data?.kwargs?.text || actionEntity.action_data?.kwargs?.option || '';
    const parts: string[] = [];
    parts.push(`action_data: { kwargs: { text: ${JSON.stringify(text)} } }`);
    if (actionEntity.locator) {
      parts.push(`locator: ${JSON.stringify(actionEntity.locator)}`);
    } else if (actionEntity.xpath) {
      parts.push(`xpath: ${JSON.stringify(actionEntity.xpath)}`);
    }
    if (actionEntity.frame_path && actionEntity.frame_path.length > 0) {
      parts.push(`frame_path: ${JSON.stringify(actionEntity.frame_path)}`);
    }

    return [
      `await agent.execAction("select_dropdown_option", page, {`,
      ...parts.map(p => `  ${p},`),
      `});`
    ];
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function createSelectActionEntity(
  domElement: any,
  page: Page,
  option: string,
  description?: string
): Promise<ActionEntity> {
  const locatorInfo = await getActionEntityLocatorInfo(page, domElement);

  return {
    ...locatorInfo,
    action_description: description || `Select option "${option}"`,
    action_data: {
      action_name: 'select_dropdown_option',
      kwargs: { text: option },
    },
  };
}

function createErrorActionEntity(
  description: string,
  kwargs: any
): ActionEntity {
  return {
    action_description: `${description} (failed - element not found)`,
    action_data: {
      action_name: 'select_dropdown_option',
      kwargs,
    },
    feedback: 'Element not found in DOM',
  };
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const SelectDropdownOptionToolSchema = z.object({
  element_index: z.number().int().describe('Index of the dropdown/select element'),
  option: z.string().describe('Option value, label, or index to select'),
  timeout_ms: z.number().optional().describe('Per-action timeout in ms. Overrides the default 5s action timeout. Set this only when the instruction states a timeout; otherwise leave it unset so the configured default applies.'),
});

export function registerSelectDropdownOptionTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'select_dropdown_option',
    description: 'Select an option from a dropdown/select element by value, label, or index.',
    schema: SelectDropdownOptionToolSchema,
    usesElementIndex: true,

    async execute(args, ctx) {
      const { element_index, option } = args;
      const { page, agentServices, actionDescription } = ctx as any;

      try {
        const domElement = await getDomElementByIndex(ctx, element_index);

        if (!domElement) {
          return {
            success: false,
            error: `Dropdown element with index ${element_index} not found`,
            actionEntity: createErrorActionEntity(
              actionDescription || `Select option in dropdown ${element_index}`,
              { index: element_index, option }
            ),
          };
        }

        const actionEntity = await createSelectActionEntity(domElement, page, option, actionDescription);

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Selected option "${option}" in dropdown ${element_index}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: createErrorActionEntity(
            `Select option in dropdown ${element_index}`,
            { index: element_index, option }
          ),
        };
      }
    },
  });
}
