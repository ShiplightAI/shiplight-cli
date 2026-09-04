/**
 * Core shared types used by both agent/ and copilot/ modules
 */

import type { Page } from 'playwright';
import { ActionGenerationDebugInfo, VariableStore, MessageForLogging, ActionEntity } from 'shiplight-types';

/**
 * DOM snapshot captured at a point in time
 */
export interface DOMSnapshot {
  elementTreeText: string;      // From clickableElementsToString()
  elementCount: number;
  timestamp: number;
}

/**
 * Page state at a specific point in time
 */
export interface PageState {
  url: string;
  domSnapshot?: DOMSnapshot;
  variables: Record<string, any>;
  screenshotPath?: string;
}

/**
 * Action information for a step
 */
export interface ActionInfo {
  actionEntity?: ActionEntity;
  playwrightCode?: string[];
  llmPrompt?: string;
  llmResponse?: string;
  llmReasoning?: string;
}

/**
 * Console log entry with step association
 */
export interface ConsoleLogEntry {
  type: string;
  message: string;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
  stack?: string;
  timestamp: number;
  stepId?: string;
}

/**
 * State entry - captures page state at a point in time
 * Used in interlaced format: state → action → state → action → state
 */
export interface StateEntry {
  type: 'state';
  url: string;
  domSnapshot?: DOMSnapshot;
  variables?: Record<string, unknown>;
  screenshotPath?: string;
  timestamp: number;
}

/**
 * Action entry - captures what action was taken and its outcome
 */
export interface ActionEntry {
  type: 'action';
  stepId: string;
  description: string;
  action: ActionInfo;
  status: 'success' | 'failure' | 'skipped';
  errorMessage?: string;
  consoleLogs: ConsoleLogEntry[];
  durationMs: number;
}

/**
 * Redirect entry - detected when URL changes (HTTP redirect or client-side navigation)
 */
export interface RedirectEntry {
  type: 'redirect';
  fromUrl: string;
  toUrl: string;
  timestamp: number;
  triggeredBy?: string;  // stepId that was executing when redirect occurred
  status?: number;  // HTTP status code of fromUrl (undefined if client-side navigation)
}

/**
 * Union type for all state transition entries (interlaced format)
 */
export type StateTransition = StateEntry | ActionEntry | RedirectEntry;

// Legacy type alias for backwards compatibility
export type StepTransition = ActionEntry;
export type RedirectTransition = RedirectEntry;

/**
 * Full state transitions output file structure
 */
export interface StateTransitionsOutput {
  testId: string;
  testCaseResultId?: number;
  transitions: StateTransition[];
}

/**
 * Token usage information from LLM calls
 */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd?: number;
  model?: string;
}

/**
 * Represents an AI action (actual LLM API call) tracked during test execution.
 * Used to monitor LLM usage, costs, and identify steps making multiple AI calls.
 */
export interface AIActionDetail {
  stepId: string;
  actionType: 'execute' | 'generate' | 'assert' | 'evaluate' | 'run';
  /**
   * For `evaluate` actions, which construct invoked it — an IF condition, a
   * WHILE-loop condition, or a WAIT_UNTIL poll. All three compile down to the
   * same `agent.evaluate` call, so the call site passes this through to keep them
   * distinct in the run usage summary. WAIT_UNTIL matters most: it polls until a
   * condition is met, so it makes many more LLM calls than a one-shot IF.
   * Undefined for non-evaluate actions. (Internal evaluate uses such as login
   * checks pass no stepId, so they produce no AIActionDetail at all — they never
   * reach the `undefined -> evaluate_if` default.)
   */
  conditionKind?: 'if' | 'while' | 'wait_until';
  count: number;  // Number of API calls
  tokenUsages: TokenUsage[];  // All token usage records from API calls

  // Additional context for debugging and analysis
  /** The instruction/statement being executed */
  statement?: string;
  /** The user prompt sent to the LLM (can be string or structured multimodal messages) */
  userPrompt?: string | MessageForLogging[];
  /** The raw response from the LLM */
  rawLlmResponse?: string;
  /** Reasoning/thinking content from the LLM (if native thinking enabled) */
  reasoningContent?: string;
  /** The explanation/result of the action */
  explanation?: string;
  /** Element tree string for hard case capture */
  elementTree?: string;
  /** Screenshot with SOM as base64 for hard case capture */
  screenshotWithSom?: string;
}

/** Which agent method created this step result */
export type StepType = 'step' | 'assert' | 'evaluate' | 'execute' | 'generate' | 'run' | 'extract';

