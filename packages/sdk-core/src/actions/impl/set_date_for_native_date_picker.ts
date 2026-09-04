/**
 * set_date_for_native_date_picker action - Set a date in a native HTML date picker input
 *
 * IMPORTANT: This action is ONLY for native HTML date picker inputs (<input type="date">).
 * Do NOT use for custom date pickers built with divs, JavaScript libraries, or React components.
 * For custom date pickers, use AI-powered actions instead.
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

export class SetDateForNativeDatePickerAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    const date = actionData.kwargs.date;
    if (!date) {
      throw new Error('Date value is required');
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new Error(`Invalid date format: ${date}. Expected format: YYYY-MM-DD (e.g., 2024-03-15)`);
    }

    const cleanDate = agentServices.replaceVariables(String(date));
    const locator = getLocator(page, actionEntity);

    if (locator) {
      // Optional: Verify element is actually a date input
      const inputType = await locator.getAttribute('type').catch(() => null);
      if (inputType && inputType !== 'date') {
        throw new Error(`Element is not a native date picker (type="${inputType}"). This action only works with <input type="date">. For custom date pickers, use AI-powered actions.`);
      }

      // Set the date value using fill() - most reliable for date inputs
      await locator.fill(cleanDate, { timeout: getActionTimeoutMs(agentServices, actionEntity.action_data?.kwargs?.timeout_ms) });
    } else {
      throw new Error('No locator found for set_date_for_native_date_picker action');
    }
  }

  transpile(actionEntity: ActionEntity): string[] {
    const date = actionEntity.action_data?.kwargs?.date ?? '';
    const parts: string[] = [];
    parts.push(`action_data: { kwargs: { date: ${JSON.stringify(date)} } }`);
    if (actionEntity.locator) {
      parts.push(`locator: ${JSON.stringify(actionEntity.locator)}`);
    } else if (actionEntity.xpath) {
      parts.push(`xpath: ${JSON.stringify(actionEntity.xpath)}`);
    }
    if (actionEntity.frame_path && actionEntity.frame_path.length > 0) {
      parts.push(`frame_path: ${JSON.stringify(actionEntity.frame_path)}`);
    }

    return [
      `await agent.execAction("set_date_for_native_date_picker", page, {`,
      ...parts.map(p => `  ${p},`),
      `});`
    ];
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function createSetDateActionEntity(
  description: string,
  domElement: any,
  page: Page,
  date: string
): Promise<ActionEntity> {
  const locatorInfo = await getActionEntityLocatorInfo(page, domElement);

  return {
    ...locatorInfo,
    action_description: description,
    action_data: {
      action_name: 'set_date_for_native_date_picker',
      kwargs: { date },
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
      action_name: 'set_date_for_native_date_picker',
      kwargs,
    },
    feedback: 'Element not found in DOM',
  };
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const SetDateToolSchema = z.object({
  element_index: z.number().int().describe('Index of the native date picker input element'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date in YYYY-MM-DD format (e.g., 2024-03-15)'),
  timeout_ms: z.number().optional().describe('Per-action timeout in ms. Overrides the default 5s action timeout. Set this only when the instruction states a timeout; otherwise leave it unset so the configured default applies.'),
});

export function registerSetDateForNativeDatePickerTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'set_date_for_native_date_picker',
    description: `Set a date in a native HTML date picker input (<input type="date">).

IMPORTANT: ONLY use this action for input elements that have type="date" attribute (native HTML date picker).
Do NOT use it for custom/non-native date pickers

The date must be in YYYY-MM-DD format (e.g., 2024-03-15).`,
    schema: SetDateToolSchema,
    usesElementIndex: true,

    async execute(args, ctx) {
      const { element_index, date } = args;
      const { page, agentServices } = ctx;

      try {
        const domElement = await getDomElementByIndex(ctx, element_index);

        if (!domElement) {
          return {
            success: false,
            error: `Date picker element with index ${element_index} not found`,
            actionEntity: createErrorActionEntity(
              `Set date to ${date} on element ${element_index}`,
              { index: element_index, date }
            ),
          };
        }

        // Verify it's a native date input
        const inputType = domElement.attributes.type;
        if (inputType !== 'date') {
          return {
            success: false,
            error: `Element ${element_index} is not a native date picker (type="${inputType}"). This action only works with <input type="date">.`,
            actionEntity: createErrorActionEntity(
              `Set date to ${date} on element ${element_index}`,
              { index: element_index, date }
            ),
          };
        }

        const actionEntity = await createSetDateActionEntity(
          `Set date to ${date} on element ${element_index}`,
          domElement,
          page,
          date
        );

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Set date to ${date} on element ${element_index}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: createErrorActionEntity(
            `Set date to ${date} on element ${element_index}`,
            { index: element_index, date }
          ),
        };
      }
    },
  });
}
