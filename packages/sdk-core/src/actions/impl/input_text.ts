/**
 * input_text action - Type text into an input field (appends to existing content)
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

export class InputTextAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    // Support both 'text' (input_text) and 'value' (legacy fill action)
    const text = actionData.kwargs.text ?? actionData.kwargs.value ?? '';
    const cleanText = agentServices.replaceVariables(String(text));
    const locator = getLocator(page, actionEntity);
    const timeout = getActionTimeoutMs(agentServices, actionEntity.action_data?.kwargs?.timeout_ms);

    if (locator) {
      // Clear existing value if present
      await locator.evaluate((el: any) => {
        if (el.value) {
          el.value = "";
        }
      }, null, { timeout });

      await locator.click({ timeout });
      await page.waitForTimeout(200);
      
      // Use type_delay from organization settings if available
      const actionSettings = agentServices.getActionSettings();
      const typeDelay = actionSettings.type_delay;
      if (typeDelay !== undefined) {
        await page.keyboard.type(cleanText, {
          delay: typeDelay,
        });
      } else {
        await page.keyboard.type(cleanText);
      }
    } else {
      throw new Error('No locator found for input_text action');
    }
  }

  transpile(actionEntity: ActionEntity): string[] {
    // Support both 'text' (input_text) and 'value' (legacy fill action)
    const text = actionEntity.action_data?.kwargs?.text ?? actionEntity.action_data?.kwargs?.value ?? '';
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
      `await agent.execAction("input_text", page, {`,
      ...parts.map(p => `  ${p},`),
      `});`
    ];
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function createInputActionEntity(
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

export const InputTextToolSchema = z.object({
  element_index: z.number().int().describe('Index of the input element'),
  text: z.string().describe('Text to type into the input. To use a placeholder, write {{ placeholder_name }} using exact placeholder name. Use clear_input first if you want to replace existing content.'),
  timeout_ms: z.number().optional().describe('Per-action timeout in ms. Overrides the default 5s action timeout. Set this only when the instruction states a timeout; otherwise leave it unset so the configured default applies.'),
});

export function registerInputTextTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'input_text',
    description: 'Type text into an input field. To replace existing content, use clear_input first.',
    schema: InputTextToolSchema,
    usesElementIndex: true,

    async execute(args, ctx) {
      const { element_index, text } = args;
      const { page, agentServices, actionDescription } = ctx as any;

      try {
        const domElement = await getDomElementByIndex(ctx, element_index);

        if (!domElement) {
          return {
            success: false,
            error: `Input element with index ${element_index} not found`,
            actionEntity: createErrorActionEntity(
              actionDescription || `Input text to element ${element_index}`,
              'input_text',
              { index: element_index, text }
            ),
          };
        }

        const description = actionDescription || `Input text to element ${element_index}`;
        const actionEntity = await createInputActionEntity(
          'input_text',
          description,
          domElement,
          page,
          { text }
        );

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Input text to element ${element_index}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: createErrorActionEntity(
            `Input text to element ${element_index}`,
            'input_text',
            { index: element_index, text }
          ),
        };
      }
    },
  });
}
