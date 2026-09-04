/**
 * Action Handler - Unified action execution and transpilation
 *
 * Provides a clean interface for executing and transpiling actions without
 * needing to instantiate individual action classes.
 */

import { Page } from 'playwright';
import { ActionEntity, IAction } from './types';
import { ActionHelper } from './actionHelper';

// Navigation actions
import { DoneAction } from './impl/done';
import { GoBackAction } from './impl/go_back';
import { GoToUrlAction } from './impl/go_to_url';
import { ReloadPageAction } from './impl/reload_page';
import { WaitAction } from './impl/wait';
import { WaitForPageReadyAction } from './impl/wait_for_page_ready';

// Mouse actions
import { ClickAction } from './impl/click';
import { ClickByCoordinatesAction } from './impl/click_by_coordinates';
import { DoubleClickByCoordinatesAction } from './impl/double_click_by_coordinates';
import { DragDropAction } from './impl/drag_drop';
import { HoverAction } from './impl/hover';
import { RightClickByCoordinatesAction } from './impl/right_click_by_coordinates';

// Input and keyboard actions
import { ClearInputAction } from './impl/clear_input';
import { InputTextAction } from './impl/input_text';
import { PressAction } from './impl/press';

// Scroll actions
import { ScrollAction } from './impl/scroll';
import { ScrollOnElementAction } from './impl/scroll_on_element';
import { ScrollToTextAction } from './impl/scroll_to_text';

// Tab actions
import { CloseTabAction } from './impl/close_tab';
import { SwitchTabAction } from './impl/switch_tab';

// File actions
import { UploadFileAction } from './impl/upload_file';
import { WaitForDownloadCompleteAction } from './impl/wait_for_download_complete';

// Form actions
import { GetDropdownOptionsAction } from './impl/get_dropdown_options';
import { SelectDropdownOptionAction } from './impl/select_dropdown_option';
import { SetDateForNativeDatePickerAction } from './impl/set_date_for_native_date_picker';

// AI actions
import { AiActionAction } from './impl/ai_action';
import { AiAssertAction } from './impl/ai_assert';
import { AiExtractAction } from './impl/ai_extract';
import { AiStepAction } from './impl/ai_step';
import { AiWaitUntilAction } from './impl/wait_until';

// Auth actions
import { Generate2faCodeAction } from './impl/generate_2fa_code';

// Utility actions
import { DoubleClickAction } from './impl/double_click';
import { FunctionAction } from './impl/function';
import { JsAction } from './impl/js_action';
import { JsCodeAction } from './impl/js_code';
import { RightClickAction } from './impl/right_click';
import { SaveVariableAction } from './impl/save_variable';
import { SendKeysOnElementAction } from './impl/send_keys_on_element';

/**
 * ActionHandler - Centralized action execution and transpilation
 *
 * Usage:
 * ```typescript
 * const handler = new ActionHandler();
 *
 * // Execute an action
 * await handler.execute(page, actionEntity, helpers);
 *
 * // Transpile an action
 * const code = handler.transpile(actionEntity, 'step1');
 * ```
 */
export class ActionHandler {
  private static actions: Map<string, IAction> = new Map();
  private static initialized = false;

  /**
   * Register an action. Can be called before or after ActionHandler instantiation.
   * Used for actions installed on demand rather than at module load — the
   * llm_tools registry registers extract_email_content this way.
   */
  static registerAction(actionName: string, action: IAction): void {
    ActionHandler.actions.set(actionName, action);
  }

  constructor() {
    if (!ActionHandler.initialized) {
      this.registerBuiltinActions();
      ActionHandler.initialized = true;
    }
  }