export interface StepExecutionResult {
  description: string;
  startTime: number;
  duration?: number;
  /** 'warning' = soft outcome that does not fail the test (e.g. a WAIT_UNTIL timeout). */
  status?: 'success' | 'failure' | 'skipped' | 'warning';
  autoHealed?: boolean;
  /**
   * Self-healing was attempted for this step and did NOT recover it.
   *
   * The counterpart to `autoHealed`, which is set only on the success path. Without
   * this the two outcomes of "the locator failed and AI was invoked" are not
   * distinguishable after the fact: a failed heal leaves no `healedAction`, writes no
   * entity to `new-action-entities.json`, and is therefore invisible to every
   * downstream cache metric — the statement stays counted as if its entity had
   * worked. Set ONLY when the agent actually called the model; a step with
   * `canSelfHeal: false`, or one already running inside a self-heal, never sets it.
   */
  healFailed?: boolean;
  /**
   * The YAML statement UID this step executed (`action.uid`), when there is one.
   *
   * Recorded so execution-scoped metrics can be joined back to what the transpiler
   * knew about the statement — above all whether its action entity came from the
   * action-entity cache. That provenance is knowable only at transpile time, and
   * whether the statement RAN is knowable only here; the UID is the key between
   * them. Absent for steps with no YAML statement behind them (hand-written
   * `agent.step()` calls, DRAFT statements, which go through `agent.execute`).
   */
  stmtUid?: string;
  healedAction?: ActionEntity;
  dismissedModalActions?: ActionEntity[];
  message?: any;
  artifacts: Array<Record<string, string>>;
  screenshot?: string;
  /** Which agent method created this step */
  type?: StepType;
  /** Executed code: fn.toString() body for 'step', statement string for all others */
  code?: string;
  /** Snapshot of test variables (sensitive values masked) just before this step ran. */
  contextBefore?: Record<string, unknown>;
  /** Snapshot of test variables (sensitive values masked) right after this step finished. */
  contextAfter?: Record<string, unknown>;
}

export interface StepTrackingConfig {
  results: Record<string, StepExecutionResult>;
  artifactsDir?: string;  // Directory for per-step artifacts (screenshots, LLM logs)
  onStepComplete?: (stepId: string, result: StepExecutionResult) => void;
  onStepChange?: (stepId: string | undefined) => void;  // Called when current step changes (for console log association)

  // State transitions tracking
  captureStateTransitions?: boolean;
  captureDom?: boolean;  // Default: true
  captureVariables?: boolean;  // Default: true
  stateTransitions?: StateTransition[];  // Collected state transitions
  currentStepId?: string;  // Current step being executed
  lastKnownUrl?: string;  // For redirect detection
  consoleLogs?: ConsoleLogEntry[];  // Console logs (referenced for step association)
}

export interface DownloadStatus {
  filename: string;
  status: 'inProgress' | 'completed' | 'failed';
  startTime: number;
  filePath?: string;
  error?: string;
  timestamp?: number;
}

export interface DialogStatus {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
  response: 'accept' | 'dismiss';
  timestamp: number;
}

/**
 * Public interface for test context - only exposes variables to users
 */
export interface TestContextData {
  // Test variables - the only data users should access directly
  variables: Record<string, any>;
}

/**
 * Internal web agent context - contains all configuration and state
 * @internal - Not exposed to end users
 */
export interface WebAgentContext {
  // LLM model to use for AI operations (optional - only needed for AI-powered actions)
  model?: string;

  // Ordered fallback models (provider:model) tried if the primary model fails
  // with an availability error (rate limit / 5xx / timeout). Empty = no fallback.
  fallbackModels?: string[];

  // LLM model to use for computer use operations (optional - defaults to model if not set)
  computer_use_model?: string;

  // Ordered fallback computer-use models tried if the primary computer-use model
  // fails with an availability error. Empty = no fallback. These must be
  // computer-use-capable models (the coordinatesBased dispatcher re-detects the
  // provider per model), NOT the web-agent fallbackModels.
  computer_use_fallback_models?: string[];

  // Shared variable storage
  variableStore: VariableStore;

  // Organization/execution context
  organizationId?: string;
  organizationSettings?: Record<string, any>;
  executionHistory?: Array<[string, string]>;

  // Optional step tracking - if present, step tracking is enabled
  stepTracking?: StepTrackingConfig;

  // Test data directory for file operations
  testDataDir?: string;

  // Download directory for file downloads
  downloadDir?: string;

  // Download tracking
  downloadStatus?: DownloadStatus | null;

  // Dialog tracking
  dialogStatus?: DialogStatus | null;

  // Whether the agent is currently in self-healing mode (runtime state)
  isSelfHealing?: boolean;

  // Agent note for current step execution (e.g., extracted values, action details)
  agentNote?: string;

  // Token usage tracking - collected from LLM calls
  tokenUsages?: TokenUsage[];

  // AI action details - tracks each LLM API call
  aiActionDetails?: AIActionDetail[];

  // Last action generation debug info - captured from the most recent AI action
  lastActionDebugInfo?: ActionGenerationDebugInfo;

  // Action generator configuration
  useNativeGenerator?: boolean;

  // Page management callback - called when actions like switch_tab change the active page
  setPage?: (page: Page) => void;

  // Auto-dismiss modal dialogs (cookie consent, popups, etc.)
  autoDismissModal?: boolean;
}
