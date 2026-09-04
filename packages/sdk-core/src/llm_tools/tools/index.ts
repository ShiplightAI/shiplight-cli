/**
 * LLM Tools - Tool Definitions
 *
 * Central export point for all tool registration functions.
 * Tool registration functions are now co-located with their action implementations in src/actions/impl/.
 */

import type { ActionHandler } from '../../actions/handler';
import { ToolRegistry } from '../registry';

/**
 * Lazy-load ActionHandler to avoid circular dependencies.
 *
 * We use dynamic import to defer loading the handler module until runtime.
 * This prevents circular dependency issues that would occur if we used a
 * static import and immediately instantiated ActionHandler at module load time.
 *
 * Pattern: Cache the instance after first creation to reuse across tool registrations.
 */
let cachedActionHandler: ActionHandler | null = null;
async function getActionHandler(): Promise<ActionHandler> {
  if (cachedActionHandler) {
    return cachedActionHandler;
  }
  const ActionHandlerClass = (await import('../../actions/handler')).default;
  cachedActionHandler = new ActionHandlerClass();
  return cachedActionHandler;
}

// Import registration functions from action files
import { registerClickTool } from '../../actions/impl/click';
import { registerDoubleClickTool } from '../../actions/impl/double_click';
import { registerHoverTool } from '../../actions/impl/hover';
import { registerRightClickTool } from '../../actions/impl/right_click';

import { registerGoBackTool } from '../../actions/impl/go_back';
import { registerGoToUrlTool } from '../../actions/impl/go_to_url';
import { registerReloadPageTool } from '../../actions/impl/reload_page';
import { registerWaitTool } from '../../actions/impl/wait';

import { registerClearInputTool } from '../../actions/impl/clear_input';
import { registerInputTextTool } from '../../actions/impl/input_text';
import { registerPressTool } from '../../actions/impl/press';

import { registerScrollTool } from '../../actions/impl/scroll';
import { registerScrollOnElementTool } from '../../actions/impl/scroll_on_element';
import { registerScrollToTextTool } from '../../actions/impl/scroll_to_text';

import { registerCloseTabTool } from '../../actions/impl/close_tab';
import { registerSwitchTabTool } from '../../actions/impl/switch_tab';

import { registerUploadFileTool } from '../../actions/impl/upload_file';
import { registerWaitForDownloadCompleteTool } from '../../actions/impl/wait_for_download_complete';

import { registerGetDropdownOptionsTool } from '../../actions/impl/get_dropdown_options';
import { registerSelectDropdownOptionTool } from '../../actions/impl/select_dropdown_option';
import { registerSetDateForNativeDatePickerTool } from '../../actions/impl/set_date_for_native_date_picker';

import { registerSaveVariableTool } from '../../actions/impl/save_variable';
import { registerDoneTool } from '../../actions/impl/done';

import { registerAiAssertTool } from '../../actions/impl/ai_assert';
import { registerAiExtractTool } from '../../actions/impl/ai_extract';
import { registerAiWaitUntilTool } from '../../actions/impl/wait_until';

import { registerGenerate2faCodeTool } from '../../actions/impl/generate_2fa_code';
import { registerPerformAccurateOperationTool } from '../../actions/impl/perform_accurate_operation';

import {
  ExtractEmailContentAction,
  registerExtractEmailContentTool,
} from '../../tools/extractEmailContent';

// ============================================================================
// Registration Functions (for backward compatibility)
// ============================================================================

/**
 * Register all mouse tools
 * @returns Capability summary for this category
 */
export async function registerMouseTools(registry: ToolRegistry): Promise<string> {
  const handler = await getActionHandler();
  const clickAction = handler.getAction('click')!;
  const hoverAction = handler.getAction('hover')!;
  const rightClickAction = handler.getAction('right_click')!;
  const doubleClickAction = handler.getAction('double_click')!;

  registerClickTool(registry, clickAction);
  registerHoverTool(registry, hoverAction);
  registerRightClickTool(registry, rightClickAction);
  registerDoubleClickTool(registry, doubleClickAction);

  return "Click, hover, double-click, right-click, or drag elements";
}

