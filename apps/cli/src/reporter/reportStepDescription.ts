import type { ActionStepInfo } from 'shiplight-types';

/** Resolve the user-visible description for one report step. */
export function resolveReportStepDescription(
  stepId: string,
  actionInfo: ActionStepInfo | undefined,
  executedDescription: string | undefined,
): string {
  if (executedDescription) return executedDescription;

  let description = actionInfo?.description;
  if (!description || description === 'Action' || description === 'Draft') {
    const actionEntity = actionInfo?.action_entity;
    description =
      actionEntity?.action_description ||
      actionEntity?.action_data?.kwargs?.description ||
      stepId;
  }
  return description ?? stepId;
}