  private registerBuiltinActions() {
    // Navigation
    ActionHandler.registerAction('go_to_url', new GoToUrlAction());
    ActionHandler.registerAction('go_back', new GoBackAction());
    ActionHandler.registerAction('reload_page', new ReloadPageAction());

    // Tab Management
    ActionHandler.registerAction('close_tab', new CloseTabAction());
    ActionHandler.registerAction('switch_tab', new SwitchTabAction());

    // Mouse interactions
    ActionHandler.registerAction('click', new ClickAction());
    ActionHandler.registerAction('hover', new HoverAction());
    ActionHandler.registerAction('right_click', new RightClickAction());
    ActionHandler.registerAction('double_click', new DoubleClickAction());

    // Coordinate-based clicks
    ActionHandler.registerAction('click_by_coordinates', new ClickByCoordinatesAction());
    ActionHandler.registerAction('right_click_by_coordinates', new RightClickByCoordinatesAction());
    ActionHandler.registerAction('double_click_by_coordinates', new DoubleClickByCoordinatesAction());

    // Drag and Drop
    ActionHandler.registerAction('drag_drop', new DragDropAction());

    // Input
    ActionHandler.registerAction('input_text', new InputTextAction());
    ActionHandler.registerAction('clear_input', new ClearInputAction());

    // Keyboard
    ActionHandler.registerAction('press', new PressAction());
    ActionHandler.registerAction('send_keys_on_element', new SendKeysOnElementAction());

    // Scrolling
    ActionHandler.registerAction('scroll_on_element', new ScrollOnElementAction());
    ActionHandler.registerAction('scroll_to_text', new ScrollToTextAction());
    ActionHandler.registerAction('scroll', new ScrollAction());

    // File Actions
    ActionHandler.registerAction('upload_file', new UploadFileAction());
    ActionHandler.registerAction('wait_for_download_complete', new WaitForDownloadCompleteAction());

    // Form Actions
    ActionHandler.registerAction('get_dropdown_options', new GetDropdownOptionsAction());
    ActionHandler.registerAction('select_dropdown_option', new SelectDropdownOptionAction());
    ActionHandler.registerAction('set_date_for_native_date_picker', new SetDateForNativeDatePickerAction());

    // AI Actions
    ActionHandler.registerAction('verify', new AiAssertAction());
    ActionHandler.registerAction('ai_action', new AiActionAction());
    ActionHandler.registerAction('ai_extract', new AiExtractAction());
    ActionHandler.registerAction('ai_step', new AiStepAction());
    ActionHandler.registerAction('ai_wait_until', new AiWaitUntilAction());

    // Auth Actions
    ActionHandler.registerAction('generate_2fa_code', new Generate2faCodeAction());

    // Utility Actions
    ActionHandler.registerAction('wait', new WaitAction());
    ActionHandler.registerAction('wait_for_page_ready', new WaitForPageReadyAction());
    ActionHandler.registerAction('save_variable', new SaveVariableAction());
    ActionHandler.registerAction('js_code', new JsCodeAction());
    ActionHandler.registerAction('js_action', new JsAction());
    ActionHandler.registerAction('function', new FunctionAction());

    // Done Action
    ActionHandler.registerAction('done', new DoneAction());

    // Legacy action name aliases (for backward compatibility with cached actions)
    ActionHandler.registerAction('click_element', new ClickAction());
    ActionHandler.registerAction('click_element_by_index', new ClickAction());
    ActionHandler.registerAction('hover_element_by_index', new HoverAction());
    ActionHandler.registerAction('right_click_on_element', new RightClickAction());
    ActionHandler.registerAction('double_click_on_element', new DoubleClickAction());
    ActionHandler.registerAction('scroll_down', new ScrollAction());
    ActionHandler.registerAction('scroll_up', new ScrollAction());
    ActionHandler.registerAction('scroll_element', new ScrollAction());
    ActionHandler.registerAction('send_keys', new PressAction());
    ActionHandler.registerAction('open_tab', new GoToUrlAction());  // open_tab with url is similar to go_to_url with new_tab
    ActionHandler.registerAction('fill', new InputTextAction());
    ActionHandler.registerAction('ai_assert', new AiAssertAction());
    ActionHandler.registerAction('assert', new AiAssertAction());
  }

  /**
   * Get an action instance by name
   */
  getAction(actionName: string): IAction | undefined {
    return ActionHandler.actions.get(actionName);
  }

  /**
   * Check if an action is registered
   */
  hasAction(actionName: string): boolean {
    return ActionHandler.actions.has(actionName);
  }

  /**
   * Get all registered action names
   */
  getActionNames(): string[] {
    return Array.from(ActionHandler.actions.keys());
  }

  /**
   * Execute an action on a page
   *
   * @param page - Playwright Page object
   * @param actionEntity - Action configuration
   * @param agentServices - Agent services for actions that need it (fill, input_text, upload_file, etc.)
   *
   * @example
   * ```typescript
   * const handler = new ActionHandler();
   *
   * await handler.execute(page, {
   *   action_description: 'Click submit',
   *   feedback: '',
   *   locator: 'button.submit',
   *   action_data: {
   *     action_name: 'click',
   *     kwargs: {},
   *   },
   * }, agentServices);
   * ```
   */
  async execute(
    page: Page,
    actionEntity: ActionEntity,
    agentServices: any // AgentServices or IAgent - actions use agentServices methods
  ): Promise<void> {
    if (!agentServices) {
      throw new Error('AgentServices not found');
    }

    const actionName = actionEntity.action_data?.action_name;

    if (!actionName) {
      throw new Error('Action name not found in action_data');
    }

    const action = this.getAction(actionName);

    if (!action) {
      throw new Error(`Unknown action: ${actionName}`);
    }

    // Call execute with agentServices (all actions use agentServices for utility methods)
    await action.execute(page, actionEntity, agentServices);
  }

