/**
 * Actions V2
 *
 * Comprehensive action system for mobile automation.
 * Aligned with web-sdk patterns.
 */

// Types
export type {
  ActionDataEntity,
  MobileActionEntity,
  ActionResult,
  IAction,
  MobileActionName,
  LocatorType,
  ParsedLocator,
} from './types';

export { parseLocator, toUiAutomator, findElement, requiresLocator, transpileLocator } from './types';

// Handler
export { ActionHandler } from './handler';

// Element actions
export {
  TapAction,
  TapToolSchema,
  DoubleTapAction,
  DoubleTapToolSchema,
  LongPressAction,
  LongPressToolSchema,
  InputTextAction,
  InputTextToolSchema,
  ClearInputAction,
  ClearInputToolSchema,
} from './element';

// Query actions
export {
  GetTextAction,
  GetTextToolSchema,
  GetAttributeAction,
  GetAttributeToolSchema,
  IsDisplayedAction,
  IsDisplayedToolSchema,
  IsEnabledAction,
  IsEnabledToolSchema,
  IsCheckedAction,
  IsCheckedToolSchema,
  ExistsAction,
  ExistsToolSchema,
} from './query';

// Gesture actions
export {
  SwipeAction,
  SwipeToolSchema,
  SwipeCoordinatesAction,
  SwipeCoordinatesToolSchema,
  ScrollToElementAction,
  ScrollToElementToolSchema,
  DragAndDropAction,
  DragAndDropToolSchema,
  PinchAction,
  PinchToolSchema,
  ZoomAction,
  ZoomToolSchema,
} from './gesture';

// System actions
export {
  BackAction,
  BackToolSchema,
  HomeAction,
  HomeToolSchema,
  EnterAction,
  EnterToolSchema,
  PressKeyAction,
  PressKeyToolSchema,
  OpenNotificationsAction,
  OpenNotificationsToolSchema,
  CloseNotificationsAction,
  CloseNotificationsToolSchema,
} from './system';

// App actions
export {
  OpenAppAction,
  OpenAppToolSchema,
  CloseAppAction,
  CloseAppToolSchema,
  InstallAppAction,
  InstallAppToolSchema,
  UninstallAppAction,
  UninstallAppToolSchema,
  IsAppInstalledAction,
  IsAppInstalledToolSchema,
} from './app';

// Device actions
export {
  SetClipboardAction,
  SetClipboardToolSchema,
  GetClipboardAction,
  GetClipboardToolSchema,
  ToggleWifiAction,
  ToggleWifiToolSchema,
  ToggleAirplaneModeAction,
  ToggleAirplaneModeToolSchema,
  SetOrientationAction,
  SetOrientationToolSchema,
  GetOrientationAction,
  GetOrientationToolSchema,
} from './device';

// Screen actions
export {
  ScreenshotAction,
  ScreenshotToolSchema,
  GetPageSourceAction,
  GetPageSourceToolSchema,
  GetScreenSizeAction,
  GetScreenSizeToolSchema,
  TapCoordinatesAction,
  TapCoordinatesToolSchema,
} from './screen';

// Agent actions
export {
  WaitAction,
  WaitToolSchema,
  WaitForElementAction,
  WaitForElementToolSchema,
  WaitForElementGoneAction,
  WaitForElementGoneToolSchema,
  AssertAction,
  AssertToolSchema,
  DoneAction,
  DoneToolSchema,
  StoreValueAction,
  StoreValueToolSchema,
  AiAssertAction,
  AiAssertToolSchema,
} from './agent';
