/**
 * Session Types
 *
 * Type definitions for session management operations.
 */

import type { ActionEntity, AgentEvent } from "sdk-core";
import type { VariableStore } from "shiplight-types";

/**
 * Browser launch options passed to BrowserManager.
 * Maps to BrowserLaunchOptions from web-sdk.
 */
export interface BrowserOptions {
  viewport?: { width: number; height: number };
  isMobile?: boolean;
  hasTouch?: boolean;
  userAgent?: string;
  colorScheme?: "light" | "dark" | "no-preference";
  timezoneId?: string;
  geolocation?: { latitude: number; longitude: number; accuracy?: number };
  locale?: string;
  disableSecurity?: boolean;
  recordEvidence?: boolean;
  headless?: boolean;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
  /** Path to storage state file to restore cookies/localStorage into the session */
  storageStatePath?: string;
  /** Path to unpacked Chrome extension directory. Launches a persistent Chromium context with --load-extension. */
  pathToExtension?: string;
  /** Chrome user data directory for persistent profile (caches extension state, cookies, etc. between sessions). If omitted, a fresh temp profile is used. */
  userDataDir?: string;
}

/**
 * Configuration for creating a session that creates its own browser
 */
export interface CreateSessionConfig {
  startingUrl?: string;
  testAccount?: TestAccountInfo | null;
  browserOptions?: BrowserOptions;
  /** Maximum total actions allowed in this session */
  maxActions?: number;
  /** WebAgent configuration */
  webAgentConfig?: WebAgentConfig;
}

/**
 * Configuration for creating a session with an external page
 */
export interface CreateSessionWithPageConfig {
  /** Maximum total actions allowed in this session */
  maxActions?: number;
  /** Directory for saving artifacts (screenshots, trajectories, etc.) */
  runDir?: string;
  /** WebAgent configuration */
  webAgentConfig?: WebAgentConfig;
}

/**
 * WebAgent configuration options
 */
export interface WebAgentConfig {
  model?: string;
  testDataDir?: string;
  downloadDir?: string;
  testDataDownloader?: (filePaths: string[], filesDir: string) => Promise<void>;
  testDataFileNames?: string[];
  organizationId?: string;
  organizationSettings?: Record<string, any>;
  environmentId?: number;
  usageScenario?: 'general' | 'login';
  knowledgeRetriever?: (statement: string, threshold?: number, topK?: number, usageScenario?: 'general' | 'login') => Promise<any[]>;
  variableStore?: VariableStore;
}

export interface TestAccountInfo {
  id: number;
  username: string;
  password: string;
  environmentId?: number;
  loginConfig?: TestAccountLoginConfig | null;
}

/**
 * Simplified login config for test accounts.
 * Note: This is different from shiplight-types' LoginConfig which is more comprehensive.
 */
export interface TestAccountLoginConfig {
  account: {
    type: string;
    username?: string;
    password?: string;
    two_factor_auth_config?: any;
  };
  additional_prompt?: string;
  verification_hint?: string;
}

/**
 * Relay connection info for extension-attached sessions.
 * In the single-session model, all registered tabs appear as Pages
 * within one BrowserContext. Tab details live in the relay server's
 * mapping and in Playwright's Page objects.
 */
export interface RelayConnection {
  cdpUrl: string;
  connectedAt: Date;
}

export interface SessionInfo {
  sessionId: string;
  sessionType: "browser" | "android" | "relay";
  createdAt?: Date;
  lastAccessedAt?: Date;
  currentUrl?: string;
  relayConnection?: RelayConnection;
}

export interface ConsoleLog {
  type: string;
  text: string;
  timestamp: number;
}

export interface NetworkLog {
  url: string;
  method: string;
  status?: number;
  timestamp: number;
  responseBody?: string;
}

export interface LogOptions {
  sinceTimestamp?: number;
  logTypes?: string[];
  statusFilter?: "errors" | "success";
}

export interface TaskOptions {
  maxSteps?: number;
  abortSignal?: AbortSignal;
  /** Callback for streaming events during task execution */
  onEvent?: (event: AgentEvent) => void;
}