  /**
   * Transpile an action to Playwright code
   *
   * Uses action's transpile2() for minimal code generation.
   *
   * @param actionEntity - Action configuration
   * @param stepId - Step identifier for comments
   * @param stmtUid - Statement UID for tracking new action entities (optional)
   */
  transpile(
    actionEntity: ActionEntity,
    stepId: string,
    stmtUid?: string,
  ): string[] {
    const { sanitizeForComment } = require('./utils');
    const actionDescription = actionEntity.action_description || '';
    const actionName = actionEntity.action_data?.action_name || '';

    const action = this.getAction(actionName);
    if (!action) {
      return [`// ${stepId}: Unknown action: ${actionName}`];
    }

    const executeLines = action.transpile(actionEntity, stepId);

    if (ActionHelper.isAiAction(actionEntity)) {
      // AI actions handle their own logic, no step wrapper needed.
      // Each AI action's transpile() is responsible for including waitUntilStable
      // if its target agent method doesn't already call it internally.
      return [
        `// ${stepId}: ${sanitizeForComment(actionDescription)}`,
        `page = agent.agentServices.validatePage(page);`,
        ...executeLines
      ];
    }

    // Non-AI actions: wrap in agent.step() with appropriate canSelfHeal flag
    const escapedDescription = JSON.stringify(actionDescription);
    const indentedExecuteLines = executeLines.map(line => `  ${line}`);
    const selfHealFlag = ActionHelper.canSelfHeal(actionEntity);
    const stmtUidArg = stmtUid ? JSON.stringify(stmtUid) : 'undefined';
    return [
      `// ${stepId}: ${sanitizeForComment(actionDescription)}`,
      `page = agent.agentServices.validatePage(page);`,
      `await agent.step(page, async () => {`,
      ...indentedExecuteLines,
      `}, ${escapedDescription}, '${stepId}', ${stmtUidArg}, ${selfHealFlag});`
    ];
  }

  /**
   * Transpile a fallback agent call when no action entity is available
   *
   * This is used when an action has a description but no action_entity, falling back
   * to the AI agent to execute the step based on the natural language description.
   *
   * @param description - Natural language description of what to do
   * @param stepId - Step identifier for comments
   * @param usePureVision - Whether to use pure vision mode (default: false)
   * @param isDraft - If true, use agent.run (multi-step), otherwise agent.execute (single-step)
   * @returns Array of code lines (without indentation)
   */
  transpileUncachedAction(
    description: string,
    stepId: string,
    usePureVision: boolean = false,
    isDraft: boolean = false,
    stmtUid?: string
  ): string[] {
    const { sanitizeForComment } = require('./utils');

    if (!description) {
      return [`// ${stepId}: Skipping - no description`];
    }

    const escapedDescription = JSON.stringify(description);

    if (isDraft) {
      // DRAFT uses agent.run for multi-step execution
      // Pass stmtUid so resolved action entities can be stored for grounding
      const uidArg = stmtUid ? `, { stmtUid: ${JSON.stringify(stmtUid)} }` : '';
      return [
        `// ${stepId}: ${sanitizeForComment(description)}`,
        `page = agent.agentServices.validatePage(page);`,
        `await agent.run(page, ${escapedDescription}, '${stepId}'${uidArg});`,
      ];
    }

    // No waitUntilStable needed — the task executor stabilizes before each step internally
    return [
      `// ${stepId}: ${sanitizeForComment(description)}`,
      `page = agent.agentServices.validatePage(page);`,
      `await agent.execute(page, ${escapedDescription}, '${stepId}', ${usePureVision});`,
    ];
  }
}


/**
 * Export only the class definition (no static singleton instance).
 *
 * Previously, this file exported a static singleton `actionHandler = new ActionHandler()`
 * which caused circular dependencies when imported. The ActionHandler constructor
 * instantiates all action classes, which in turn may import from agent modules,
 * creating a circular import chain.
 *
 * Solution: Consumers should use lazy loading to defer instantiation until runtime.
 * See agentHelpers.ts and llm_tools/tools/index.ts for examples.
 */
export default ActionHandler;