/**
 * Register all navigation tools
 * @returns Capability summary for this category
 */
export async function registerNavigationTools(registry: ToolRegistry): Promise<string> {
  const handler = await getActionHandler();
  const goToUrlAction = handler.getAction('go_to_url')!;
  const goBackAction = handler.getAction('go_back')!;
  const reloadPageAction = handler.getAction('reload_page')!;

  registerGoToUrlTool(registry, goToUrlAction);
  registerGoBackTool(registry, goBackAction);
  registerReloadPageTool(registry, reloadPageAction);

  return "Navigate to URLs, go back, or reload the page";
}

/**
 * Register all input tools
 * @returns Capability summary for this category
 */
export async function registerInputTools(registry: ToolRegistry): Promise<string> {
  const handler = await getActionHandler();
  const clearInputAction = handler.getAction('clear_input')!;
  const inputTextAction = handler.getAction('input_text')!;
  const pressAction = handler.getAction('press')!;

  registerClearInputTool(registry, clearInputAction);
  registerInputTextTool(registry, inputTextAction);
  registerPressTool(registry, pressAction);

  return "Type text into inputs, clear input values, or press keyboard keys";
}

/**
 * Register all scroll tools
 * @returns Capability summary for this category
 */
export async function registerScrollTools(registry: ToolRegistry): Promise<string> {
  const handler = await getActionHandler();
  const scrollOnElementAction = handler.getAction('scroll_on_element')!;
  const scrollToTextAction = handler.getAction('scroll_to_text')!;
  const scrollAction = handler.getAction('scroll')!;

  registerScrollOnElementTool(registry, scrollOnElementAction);
  registerScrollToTextTool(registry, scrollToTextAction);
  registerScrollTool(registry, scrollAction);

  return "Scroll the page or scroll to specific text/elements";
}

/**
 * Register all tab tools
 * @returns Capability summary for this category
 */
export async function registerTabTools(registry: ToolRegistry): Promise<string> {
  const handler = await getActionHandler();
  const closeTabAction = handler.getAction('close_tab')!;
  const switchTabAction = handler.getAction('switch_tab')!;

  registerCloseTabTool(registry, closeTabAction);
  registerSwitchTabTool(registry, switchTabAction);

  return "Switch between browser tabs or close tabs";
}

/**
 * Register all file tools
 * @returns Capability summary for this category
 */
export async function registerFileTools(registry: ToolRegistry): Promise<string> {
  const handler = await getActionHandler();
  const uploadFileAction = handler.getAction('upload_file')!;
  const waitForDownloadCompleteAction = handler.getAction('wait_for_download_complete')!;

  registerUploadFileTool(registry, uploadFileAction);
  registerWaitForDownloadCompleteTool(registry, waitForDownloadCompleteAction);
  // registerClickDownloadButtonTool is commented out in original

  return "Upload files or wait for downloads to complete";
}

/**
 * Register all form tools
 * @returns Capability summary for this category
 */
export async function registerFormTools(registry: ToolRegistry): Promise<string> {
  const handler = await getActionHandler();
  const getDropdownOptionsAction = handler.getAction('get_dropdown_options')!;
  const selectDropdownAction = handler.getAction('select_dropdown_option')!;
  const setDateForNativeDatePickerAction = handler.getAction('set_date_for_native_date_picker')!;

  registerGetDropdownOptionsTool(registry, getDropdownOptionsAction);
  registerSelectDropdownOptionTool(registry, selectDropdownAction);
  registerSetDateForNativeDatePickerTool(registry, setDateForNativeDatePickerAction);

  return "Get dropdown options, select dropdown values, or set date for native date picker input";
}