export interface TaskResult {
  success: boolean;
  actions?: any[];
  details?: string;
  executionHistory?: any[];
}

export interface PageInfo {
  url: string;
  title: string;
}

/**
 * Extended page information including scroll and viewport data
 */
export interface ExtendedPageInfo {
  url: string;
  title: string;
  viewportWidth: number;
  viewportHeight: number;
  pageWidth: number;
  pageHeight: number;
  scrollY: number;
  pixelsAbove: number;
  pixelsBelow: number;
}

export interface InspectPageResult {
  screenshotPath: string;
  domText: string;
  domFilePath: string;
  currentUrl: string;
}

export interface GetDomResult {
  domText: string;
  domFilePath: string;
  screenshotPath?: string;
  currentUrl: string;
  duration_ms?: number;
  timing?: {
    screenshot_ms: number;
    dom_extraction_ms: number;
    page_info_ms: number;
    file_write_ms: number;
  };
}

/**
 * Actions supported by act tool.
 * These are direct browser actions that don't require AI reasoning.
 *
 * INVARIANT: every name here must be registered in sdk-core's llm_tools tool
 * registry. This list is what the act tool's description advertises, while the
 * act input schema and the action-entity resource are both generated from the
 * registry — which silently skips names it does not know. An unregistered name
 * therefore reads as supported and fails at call time with "Tool not found",
 * and neither the schema nor the resource can reveal the gap because both are
 * derived from the same registry that omits it.
 *
 * `send_keys_on_element` and `wait_for_page_ready` were listed here without
 * being registered. Both are still available to YAML tests via ActionHandler;
 * they are simply not part of the act surface. See the guard in
 * __tests__/actSupportedActionsRegistered.test.ts.
 */
export const ACT_SUPPORTED_ACTIONS = [
  // Basic interactions
  'click',
  'double_click',
  'right_click',
  'hover',
  // Text input
  'input_text',
  'clear_input',
  'press',
  // Dropdowns
  'select_dropdown_option',
  'get_dropdown_options',
  'set_date_for_native_date_picker',
  // Scrolling
  'scroll',
  'scroll_to_text',
  'scroll_on_element',
  // Navigation
  'go_to_url',
  'go_back',
  'reload_page',
  // Tabs
  'switch_tab',
  'close_tab',
  // Wait
  'wait',
  'wait_for_download_complete',
  // Files
  'upload_file',
  // Variables
  'save_variable',
] as const;

export type ActSupportedAction = (typeof ACT_SUPPORTED_ACTIONS)[number];

export interface ActionResultItem {
  success: boolean;
  action_entity?: ActionEntity;
  message?: string;
  error?: string;
  duration_ms?: number;
  timing?: {
    execute_ms: number;
    log_ms: number;
  };
  stepIndex?: number;
}

export interface ActOptions {
  stopOnError?: boolean;
}

export interface ActResult {
  success: boolean;
  results: ActionResultItem[];
  duration_ms?: number;
  /** Path to DOM text file with element indices (post-action state). Absent if page was still loading. */
  dom_file_path?: string;
}

export interface GetLocatorResult {
  element_index: number;
  locator: string | null;
  xpath: string;
  frame_path: string[];
  tag_name: string;
  text: string;
  duration_ms?: number;
}

// ============================================================================
// Exploration Artifacts Types
// ============================================================================

export interface ActionLogEntry {
  stepIndex: number;
  timestamp: number;
  url: string;
  description: string;
  actionName: string;
  screenshotPath?: string;
  success: boolean;
  error?: string;
}

export interface PageCacheMetadata {
  url: string;
  title: string;
  capturedAt: string;
  viewport: { width: number; height: number };
  elementCount: number;
}

export interface TestEvidenceManifest {
  testFile: string;
  createdAt: string;
  sessionId: string;
  steps: Array<{
    stepIndex: number;
    description: string;
    actionName: string;
    url: string;
    timestamp: number;
    screenshotFile?: string;
    success: boolean;
  }>;
}

export interface LocatorEntry {
  elementIndex: number;
  tagName: string;
  text: string;
  xpath: string;
  framePath: string[];
}
