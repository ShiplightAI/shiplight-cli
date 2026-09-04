/**
 * TestFlow Converter
 * Converts mobile Trajectory format to TestFlow v1.2.0 format for platform integration
 */

import type { Trajectory } from '../agents/vision';
import type { TestFlow, Action, StatementType, ActionEntity } from 'shiplight-types';
import { MobileActionType } from '../agents/vision';
import { nanoid } from 'nanoid';

/**
 * Helper function to safely convert Date or string to ISO string
 */
function toISOString(dateOrString: Date | string | undefined): string | undefined {
  if (!dateOrString) return undefined;
  if (typeof dateOrString === 'string') return dateOrString;
  return dateOrString.toISOString();
}

/**
 * Convert mobile Trajectory to TestFlow v1.2.0 format
 */
export function convertTrajectoryToTestFlow(
  trajectory: Trajectory,
  options: { goal?: string; url?: string; task?: string } = {}
): TestFlow {
  const url = options.url || 'mobile://app';
  const goal = options.goal || options.task || 'Execute mobile automation task';

  // Convert steps to statements (as Action statements)
  const statements: Action[] = trajectory.steps.map((step, index) => {
    const actionEntity = convertMobileActionToActionEntity(step.action.type, step.action.parameters);

    return {
      uid: nanoid(),
      type: 'ACTION' as StatementType.ACTION,
      description: step.action.reasoning || `Step ${index + 1}: ${step.action.type}`,
      action_entity: actionEntity,
    };
  });

  return {
    version: '1.2.0',
    goal,
    url,
    final_feedback: trajectory.success
      ? `Task completed successfully with ${trajectory.steps.length} steps`
      : `Task failed after ${trajectory.steps.length} steps`,
    completed: true,
    success: trajectory.success,
    statements,
    last_modified_at: toISOString(trajectory.metadata.endTime) || new Date().toISOString(),
  };
}

/**
 * Convert mobile action to ActionEntity format
 */
function convertMobileActionToActionEntity(
  actionType: MobileActionType | string,
  parameters: Record<string, any>
): ActionEntity {
  const url = 'mobile://app';
  const action_description = `Perform ${actionType}`;
  const feedback = '';

  switch (actionType) {
    case MobileActionType.TAP:
      // Mobile tap → Web click
      return {
        url,
        action_description,
        feedback,
        action_data: {
          action_name: 'click',
          args: [],
          kwargs: {
            x: parameters.x,
            y: parameters.y,
          },
        },
      };

    case MobileActionType.DOUBLE_TAP:
      return {
        url,
        action_description,
        feedback,
        action_data: {
          action_name: 'double_click',
          args: [],
          kwargs: { x: parameters.x, y: parameters.y },
        },
      };

    case MobileActionType.INPUT:
      return {
        url,
        action_description,
        feedback,
        action_data: {
          action_name: 'fill',
          args: [],
          kwargs: { text: parameters.text },
        },
      };

    case MobileActionType.SWIPE:
      return {
        url,
        action_description,
        feedback,
        action_data: {
          action_name: 'scroll',
          args: [],
          kwargs: {
            direction: parameters.direction,
            distance: parameters.distance,
          },
        },
      };

    case MobileActionType.SWIPE_POINTS:
      return {
        url,
        action_description,
        feedback,
        action_data: {
          action_name: 'drag',
          args: [],
          kwargs: {
            from_x: parameters.from.x,
            from_y: parameters.from.y,
            to_x: parameters.to.x,
            to_y: parameters.to.y,
          },
        },
      };

    case MobileActionType.LONG_PRESS:
      return {
        url,
        action_description,
        feedback,
        action_data: {
          action_name: 'long_press',
          args: [],
          kwargs: {
            x: parameters.x,
            y: parameters.y,
            duration: parameters.duration,
          },
        },
      };

    case MobileActionType.BACK:
      return {
        url,
        action_description,
        feedback,
        action_data: {
          action_name: 'navigate',
          args: [],
          kwargs: { direction: 'back' },
        },
      };

    case MobileActionType.HOME:
      return {
        url,
        action_description,
        feedback,
        action_data: {
          action_name: 'custom',
          args: [],
          kwargs: { action: 'home' },
        },
      };

    case MobileActionType.WAIT:
      return {
        url,
        action_description,
        feedback,
        action_data: {
          action_name: 'wait',
          args: [],
          kwargs: { seconds: parameters.seconds || 1 },
        },
      };

    case MobileActionType.GENERATE_VERIFICATION:
      return {
        url,
        action_description,
        feedback,
        action_data: {
          action_name: 'assert',
          args: [],
          kwargs: { condition: parameters.condition },
        },
      };

    case MobileActionType.SCREENSHOT:
      return {
        url,
        action_description,
        feedback,
        action_data: {
          action_name: 'screenshot',
          args: [],
          kwargs: {},
        },
      };

    case MobileActionType.DONE:
      return {
        url,
        action_description,
        feedback,
        action_data: {
          action_name: 'done',
          args: [],
          kwargs: {
            text: parameters.text,
            success: parameters.success,
          },
        },
      };

    default:
      return {
        url,
        action_description,
        feedback,
        action_data: {
          action_name: actionType,
          args: [],
          kwargs: parameters,
        },
      };
  }
}
