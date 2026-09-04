/**
 * Action Entity Types
 * Core types for representing browser automation actions
 */

export interface ActionDataEntity {
  action_name: string;
  args?: any[];
  kwargs: { [key: string]: any };
}

export interface ActionEntity {
  text?: string;
  tag?: string;
  class?: string;
  locator?: string;
  unique_selector?: string;
  selector_uniqueness_validated?: boolean;
  xpath?: string;
  css_selector?: string;
  frame_path?: string[];
  highlight_index?: number;
  action?: ActionDataEntity; // for backward compatibility
  action_data?: ActionDataEntity;
  url?: string;
  action_description: string;
  feedback?: string;
  artifacts?: Record<string, any>;
}

const NON_SELF_HEALABLE_ACTIONS = [
  'go_to_url',
  'js_code',
  'function',
  'wait',
  'wait_for_download_complete',
  'wait_for_page_ready',
  'extract_email_content',
] as const;

/**
 * Whether a deterministic action may fall back to AI self-healing when it fails.
 * Shared by compiled tests, the SDK action handler, and the visual debugger so
 * every execution path applies the same policy.
 */
export function canActionSelfHeal(actionEntity: Pick<ActionEntity, 'action_data'>): boolean {
  const actionName = actionEntity.action_data?.action_name;
  if (!actionName) return false;

  if (
    (actionName === 'verify' || actionName === 'ai_assert' || actionName === 'assert') &&
    actionEntity.action_data?.kwargs?.code
  ) {
    return false;
  }

  return !(NON_SELF_HEALABLE_ACTIONS as readonly string[]).includes(actionName);
}

export interface ActionCodeGenerationSettings {
  [key: string]: any;
}

/** Human-readable representation of an action step's info */
export interface ActionStepInfo {
  description: string;
  action_entity?: ActionEntity;
  locator?: string; // user picked locator, overwrites the locator in the action entity
}
