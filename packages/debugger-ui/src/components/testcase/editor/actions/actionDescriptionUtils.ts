import type { ActionEntity } from 'shiplight-types';

const ACTIONS_WITH_STATEMENT_KWARG = new Set(['ai_assert', 'verify', 'ai_action', 'ai_step']);

/**
 * Updates the description of a non-assertion action.
 *
 * Generated actions are invalidated so they can be regenerated from the new
 * description. Code actions are hand-written, so their entity and JavaScript
 * must remain intact when only the user-facing description changes.
 */
export function updateNonAssertionActionEntityDescription(
  actionEntity: ActionEntity,
  newDescription: string,
): ActionEntity | undefined {
  const updatedActionEntity: ActionEntity = {
    ...actionEntity,
    action_description: newDescription,
  };
  const actionData = updatedActionEntity.action_data;
  const actionName = actionData?.action_name;

  if (actionData && actionName && ACTIONS_WITH_STATEMENT_KWARG.has(actionName)) {
    return {
      ...updatedActionEntity,
      action_data: {
        ...actionData,
        action_name: actionName,
        kwargs: {
          ...actionData.kwargs,
          statement: newDescription,
        },
      },
    };
  }

  if (actionName === 'js_code') {
    return updatedActionEntity;
  }

  return undefined;
}
