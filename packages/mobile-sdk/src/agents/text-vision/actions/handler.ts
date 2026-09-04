/**
 * Action Handler - Registry and execution for mobile actions
 */

import type { Browser } from 'webdriverio';
import type { IAction, MobileActionEntity, ActionResult, MobileActionName } from './types';
import type { MobileAgentServices } from '../mobileAgentServices';

// Import action implementations
import { TapAction, DoubleTapAction, LongPressAction, InputTextAction, ClearInputAction } from './element';
import { GetTextAction, GetAttributeAction, IsDisplayedAction, IsEnabledAction, IsCheckedAction, ExistsAction } from './query';
import { SwipeAction, SwipeCoordinatesAction, ScrollToElementAction, DragAndDropAction, PinchAction, ZoomAction, ScrollAction } from './gesture';
import { BackAction, HomeAction, EnterAction, PressKeyAction, OpenNotificationsAction, CloseNotificationsAction } from './system';
import { OpenAppAction, CloseAppAction, InstallAppAction, UninstallAppAction, IsAppInstalledAction } from './app';
import { SetClipboardAction, GetClipboardAction, ToggleWifiAction, ToggleAirplaneModeAction, SetOrientationAction, GetOrientationAction } from './device';
import { ScreenshotAction, GetPageSourceAction, GetScreenSizeAction, TapCoordinatesAction } from './screen';
import { WaitAction, WaitForElementAction, WaitForElementGoneAction, AssertAction, DoneAction, StoreValueAction, AiAssertAction } from './agent';

/**
 * ActionHandler - Centralized action registry and execution
 */
export class ActionHandler {
  private actions: Map<string, IAction> = new Map();

  constructor() {
    this.registerAllActions();
  }

  private registerAllActions() {
    // Element actions
    this.register('tap', new TapAction());
    this.register('double_tap', new DoubleTapAction());
    this.register('long_press', new LongPressAction());
    this.register('input_text', new InputTextAction());
    this.register('clear_input', new ClearInputAction());

    // Query actions
    this.register('get_text', new GetTextAction());
    this.register('get_attribute', new GetAttributeAction());
    this.register('is_displayed', new IsDisplayedAction());
    this.register('is_enabled', new IsEnabledAction());
    this.register('is_checked', new IsCheckedAction());
    this.register('exists', new ExistsAction());

    // Gesture actions
    this.register('swipe', new SwipeAction());
    this.register('swipe_coordinates', new SwipeCoordinatesAction());
    this.register('scroll', new ScrollAction());
    this.register('tap_coordinates', new TapCoordinatesAction());
    this.register('scroll_to_element', new ScrollToElementAction());
    this.register('drag_and_drop', new DragAndDropAction());
    this.register('pinch', new PinchAction());
    this.register('zoom', new ZoomAction());

    // System actions
    this.register('back', new BackAction());
    this.register('home', new HomeAction());
    this.register('enter', new EnterAction());
    this.register('press_key', new PressKeyAction());
    this.register('open_notifications', new OpenNotificationsAction());
    this.register('close_notifications', new CloseNotificationsAction());

    // App actions
    this.register('open_app', new OpenAppAction());
    this.register('close_app', new CloseAppAction());
    this.register('install_app', new InstallAppAction());
    this.register('uninstall_app', new UninstallAppAction());
    this.register('is_app_installed', new IsAppInstalledAction());

    // Device actions
    this.register('set_clipboard', new SetClipboardAction());
    this.register('get_clipboard', new GetClipboardAction());
    this.register('toggle_wifi', new ToggleWifiAction());
    this.register('toggle_airplane_mode', new ToggleAirplaneModeAction());
    this.register('set_orientation', new SetOrientationAction());
    this.register('get_orientation', new GetOrientationAction());

    // Screen actions
    this.register('screenshot', new ScreenshotAction());
    this.register('get_page_source', new GetPageSourceAction());
    this.register('get_screen_size', new GetScreenSizeAction());
    this.register('tap_coordinates', new TapCoordinatesAction());

    // Agent actions
    this.register('wait', new WaitAction());
    this.register('wait_for_element', new WaitForElementAction());
    this.register('wait_for_element_gone', new WaitForElementGoneAction());
    this.register('assert', new AssertAction());
    this.register('done', new DoneAction());
    this.register('store_value', new StoreValueAction());
    this.register('ai_assert', new AiAssertAction());
    // 'verify' is an alias for 'ai_assert' - used by frontend editor
    this.register('verify', new AiAssertAction());
  }

  private register(actionName: string, action: IAction) {
    this.actions.set(actionName, action);
  }

  /**
   * Get an action instance by name
   */
  getAction(actionName: string): IAction | undefined {
    return this.actions.get(actionName);
  }

  /**
   * Check if an action is registered
   */
  hasAction(actionName: string): boolean {
    return this.actions.has(actionName);
  }

  /**
   * Get all registered action names
   */
  getActionNames(): MobileActionName[] {
    return Array.from(this.actions.keys()) as MobileActionName[];
  }

  /**
   * Execute an action
   *
   * @param driver - WebDriverIO Browser instance (like page in web-sdk)
   * @param actionEntity - Action configuration
   * @param agentServices - Agent services for utility methods (variables, evaluate, etc.)
   */
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const actionName = actionEntity.action_data?.action_name;

    if (!actionName) {
      return {
        success: false,
        error: 'Action name not found in action_data',
      };
    }

    const action = this.getAction(actionName);

    if (!action) {
      return {
        success: false,
        error: `Unknown action: ${actionName}`,
      };
    }

    const startTime = Date.now();

    try {
      const result = await action.execute(driver, actionEntity, agentServices);
      return {
        ...result,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Action execution failed',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Transpile an action to WebDriverIO/Appium code
   *
   * @param actionEntity - Action configuration
   * @param stepId - Optional step identifier
   * @returns Array of code lines
   */
  transpile(actionEntity: MobileActionEntity, stepId?: string): string[] {
    const actionName = actionEntity.action_data?.action_name;

    if (!actionName) {
      return [`// Error: Action name not found`];
    }

    const action = this.getAction(actionName);

    if (!action) {
      return [`// Unknown action: ${actionName}`];
    }

    return action.transpile(actionEntity, stepId);
  }
}

export default ActionHandler;