/**
 * Register all utility tools
 * @returns Capability summary for this category
 */
export async function registerUtilityTools(registry: ToolRegistry): Promise<string> {
  const handler = await getActionHandler();
  const waitAction = handler.getAction('wait')!;
  const saveVariableAction = handler.getAction('save_variable')!;
  const doneAction = handler.getAction('done')!;

  registerWaitTool(registry, waitAction);
  registerSaveVariableTool(registry, saveVariableAction);
  registerDoneTool(registry, doneAction);
  registerPerformAccurateOperationTool(registry);

  return "Wait for conditions, save variables, or complete tasks";
}

/**
 * Register all auth tools
 * @returns Capability summary for this category
 */
export async function registerAuthTools(registry: ToolRegistry): Promise<string> {
  const handler = await getActionHandler();
  const generate2faCodeAction = handler.getAction('generate_2fa_code')!;

  registerGenerate2faCodeTool(registry, generate2faCodeAction);

  // Register email extraction tool
  const emailAction = new ExtractEmailContentAction();
  const ActionHandlerClass = (await import('../../actions/handler')).default;
  ActionHandlerClass.registerAction('extract_email_content', emailAction);
  registerExtractEmailContentTool(registry, emailAction);

  return "Generate 2FA codes or extract email/activation codes";
}

/**
 * Register all AI tools (MCP-only)
 * @returns Capability summary for this category
 */
export async function registerAITools(registry: ToolRegistry): Promise<string> {
  const handler = await getActionHandler();
  const verifyAction = handler.getAction('verify')!;
  const aiExtractAction = handler.getAction('ai_extract')!;

  registerAiAssertTool(registry, verifyAction);
  registerAiExtractTool(registry, aiExtractAction);
  registerAiWaitUntilTool(registry);

  return "Perform AI-powered assertions, extractions, or wait conditions";
}

// ============================================================================
// Aggregated Registration and Capability Summary
// ============================================================================

export interface ToolCapabilities {
  mouse: string;
  navigation: string;
  input: string;
  scroll: string;
  tabs: string;
  files: string;
  forms: string;
  utility: string;
  auth: string;
  ai: string;
}

/**
 * Register all browser automation tools and return their capabilities.
 * This is the main entry point for registering tools with capability tracking.
 *
 * @param registry The tool registry to register tools with
 * @returns Object containing capability summaries for each category
 */
export async function registerAllToolsWithCapabilities(registry: ToolRegistry): Promise<ToolCapabilities> {
  const [mouse, navigation, input, scroll, tabs, files, forms, utility, auth, ai] = await Promise.all([
    registerMouseTools(registry),
    registerNavigationTools(registry),
    registerInputTools(registry),
    registerScrollTools(registry),
    registerTabTools(registry),
    registerFileTools(registry),
    registerFormTools(registry),
    registerUtilityTools(registry),
    registerAuthTools(registry),
    registerAITools(registry),
  ]);

  return { mouse, navigation, input, scroll, tabs, files, forms, utility, auth, ai };
}

/**
 * Get a formatted capability summary string for use in LLM prompts.
 * This provides a concise description of what actions the browser automation can perform.
 *
 * @param capabilities The capabilities object from registerAllToolsWithCapabilities
 * @returns A formatted string describing all available capabilities
 */
export function formatCapabilitySummary(capabilities: ToolCapabilities): string {
  return [
    `- Mouse: ${capabilities.mouse}`,
    `- Navigation: ${capabilities.navigation}`,
    `- Input: ${capabilities.input}`,
    `- Scroll: ${capabilities.scroll}`,
    `- Tabs: ${capabilities.tabs}`,
    `- Files: ${capabilities.files}`,
    `- Forms: ${capabilities.forms}`,
    `- Utility: ${capabilities.utility}`,
    `- Auth: ${capabilities.auth}`,
    `- AI: ${capabilities.ai}`,
  ].join('\n');
}
