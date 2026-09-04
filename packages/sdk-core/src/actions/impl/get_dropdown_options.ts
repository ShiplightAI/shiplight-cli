/**
 * get_dropdown_options action - Get all options from a native dropdown
 */

import { Page } from 'playwright';
import { z } from 'zod';
import { AgentServices } from '../../agent/agentServices';
import { ToolRegistry } from '../../llm_tools/registry';
import { getActionEntityLocatorInfo, getDomElementByIndex } from '../../llm_tools/utils';
import { ActionEntity, IAction } from '../types';

// ============================================================================
// Action Implementation
// ============================================================================

export class GetDropdownOptionsAction implements IAction {
  async execute(
    page: Page,
    actionEntity: ActionEntity,
    agentServices: AgentServices
  ): Promise<void> {
    if (!actionEntity.xpath) {
      throw new Error('XPath not found in action entity');
    }

    // Frame-aware approach - iterate through all frames
    const allOptions: string[] = [];

    for (const frame of page.frames()) {
      try {
        const options = await frame.evaluate(
          (xpath: string) => {
            const select = document.evaluate(
              xpath,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            ).singleNodeValue as HTMLSelectElement | null;

            if (!select) return null;

            return {
              options: Array.from(select.options).map((opt) => ({
                text: opt.text, // do not trim, because we are doing exact match in select_dropdown_option
                value: opt.value,
                index: opt.index,
              })),
              id: select.id,
              name: select.name,
            };
          },
          actionEntity.xpath
        );

        if (options) {
          const formattedOptions: string[] = [];
          for (const opt of options.options) {
            // encoding ensures AI uses the exact string in select_dropdown_option
            const encodedText = JSON.stringify(opt.text);
            formattedOptions.push(`${opt.index}: text=${encodedText}`);
          }

          allOptions.push(...formattedOptions);
        }
      } catch (frameError) {
        // Continue to next frame if evaluation fails
        // Frame evaluation errors are expected for frames that don't contain the element
      }
    }

    // Store the result in actionEntity.feedback for the tool registration to read
    if (allOptions.length > 0) {
      let msg = allOptions.join('\n');
      msg += '\nUse the exact text string in select_dropdown_option';
      agentServices.addNote(msg);
    } else {
      agentServices.addNote('No options found in any frame for dropdown');
    }
  }

  transpile(actionEntity: ActionEntity): string[] {
    const parts: string[] = [];
    if (actionEntity.xpath) {
      parts.push(`xpath: ${JSON.stringify(actionEntity.xpath)}`);
    }
    if (actionEntity.frame_path && actionEntity.frame_path.length > 0) {
      parts.push(`frame_path: ${JSON.stringify(actionEntity.frame_path)}`);
    }

    if (parts.length === 0) {
      return [`await agent.execAction("get_dropdown_options", page, {});`];
    }

    return [
      `await agent.execAction("get_dropdown_options", page, {`,
      ...parts.map(p => `  ${p},`),
      `});`
    ];
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function createGetDropdownOptionsActionEntity(
  domElement: any,
  page: Page,
  description?: string
): Promise<ActionEntity> {
  const locatorInfo = await getActionEntityLocatorInfo(page, domElement);

  return {
    ...locatorInfo,
    action_description: description || `Get dropdown options`,
    action_data: {
      action_name: 'get_dropdown_options',
      kwargs: {},
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
      action_name: 'get_dropdown_options',
      kwargs,
    },
    feedback: 'Element not found in DOM',
  };
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const GetDropdownOptionsToolSchema = z.object({
  element_index: z.number().int().describe('Index of the dropdown/select element'),
});

export function registerGetDropdownOptionsTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'get_dropdown_options',
    description: 'Get all options from a native dropdown',
    schema: GetDropdownOptionsToolSchema,
    usesElementIndex: true,

    async execute(args, ctx) {
      const { element_index } = args;
      const { page, agentServices, actionDescription } = ctx as any;

      try {
        const domElement = await getDomElementByIndex(ctx, element_index);

        if (!domElement) {
          return {
            success: false,
            error: `Dropdown element with index ${element_index} not found`,
            actionEntity: createErrorActionEntity(
              actionDescription || `Get options from dropdown ${element_index}`,
              { index: element_index }
            ),
          };
        }

        const actionEntity = await createGetDropdownOptionsActionEntity(domElement, page, actionDescription);

        // Execute the action to extract options (stores result in actionEntity.feedback)
        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: actionEntity.feedback || 'No options found',
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: createErrorActionEntity(
            actionDescription || `Get options from dropdown ${element_index}`,
            { index: element_index }
          ),
        };
      }
    },
  });
}
