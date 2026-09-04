/**
 * Default maximum number of agent steps for statement execution.
 * This limits how many actions the AI agent can take to complete a single statement.
 */
export const DEFAULT_MAX_STEPS = 20;

/**
 * Default value for unified AI action and step feature.
 * When true, uses the unified execute_step API for AI-driven actions.
 * Organizations can override this by setting features.unified_ai_action_and_step in their settings.
 */
export const DEFAULT_UNIFIED_AI_ACTION_AND_STEP = false;

/**
 * Default value for auto-dismiss modal feature.
 * When true, uses multi-step self-healing strategy that can dismiss unexpected modals.
 */
export const DEFAULT_AUTO_DISMISS_MODAL = false;
