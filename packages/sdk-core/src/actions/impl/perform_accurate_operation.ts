import { ToolRegistry } from '../../llm_tools/registry';
import { IAction, ActionEntity } from '../types';
import { z } from 'zod';
import { generateAction as generateActionWithCoordinatesBased } from '../../agent/action-generation/coordinatesBased';
import { TaskExecutionContext } from '../../agent/core/types';
import { executeAction } from '../../agent/agentHelpers';

export const PerformAccurateOperationToolSchema = z.object({
  instruction: z
    .string()
    .describe(
      'The instruction of the operation to perform. Can only include one operation. Do not inlcude element indexes just describe the element, e.g. "select the text "Hello, world!" in "Hello, world!""',
    ),
});

export function registerPerformAccurateOperationTool(registry: ToolRegistry) {
  registry.register({
    name: 'perform_accurate_operation',
    description:
      'Perform an operation that requires accurate interaction like dragging or interacting with a specific area of an element. Only use this action when neccecary.',
    schema: PerformAccurateOperationToolSchema,
    usesElementIndex: false,

    async execute(args, ctx) {
      const { instruction } = args;

      // Create TaskExecutionContext from ToolExecutionContext
      const taskContext: TaskExecutionContext = {
        page: ctx.page,
        agentServices: ctx.agentServices,
        domService: ctx.domService,
      };

      // Generate action using coordinates-based vision mode
      const generatedAction = await generateActionWithCoordinatesBased(instruction, taskContext, {});

      // If generation failed, return error
      if (generatedAction.status === 'error' || !generatedAction.actionEntity) {
        return {
          success: false,
          actionEntity: {
            action_description: instruction,
            action_data: {
              action_name: 'perform_accurate_operation',
              kwargs: { instruction },
            },
          },
          error: generatedAction.error || 'Failed to generate action',
        };
      }

      const { actionEntity } = generatedAction;

      // Execute the generated action using executeAction
      const executionResult = await executeAction(actionEntity, taskContext);

      return {
        success: executionResult.success,
        actionEntity,
        message: executionResult.success 
          ? `Successfully executed action: ${actionEntity.action_data?.action_name}`
          : undefined,
        error: executionResult.error,
      };
    },
  });
}
