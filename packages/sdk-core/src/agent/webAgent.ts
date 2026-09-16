/**
 * WebAgent - Core AI-powered browser automation
 * Depends on playwright (not @playwright/test) so it can be used outside of test context
 */

import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright';
import type ActionHandler from '../actions/handler';
import { ActionEntity, IAgent } from '../actions/types';
import { DomService } from '../dom';
import { agentLogger } from '../utils/agentLogger';
import logger from '../utils/logger';
import * as agentFile from './agentFile';
import { evaluateStatement, executeStep, generateActionStep, runTask } from './agentHelpers';
import type { LoginCache, LoginConfig, LoginResult, OAuth2Account } from 'shiplight-types';
import { LoginType, TwoFactorAuthType, replaceVariables } from 'shiplight-types';
import { generateAndValidateLoginLocators, validateLogin } from './agentLogin';
import { AgentServices, isBlankTab } from './agentServices';
import * as agentWait from './agentWait';
import { runAiAnalysis } from './aiAnalysis';
import { ActionGenerationDebugInfo } from 'shiplight-types';
import { AgentStepResult, AgentTaskFailedError, StepExecutionResult, WebAgentContext } from './types';
import type { DialogStatus, StepType } from '../core/types';
import { LLMProviderNotConfiguredError } from './llm/errors';

/** Maximum steps for self-healing recovery attempts (default single-step) */
const MAX_SELF_HEALING_STEPS = 1;

/**
 * Options for the high-level {@link WebAgent.login} helper — a friendly façade
 * over {@link WebAgent.loginPage} for the common username/password (+ optional
 * TOTP) case.
 */
export interface LoginOptions {
  /** URL of the login page */
  url: string;
  /** Username or email for login */
  username: string;
  /** Password for login */
  password: string;
  /**
   * TOTP secret key for 2FA (if required).
   * The agent generates the OTP code automatically.
   */
  totpSecret?: string;
}

/**
 * Extract the body of an arrow or regular function as a trimmed, dedented string.
 * Used to capture the executed code for agent.step() report display.
 */
function extractFunctionBody(fn: () => unknown): string | undefined {
  try {
    const src = fn.toString();
    let body: string | undefined;
    const arrowIdx = src.indexOf('=>');
    if (arrowIdx !== -1) {
      const afterArrow = src.slice(arrowIdx + 2).trim();
      if (afterArrow.startsWith('{')) {
        const lastBrace = afterArrow.lastIndexOf('}');
        body = afterArrow.slice(1, lastBrace);
      } else {
        return afterArrow.trim();
      }
    } else {
      const firstBrace = src.indexOf('{');
      const lastBrace = src.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        body = src.slice(firstBrace + 1, lastBrace);
      }
    }
    if (!body) return undefined;
    // Dedent: strip common leading whitespace from all non-empty lines
    const lines = body.split('\n');
    const nonEmpty = lines.filter(l => l.trim().length > 0);
    if (nonEmpty.length === 0) return undefined;
    const minIndent = Math.min(...nonEmpty.map(l => l.match(/^(\s*)/)?.[1].length ?? 0));
    return lines.map(l => l.slice(minIndent)).join('\n').trim();
  } catch {
    return undefined;
  }
}

/** Maximum steps for dismissing intrusive popups (cookie consent, etc.) */
const MAX_MODAL_DISMISSAL_STEPS = 3;

/** Default maximum steps for multi-step execution */
const DEFAULT_MULTI_STEP_MAX = 40;

/**
 * Is this error the AI provider refusing to start, rather than a genuine
 * failure to heal the step?
 *
 * Our own providers throw a typed `LLMProviderNotConfiguredError`, and the AI
 * SDK's `AI_LoadAPIKeyError` is unambiguous. `AI_InvalidArgumentError` is only
 * counted when it names
 * `baseURL` — that is the LLM client's own base URL, and its wording collides
 * almost exactly with Playwright's complaint about a test with no
 * `test.use({ baseURL })`, which is what made issue #2209 so hard to read.
 */
function isProviderConfigError(err: unknown): boolean {
  // Our own resolvers throw this, so their differently-worded messages
  // (`ANTHROPIC_API_KEY not configured…`, `Google API key is missing…`) are all
  // covered without sniffing text.
  if (err instanceof LLMProviderNotConfiguredError) return true;
  if (!(err instanceof Error)) return false;
  // The remaining patterns are for errors thrown by the AI SDK itself, which we
  // do not control and cannot type. They are load-bearing: the `/baseURL/i`
  // match is tied to the AI SDK's exact wording, and narrowing or removing it
  // puts the LLM client's own baseURL back to masquerading as a test failure.
  // Re-check against the installed AI SDK before changing either line.
  if (err.name === 'AI_LoadAPIKeyError') return true;
  return err.name === 'AI_InvalidArgumentError' && /baseURL/i.test(err.message);
}

/**
 * `Self-healing failed: ` is already prepended where execute() reports an
 * unsuccessful result, so wrapping it produced a doubled prefix.
 */
function stripSelfHealPrefix(message: string): string {
  return message.replace(/^Self-healing (?:also )?failed:\s*/i, '');
}

/**
 * Combine the error that failed a step with the error that failed the self-heal
 * attempt, so neither is lost.
 *
 * The original error leads — it is the one describing what the test actually
 * tried to do. The heal error follows as context, and when it turns out the AI
 * provider was never configured, the message says so explicitly instead of
 * leaving a provider setting to masquerade as a test failure.
 *
 * Exported for direct unit testing.
 */
export function buildSelfHealFailureError(originalError: unknown, healError: unknown): Error {
  const originalMessage = originalError instanceof Error ? originalError.message : String(originalError);
  const healMessage = healError instanceof Error ? healError.message : String(healError);

  const suffix = isProviderConfigError(healError)
    ? `AI self-heal unavailable: the LLM provider is not configured (${healMessage}). ` +
      'That is an AI provider setting and is unrelated to the failure above. ' +
      'Set a provider key (GOOGLE_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY or OPENROUTER_API_KEY) or SHIPLIGHT_API_TOKEN to enable self-healing.'
    : `Self-healing also failed: ${stripSelfHealPrefix(healMessage)}`;

  const combined = new Error(`${originalMessage}\n\n${suffix}`, { cause: originalError });

  // Keep the original stack FRAMES — they point at the statement that actually
  // failed — but under the combined message. Overwriting the whole stack drops
  // the self-heal explanation for anything that prints `err.stack`, which is
  // what Node's uncaught-exception handler does for SDK users outside Playwright.
  if (originalError instanceof Error && originalError.stack) {
    const frames = originalError.stack
      .split('\n')
      .filter(line => /^\s+at\s/.test(line));
    combined.stack = [`${combined.name}: ${combined.message}`, ...frames].join('\n');
  }
  return combined;
}

/**
 * Mask sensitive variable values for logging
 * @param variables - All variables
 * @param sensitiveKeys - Set of keys that are sensitive
 * @returns New object with sensitive values replaced by '*****'
 *
 * Exported so the redaction guarantee (sensitive values never appear in step
 * logging) can be pinned by a unit test — see exp-variable-substitution.
 */
export function maskSensitiveVariables(
  variables: Record<string, unknown>,
  sensitiveKeys: Set<string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(variables)) {
    result[key] = sensitiveKeys.has(key) ? '*****' : value;
  }
  return result;
}

export class WebAgent implements IAgent {
  public readonly agentServices: AgentServices;
  private _actionHandler?: ActionHandler;

  // Tracks newly generated action entities (from self-healing or AI fallback)
  // Key: stmtUid, Value: the generated ActionEntity
  private _newActionEntities: Map<string, ActionEntity> = new Map();

  constructor(private context: WebAgentContext) {
    this.agentServices = new AgentServices(context);
    this.agentServices.agent = this;
    // Initialize token usages array if not present
    if (!this.context.tokenUsages) {
      this.context.tokenUsages = [];
    }
  }

  /**
   * Get all newly generated action entities from this test run.
   * Called by test runner after test success to persist cache updates.
   * @returns Map of stmtUid -> ActionEntity
   */
  getNewActionEntities(): Map<string, ActionEntity> {
    return this._newActionEntities;
  }

  /**
   * Get the current agent note (e.g. AI verify explanation, modal dismissal details).
   */
  getAgentNote(): string | undefined {
    return this.context.agentNote || undefined;
  }

  /**
   * Lazy-loaded ActionHandler instance to avoid circular dependencies.
   * Uses ESM dynamic import for lazy loading.
   */
  private async getActionHandler(): Promise<ActionHandler> {
    if (!this._actionHandler) {
      // Dynamic import to avoid circular dependencies at module load time
      const { default: ActionHandlerClass } = await import('../actions/handler.js');
      this._actionHandler = new ActionHandlerClass();
    }
    return this._actionHandler!;
  }

  /**
   * Execute a structured action by name.
   *
   * This is a low-level method that executes a specific action with given parameters.
   * For natural language instructions, use the public SDK's `act()` method instead.
   *
   * @param actionName - The action name (e.g., "click", "input_text", "hover")
   * @param page - Playwright Page object
   * @param entity - Action entity with locator and other fields
   *
   * @example
   * ```typescript
   * await agent.execAction("click", page, { locator: "getByRole('button', { name: 'Submit' })" });
   * await agent.execAction("input_text", page, {
   *   locator: "getByRole('textbox')",
   *   action_data: { kwargs: { text: "Hello" } }
   * });
   * ```
   */
  async execAction(actionName: string, page: Page, entity: Partial<ActionEntity>): Promise<void> {
    const actionHandler = await this.getActionHandler();
    const action = actionHandler.getAction(actionName);
    if (!action) {
      throw new Error(`Unknown action: ${actionName}`);
    }
    await action.execute(page, entity as ActionEntity, this.agentServices);
  }

  /**
   * Attempt to dismiss any intrusive popup modal using AI.
   * Returns whether a modal was actually dismissed.
   *
   * @param page - Playwright Page object
   * @param currentTaskDescription - Optional description of the current task (to avoid dismissing related dialogs)
   * @returns Object with success status, whether a modal was dismissed, and details
   *
   * @example
   * ```typescript
   * const result = await agent.dismissModalIfPresent(page, "Click the submit button");
   * if (result.modalDismissed) {
   *   console.log("Modal was dismissed:", result.details);
   * }
   * ```
   */
  async dismissModalIfPresent(
    page: Page,
    currentTaskDescription?: string
  ): Promise<{ success: boolean; modalDismissed: boolean; details: string; actions?: ActionEntity[] }> {
    try {
      const result = await this.execute(
        page,
        `TASK: Check if there is an INTRUSIVE POPUP blocking the page, and dismiss it if present.

ONLY dismiss intrusive popups such as:
- Cookie/GDPR consent banners
- Newsletter or email signup popups
- Promotional discount or upsell popups
- "Rate our app" or feedback request popups
- Push notification permission requests
- Age verification popups
- Or similar unwanted popups that interrupt the user experience

DO NOT dismiss or interact with:
- Normal UI elements, buttons, or controls on the page
- Dialogs that are part of the user's workflow (confirmations, form submissions, etc.)
- Dropdown menus, filters, or date pickers
${currentTaskDescription ? `- Anything related to: "${currentTaskDescription}"` : ''}

If you find an intrusive popup, dismiss it by clicking its close/X button or "No thanks"/"Decline" button.

IMPORTANT: Only act with HIGH CONFIDENCE. If unsure whether something is an intrusive popup, do nothing.
It's better to miss a popup than to accidentally interact with normal page elements.

If NO intrusive popup is present, do nothing and report that no intrusive popup was found.`,
        undefined,  // no stepId - not tracked
        false,      // usePureVision
        MAX_MODAL_DISMISSAL_STEPS
      );

      const modalDismissed = !!(result.actions && result.actions.length > 0);
      return {
        success: result.success,
        modalDismissed,
        details: result.details || (modalDismissed ? 'Modal dismissed' : 'No modal found'),
        actions: result.actions,
      };
    } catch (error: any) {
      return {
        success: false,
        modalDismissed: false,
        details: error.message || 'Modal dismissal failed',
      };
    }
  }

  /**
   * Internal method for test fixtures to access context
   * @internal - Not part of the public API
   */
  _getContext(): WebAgentContext {
    return this.context;
  }

  /**
   * Set up download tracking for a page
   * Listens to download events and updates context.downloadStatus
   * Call this method for each page where you want to track downloads
   * @param page - The Playwright page to track downloads on
   */
  public setupDownloadTracking(page: Page): void {
    logger.info(`[Download Tracking] Setting up download tracking for page: ${page.url()}`);

    if (isBlankTab(page)) {
      logger.info(`[Download Tracking] Skipping download tracking for blank tab: ${page.url()}`);
      void page.close();
      return;
    }

    page.on('download', async (download) => {
      const filename = download.suggestedFilename();
      logger.info(`[Download Tracking] Download event detected! File: ${filename}`);

      // Track download start
      this.context.downloadStatus = {
        filename,
        status: 'inProgress',
        startTime: Date.now(),
      };
      logger.info(
        `[Download Tracking] Download status set to inProgress: ${JSON.stringify(this.context.downloadStatus)}`,
      );

      try {
        // Determine download directory
        const downloadDir = this.context.downloadDir || path.join(process.cwd(), 'downloads');

        // Ensure download directory exists
        if (!fs.existsSync(downloadDir)) {
          fs.mkdirSync(downloadDir, { recursive: true });
        }

        // Save the download
        const downloadPath = path.join(downloadDir, filename);
        logger.info(`[Download Tracking] Downloading file to: ${downloadPath}`);
        await download.saveAs(downloadPath);

        // Track successful completion
        this.context.downloadStatus = {
          filename,
          status: 'completed',
          startTime: this.context.downloadStatus.startTime,
          filePath: downloadPath,
          timestamp: Date.now(),
        };

        logger.info(`[Download Tracking] Download completed: ${downloadPath}`);
        logger.info(
          `[Download Tracking] Download status set to completed: ${JSON.stringify(this.context.downloadStatus)}`,
        );
      } catch (error: any) {
        // Track failure
        this.context.downloadStatus = {
          filename,
          status: 'failed',
          startTime: this.context.downloadStatus.startTime,
          error: error.message,
          timestamp: Date.now(),
        };

        logger.error(`[Download Tracking] Download failed for ${filename}: ${error.message}`);
      }
    });
  }

  /**
   * Set up automatic dialog handling for a page.
   * Listens to dialog events and automatically accepts them, recording each in context.dialogStatus.
   * Call this method for each page where you want dialogs handled automatically.
   * @param page - The Playwright page to handle dialogs on
   */
  public setupDialogHandling(page: Page): void {
    logger.debug(`[Dialog Handling] setupDialogHandling called, isClosed=${page.isClosed()}, url=${page.url()}`);
    if (page.isClosed()) {
      logger.debug(`[Dialog Handling] Skipping - page is closed`);
      return;
    }
    logger.info(`[Dialog Handling] Setting up dialog handling for page: ${page.url()}`);

    page.on('dialog', async (dialog) => {
      const type = dialog.type() as DialogStatus['type'];
      const message = dialog.message();
      logger.info(`[Dialog Handling] Dialog detected - type: ${type}, message: "${message}"`);

      // For beforeunload dialogs, dismiss() allows navigation to proceed.
      // accept() would cancel the navigation and keep the page open, which is not what we want.
      const shouldDismiss = type === 'beforeunload';

      try {
        if (shouldDismiss) {
          await dialog.dismiss();
        } else {
          await dialog.accept();
        }
        this.context.dialogStatus = {
          type,
          message,
          response: shouldDismiss ? 'dismiss' : 'accept',
          timestamp: Date.now(),
        };
        logger.info(`[Dialog Handling] Dialog ${shouldDismiss ? 'dismissed' : 'accepted'} - type: ${type}, message: "${message}"`);
      } catch (err) {
        logger.warn(`[Dialog Handling] Failed to handle dialog (already dismissed?): ${err}`);
      }
    });
  }

  /**
   * Get the file path of the most recently completed download.
   * @returns The file path if download is completed, null otherwise.
   */
  public getRecentDownloadedFilePath(): string | null {
    return this.agentServices.getRecentDownloadedFilePath();
  }

  /**
   * Wait for a tracked download to complete. Also covers downloads that have
   * not started yet, so size the timeout to include server-side file
   * generation plus transfer time.
   * @param page - Playwright Page object
   * @param timeoutSeconds - Maximum time to wait in seconds (default: 10)
   */
  public async waitForDownloadComplete(page: Page, timeoutSeconds: number = 10): Promise<void> {
    return this.agentServices.waitForDownloadComplete(page, timeoutSeconds);
  }

  /**
   * Run a natural-language prompt with optional local file attachments,
   * independent of the browser page. The only agent AI primitive that is not
   * page-bound — use it to reason over non-browser artifacts such as
   * downloaded files.
   *
   * Supported attachments: PDF, images (png/jpeg/webp/gif), and text formats
   * (txt/csv/json/md/...). Attachments are validated before the model call.
   *
   * @param prompt - Natural-language instruction or question
   * @param options.files - Local file paths to attach
   * @returns The model's text response
   *
   * @example
   * const filePath = agent.getRecentDownloadedFilePath();
   * const title = await agent.ai('Extract the document title from this PDF.', { files: [filePath!] });
   * expect(title).toContain('Q3 Revenue Report');
   */
  async ai(prompt: string, options?: { files?: string[] }): Promise<string> {
    const model = this.agentServices.getModel();
    const files = options?.files ?? [];
    logger.info(`[agent.ai] "${prompt}" (${files.length} attachment(s), model ${model})`);

    const { text, tokenUsage } = await runAiAnalysis(prompt, files, model);

    if (tokenUsage) {
      this.collectTokenUsages([tokenUsage]);
    }
    // Execution history feeds later prompts — keep long responses bounded.
    this.addToExecutionHistory(`AI: "${prompt}"`, text.length > 500 ? `${text.slice(0, 500)}…` : text);
    return text;
  }

  /**
   * Add a note to the current step execution context.
   * @param note - Note to add
   */
  public addNote(note: string): void {
    this.agentServices.addNote(note);
  }

  /**
   * Generate a time-based one-time password (TOTP) 2FA code from a secret key.
   *
   * Use this when driving a custom multi-step login by hand (in a `js:`/CODE
   * block or auth script) instead of `agent.login()`, which already handles
   * TOTP internally when given `totpSecret`.
   *
   * @param secret - TOTP secret key (base32)
   * @returns The current 6-digit OTP code
   *
   * @example
   * const code = await agent.generate2faCode("JBSWY3DPEHPK3PXP");
   * await agent.execute(page, `Enter the verification code ${code}`);
   */
  async generate2faCode(secret: string): Promise<string> {
    return this.agentServices.generate2faCode(secret);
  }

  /**
   * Collect token usages into the context
   * Accepts either debugInfo (with tokenUsages inside) or raw tokenUsages array
   * @internal
   */
  private collectTokenUsages(
    debugInfoOrTokenUsages?:
      | ActionGenerationDebugInfo
      | Array<{
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
          estimated_cost_usd?: number;
          model?: string;
        }>,
  ): void {
    // Extract tokenUsages from either debugInfo or direct array
    let tokenUsages:
      | Array<{
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
          estimated_cost_usd?: number;
          model?: string;
        }>
      | undefined;

    if (Array.isArray(debugInfoOrTokenUsages)) {
      // Direct token usages array (from TaskResult)
      tokenUsages = debugInfoOrTokenUsages;
    } else if (debugInfoOrTokenUsages?.tokenUsages) {
      // From debugInfo (from ActionStepResult)
      tokenUsages = debugInfoOrTokenUsages.tokenUsages;
    }

    if (tokenUsages && tokenUsages.length > 0) {
      if (!this.context.tokenUsages) {
        this.context.tokenUsages = [];
      }
      this.context.tokenUsages.push(...tokenUsages);
      logger.debug(
        `[collectTokenUsages] Added ${tokenUsages.length} token usage(s), total: ${this.context.tokenUsages.length}`,
      );
    } else {
      logger.debug(`[collectTokenUsages] No token usages to collect (undefined or empty)`);
    }
  }

  /**
   * Track an AI action (LLM API call) for a step
   * @internal
   */
  private trackAIAction(
    stepId: string,
    actionType: 'execute' | 'generate' | 'assert' | 'evaluate' | 'run',
    debugInfo?: ActionGenerationDebugInfo,
    count: number = 1,
    statement?: string,
    explanation?: string,
    conditionKind?: 'if' | 'while' | 'wait_until',
  ): void {
    if (!stepId) return;

    const tokenUsages = debugInfo?.tokenUsages || [];

    // Initialize array if needed
    if (!this.context.aiActionDetails) {
      this.context.aiActionDetails = [];
    }

    // Find existing entry for this stepId and actionType
    let entry = this.context.aiActionDetails.find(
      (detail) => detail.stepId === stepId && detail.actionType === actionType,
    );

    if (entry) {
      // Update existing entry
      entry.count += count;
      if (tokenUsages.length > 0) {
        entry.tokenUsages.push(...tokenUsages);
      }
      // Update with latest debug info (for retries, keep last values)
      if (debugInfo?.userPrompt) entry.userPrompt = debugInfo.userPrompt;
      if (debugInfo?.rawLlmResponse) entry.rawLlmResponse = debugInfo.rawLlmResponse;
      if (debugInfo?.reasoningContent) entry.reasoningContent = debugInfo.reasoningContent;
      if (debugInfo?.elementTree) entry.elementTree = debugInfo.elementTree;
      if (debugInfo?.screenshotWithSom) entry.screenshotWithSom = debugInfo.screenshotWithSom;
      if (explanation) entry.explanation = explanation;
      if (conditionKind) entry.conditionKind = conditionKind;
    } else {
      // Create new entry with all available debug info
      this.context.aiActionDetails.push({
        stepId,
        actionType,
        conditionKind,
        count,
        tokenUsages: [...tokenUsages],
        statement,
        userPrompt: debugInfo?.userPrompt,
        rawLlmResponse: debugInfo?.rawLlmResponse,
        reasoningContent: debugInfo?.reasoningContent,
        explanation,
        elementTree: debugInfo?.elementTree,
        screenshotWithSom: debugInfo?.screenshotWithSom,
      });
    }

    logger.debug(`[trackAIAction] Tracked ${actionType} for step ${stepId}, count: ${count}`);
  }

  /**
   * Make an AI-powered assertion
   */
  async assert(page: Page, statement: string, stepId?: string): Promise<boolean> {
    logger.info(`Asserting statement: ${statement}`);
    if (stepId && this.context.stepTracking) {
      await this.createStepResult(page, stepId, statement, 'assert');
    }

    await this.agentServices.waitUntilStable(page);

    try {
      const executionHistory = this.getCompletedExecutionHistory();

      const result = await evaluateStatement(statement, page, this.agentServices, {
        executionHistory,
        useCleanScreenshotForAssertion: true,
        variables: this.context.variableStore.getAll(),
        sensitiveKeys: this.context.variableStore.getAllSensitiveKeys(),
      });

      // Collect token usages and track intelligent action
      this.collectTokenUsages(result.debugInfo);

      // Store debugInfo in context for retrieval after VM execution
      this.context.lastActionDebugInfo = result.debugInfo;

      const explanation = result.explanation || result.error || 'No explanation';
      if (stepId) {
        this.trackAIAction(stepId, 'assert', result.debugInfo, 1, statement, explanation);
      }

      // Save explanation to agentNote so it can be passed to front-end
      this.context.agentNote = explanation;

      if (stepId && this.context.stepTracking) {
        await this.updateStepResult(
          stepId,
          result.success ? 'success' : 'failure',
          explanation,
          undefined,
          result.debugInfo,
        );
      }

      if (!result.success) {
        this.addToExecutionHistory(`Assert: "${statement}"`, `Failed: ${explanation}`);
        throw new Error(`Assertion failed: ${explanation}`);
      }

      this.addToExecutionHistory(`Assert: "${statement}"`, `Passed: ${explanation}`);
      return true;
    } catch (error: any) {
      if (stepId && this.context.stepTracking) {
        await this.updateStepResult(stepId, 'failure', error.message);
      }
      throw error;
    }
  }

  /**
   * Evaluate a condition using AI (returns boolean, doesn't throw)
   */
  async evaluate(
    page: Page,
    statement: string,
    stepId?: string,
    conditionKind?: 'if' | 'while' | 'wait_until',
  ): Promise<boolean> {
    logger.info(`Evaluating condition: ${statement}`);
    if (stepId && this.context.stepTracking) {
      await this.createStepResult(page, stepId, statement, 'evaluate');
    }

    await this.agentServices.waitUntilStable(page);

    try {
      const executionHistory = this.getCompletedExecutionHistory();

      const result = await evaluateStatement(statement, page, this.agentServices, {
        executionHistory,
        variables: this.context.variableStore.getAll(),
        sensitiveKeys: this.context.variableStore.getAllSensitiveKeys(),
      });

      // Collect token usages and track intelligent action
      this.collectTokenUsages(result.debugInfo);

      // Store debugInfo in context for retrieval after VM execution
      this.context.lastActionDebugInfo = result.debugInfo;

      const explanation = result.explanation || result.error || 'No explanation';
      if (stepId) {
        this.trackAIAction(stepId, 'evaluate', result.debugInfo, 1, statement, explanation, conditionKind);
      }

      // Save explanation to agentNote so it can be passed to front-end
      this.context.agentNote = explanation;

      if (stepId && this.context.stepTracking) {
        // For evaluate() used in IF/WHILE conditions, the status reflects whether
        // the evaluation itself succeeded, not whether the condition was true/false.
        // The condition result (true/false) is captured in the explanation.
        await this.updateStepResult(
          stepId,
          'success',
          explanation,
          undefined,
          result.debugInfo,
        );
      }

      // For evaluate(), 'unknown' means we couldn't determine the answer
      // Return false instead of throwing, so if/while statements can proceed
      if (!result.success) {
        logger.warn(`AI evaluation returned false/unknown: ${explanation}`);
        this.addToExecutionHistory(`Evaluate: "${statement}"`, `Unknown/False: ${explanation}`);
        return false;
      }

      this.addToExecutionHistory(`Evaluate: "${statement}"`, `Result: true - ${explanation}`);
      return true;
    } catch (error: any) {
      if (stepId && this.context.stepTracking) {
        await this.updateStepResult(stepId, 'failure', error.message);
      }
      throw error;
    }
  }

  /**
   * Perform a single action on the page.
   *
   * Directly calls executeStep for precise single-action execution.
   * Use this for discrete actions like clicking, filling, or selecting.
   *
   * @param page - Playwright Page object
   * @param instruction - Natural language instruction for a single action
   * @returns Result with success status and details
   *
   * @example
   * ```typescript
   * await agent.performAction(page, 'Click the submit button');
   * await agent.performAction(page, 'Fill the email field with test@example.com');
   * ```
   */
  async performAction(page: Page, instruction: string): Promise<AgentStepResult> {
    logger.info(`Act: ${instruction}`);

    const executionHistory = this.getCompletedExecutionHistory();

    const result = await executeStep(instruction, page, this.agentServices, {
      executionHistory,
      variables: this.context.variableStore.getAll(),
      sensitiveKeys: this.context.variableStore.getAllSensitiveKeys(),
    });

    // Collect token usages
    this.collectTokenUsages(result.debugInfo);

    if (result.status !== 'success' || result.actionEntities.length === 0) {
      const explanation = result.explanation || result.error || 'Action failed';
      return {
        success: false,
        details: explanation,
      };
    }

    // Add to execution history
    const actionDescription = result.actionEntities[0]?.action_description || instruction;
    this.addToExecutionHistory(instruction, actionDescription);

    return {
      success: true,
      details: result.explanation,
    };
  }

  /**
   * Execute an AI-powered action
   *
   * @param page - Playwright Page object
   * @param statement - Natural language instruction to execute
   * @param stepId - Optional step ID for tracking
   * @param usePureVision - Optional flag to use pure vision mode
   * @param maxSteps - Max steps: undefined or 1 = single-step (default), >1 = multi-step
   *
   * @example
   * ```typescript
   * // Default behavior (single-step, fast)
   * await agent.execute(page, "Click the submit button");
   *
   * // Multi-step for complex statements
   * await agent.execute(page, "Fill out the entire form with test data and submit", stepId, false, 10);
   * ```
   */
  async execute(
    page: Page,
    statement: string,
    stepId?: string,
    usePureVision?: boolean,
    maxSteps?: number,
  ): Promise<AgentStepResult> {
    if (maxSteps !== undefined && maxSteps <= 0) {
      throw new Error(`maxSteps must be >= 1, got ${maxSteps}`);
    }
    const isMulti = maxSteps !== undefined && maxSteps > 1;
    logger.info(`Executing statement: ${statement} (${isMulti ? `multi, maxSteps: ${maxSteps}` : 'single'})`);

    if (stepId && this.context.stepTracking) {
      await this.createStepResult(page, stepId, statement, 'execute');
    }

    page = this.agentServices.validatePage(page);
    await this.agentServices.waitUntilStable(page);

    try {
      const executionHistory = this.getCompletedExecutionHistory();

      // Clear agent note before execution to capture fresh notes
      this.context.agentNote = '';

      let result;
      let completesInstruction: boolean;

      if (isMulti) {
        // Create onEvent callback to capture debugInfo from each step and save to artifacts
        const onEvent = stepId && this.context.stepTracking?.artifactsDir
          ? (event: any) => {
              if (event.type === 'action' && event.debugInfo) {
                // Save debugInfo for each action in multi-step execution
                const stepSubId = `${stepId}-step${event.step}`;
                this.saveDebugInfoToFiles(stepSubId, event.debugInfo, this.context.model);
              }
            }
          : undefined;

        // Use runTask for complex multi-step execution
        result = await runTask(statement, page, this.agentServices, onEvent, {
          executionHistory,
          variables: this.context.variableStore.getAll(),
          sensitiveKeys: this.context.variableStore.getAllSensitiveKeys(),
          maxSteps: maxSteps ?? DEFAULT_MULTI_STEP_MAX,
        });

        // For multi-step, require goal completion
        completesInstruction = result.completed;

        // For multi-step execution, collect token usages from the aggregated result
        this.collectTokenUsages(result.tokenUsages);

        // Track intelligent action for multi-step execution
        if (stepId && result.tokenUsages) {
          const debugInfoForTracking = { tokenUsages: result.tokenUsages };
          this.trackAIAction(
            stepId,
            'execute',
            debugInfoForTracking,
            result.actionEntities?.length || 1,
            statement,
            result.explanation || 'Multi-step execution completed',
          );
        }
      } else {
        page = this.agentServices.validatePage(page);
        // Use executeStep for single-step execution (default)
        result = await executeStep(statement, page, this.agentServices, {
          executionHistory,
          variables: this.context.variableStore.getAll(),
          sensitiveKeys: this.context.variableStore.getAllSensitiveKeys(),
          usePureVision: usePureVision,
        });

        // Single-step must still respect the model's goal completion assessment.
        completesInstruction = result.completed;

        // Collect token usages and track intelligent action for single-step
        this.collectTokenUsages(result.debugInfo);

        // Store debugInfo in context for retrieval after VM execution
        this.context.lastActionDebugInfo = result.debugInfo;

        if (stepId) {
          const explanation = result.explanation || result.error || 'No explanation';
          this.trackAIAction(stepId, 'execute', result.debugInfo, 1, statement, explanation);
        }
      }

      if (result.status !== 'success' || result.actionEntities.length === 0 || !completesInstruction) {
        const explanation = result.explanation || result.error || 'Goal not completed';
        if (stepId && this.context.stepTracking) {
          await this.updateStepResult(stepId, 'failure', explanation, undefined, result.debugInfo);
        }
        throw new Error(`Action failed: ${explanation}`);
      }

      // Use agentNote if set by action execution, otherwise fall back to result.explanation
      const executionNote = this.context.agentNote || result.explanation || 'Action executed successfully';

      if (stepId && this.context.stepTracking) {
        await this.updateStepResult(stepId, 'success', executionNote, undefined, result.debugInfo);
      }

      this.addToExecutionHistory(`Execute: "${statement}"`, executionNote);
      return { success: true, details: executionNote, actions: result.actionEntities, debugInfo: result.debugInfo };
    } catch (error: any) {
      if (stepId && this.context.stepTracking) {
        await this.updateStepResult(stepId, 'failure', error.message);
      }
      this.addToExecutionHistory(`Execute: "${statement}"`, `Failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate an AI-powered action (without executing it)
   * Similar to execute() but only generates the actionEntity without execution
   * Returns the action with a goal completion flag (success = goalAccomplished)
   */
  async generate(page: Page, statement: string, stepId?: string, usePureVision?: boolean): Promise<AgentStepResult> {
    if (stepId && this.context.stepTracking) {
      await this.createStepResult(page, stepId, statement, 'generate');
    }

    try {
      const executionHistory = this.getCompletedExecutionHistory();

      const result = await generateActionStep(statement, page, this.agentServices, {
        executionHistory,
        variables: this.context.variableStore.getAll(),
        sensitiveKeys: this.context.variableStore.getAllSensitiveKeys(),
        usePureVision: usePureVision,
      });

      // Collect token usages and track intelligent action
      this.collectTokenUsages(result.debugInfo);

      if (result.status !== 'success' || result.actionEntities.length === 0) {
        const explanation = result.explanation || result.error || 'No explanation';
        if (stepId) {
          this.trackAIAction(stepId, 'generate', result.debugInfo, 1, statement, explanation);
        }
        if (stepId && this.context.stepTracking) {
          await this.updateStepResult(stepId, 'failure', explanation, undefined, result.debugInfo);
        }
        throw new Error(explanation);
      }

      // success flag indicates if goal was accomplished (completed field in StepResult)
      const success = result.completed;
      const explanation = result.explanation || 'Action generated successfully';

      if (stepId) {
        this.trackAIAction(stepId, 'generate', result.debugInfo, 1, statement, explanation);
      }

      if (stepId && this.context.stepTracking) {
        await this.updateStepResult(stepId, 'success', explanation, undefined, result.debugInfo);
      }

      // Don't add to execution history since we didn't execute
      logger.info(
        `[generate] Generated action for "${statement}": ${explanation}, goalAccomplished: ${result.completed}`,
      );

      return {
        success,
        details: explanation,
        actions: result.actionEntities,
        debugInfo: result.debugInfo,
      };
    } catch (error: any) {
      if (stepId && this.context.stepTracking) {
        await this.updateStepResult(stepId, 'failure', error.message);
      }
      throw error;
    }
  }

  /**
   * Run a complex AI step (multi-step execution)
   */
  async run(
    page: Page,
    task: string,
    stepId?: string,
    options?: {
      abortSignal?: AbortSignal;
      maxSteps?: number;
      onAction?: (action: ActionEntity) => void;
      /** Statement UID for storing resolved action entity (DRAFT grounding) */
      stmtUid?: string;
    },
  ): Promise<AgentStepResult> {
    if (stepId && this.context.stepTracking) {
      await this.createStepResult(page, stepId, task, 'run');
    }

    try {
      const executionHistory = this.getCompletedExecutionHistory();

      // Clear agent note before execution to capture fresh notes
      this.context.agentNote = '';

      // Build onEvent callback to stream actions back to caller and save debugInfo to artifacts
      const shouldSaveArtifacts = stepId && this.context.stepTracking?.artifactsDir;
      const onEvent = (options?.onAction || shouldSaveArtifacts)
        ? (event: any) => {
            if (event.type === 'action' && event.action_entity) {
              // Forward action to caller's callback if provided
              options?.onAction?.(event.action_entity);
              // Save debugInfo to artifacts for each step
              if (shouldSaveArtifacts && event.debugInfo) {
                const stepSubId = `${stepId}-step${event.step}`;
                this.saveDebugInfoToFiles(stepSubId, event.debugInfo, this.context.model);
              }
            }
          }
        : undefined;

      const result = await runTask(task, page, this.agentServices, onEvent, {
        executionHistory,
        variables: this.context.variableStore.getAll(),
        sensitiveKeys: this.context.variableStore.getAllSensitiveKeys(),
        abortSignal: options?.abortSignal,
        maxSteps: options?.maxSteps,
      });

      agentLogger.log(`Run task result: status=${result.status}, completed=${result.completed}, actions=${result.actionEntities?.length || 0}`);

      // Collect token usages from the task execution (multi-step aggregated)
      this.collectTokenUsages(result.tokenUsages);

      const success = result.status === 'success' && result.completed;
      // Prefer agentNote (set by tools like `verify`) over generic task summaries
      const summary =
        this.context.agentNote?.trim() ||
        result.explanation ||
        result.error ||
        (success ? 'Step completed' : 'Step failed');

      // Track intelligent action for multi-step run (count = number of actions)
      if (stepId && result.tokenUsages) {
        // For run, track using the aggregated token usages
        // Create a synthetic debugInfo with the tokenUsages
        const debugInfoForTracking = { tokenUsages: result.tokenUsages };
        this.trackAIAction(stepId, 'run', debugInfoForTracking, result.actionEntities?.length || 1, task, summary);
      }

      if (!success) {
        throw new AgentTaskFailedError(summary);
      }

      // Store resolved action entity for DRAFT grounding.
      // The last action entity from the run represents the final resolved action.
      if (options?.stmtUid && result.actionEntities?.length) {
        const lastEntity = result.actionEntities.at(-1);
        if (lastEntity) {
          this._newActionEntities.set(options.stmtUid, lastEntity);
          agentLogger.log(`Stored resolved action entity for DRAFT stmtUid: ${options.stmtUid}`);
        }
      }

      if (stepId && this.context.stepTracking) {
        // Multi-step tasks don't have single debugInfo, pass undefined
        await this.updateStepResult(stepId, 'success', summary, undefined, undefined);
      }

      this.addToExecutionHistory(`Run: "${task}"`, summary);

      agentLogger.log(`Run result: success=${success}, details=${summary}`);
      return {
        success,
        details: summary,
        actions: result.actionEntities,
      };
    } catch (error: any) {
      if (stepId && this.context.stepTracking) {
        await this.updateStepResult(stepId, 'failure', error.message);
      }
      this.addToExecutionHistory(`Run: "${task}"`, `Failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Wrapper function for executing action code with self-healing support
   * Similar to context._internal.step from monots
   *
   * @param page - Playwright page
   * @param fn - Async function containing the action code to execute
   * @param description - Description of the step
   * @param stepId - Step ID for tracking
   * @param stmtUid - Statement UID for tracking new action entities (optional)
   * @param canSelfHeal - Whether to enable self-healing on failure (default: true)
   * @param maxSteps - Maximum steps for self-healing (1=single, >1=multi, default: 1)
   * @returns Result of the function execution
   */
  async step(
    page: Page,
    fn: () => Promise<any>,
    description: string,
    stepId: string,
    stmtUid?: string,
    canSelfHeal: boolean = true,
    maxSteps?: number,
  ): Promise<any> {
    description = this.resolveDescription(description);
    const startTime = Date.now();

    // Create step result for tracking
    if (this.context.stepTracking) {
      await this.createStepResult(page, stepId, description, 'step');
      // Record the executed function body for report display
      const code = extractFunctionBody(fn);
      if (code && this.context.stepTracking.results[stepId]) {
        this.context.stepTracking.results[stepId].code = code;
      }
      // Stamp the statement UID onto the step result. This is what makes a
      // cache metric execution-scoped: the transpiler knows which statements
      // resolved from the cache but not which ones ran, and only steps that
      // reach here ran. Set after createStepResult because that call returns
      // early for a step id it has already seen (a WHILE body on its second
      // iteration), and the UID must be present either way.
      if (stmtUid && this.context.stepTracking.results[stepId]) {
        this.context.stepTracking.results[stepId].stmtUid = stmtUid;
      }
    }

    page = this.agentServices.validatePage(page);
    await this.agentServices.waitUntilStable(page);

    // Set current step ID for state transitions and console log association
    if (this.context.stepTracking) {
      this.context.stepTracking.currentStepId = stepId;
    }

    // Capture state BEFORE execution (for state transitions)
    page = this.agentServices.validatePage(page);
    const urlBefore = page.url();
    const domBefore = await this.captureDOMSnapshot(page);
    const variablesBefore = this.context.stepTracking?.captureVariables
      ? maskSensitiveVariables(
          this.context.variableStore.getAll(),
          this.context.variableStore.getAllSensitiveKeys()
        )
      : {};
    const screenshotBeforePath = this.context.stepTracking?.results[stepId]?.screenshot;

    try {
      logger.info(`Executing step ${stepId}: ${description}`);

      // Add to execution history with empty feedback initially
      this.addToExecutionHistory(description, '');

      // Clear agent note before execution
      this.context.agentNote = '';

      // Execute the provided function
      page = this.agentServices.validatePage(page);
      const result = await fn();

      // Capture state AFTER execution
      page = this.agentServices.validatePage(page);
      const urlAfter = page.url();
      const domAfter = await this.captureDOMSnapshot(page);
      const variablesAfter = this.context.stepTracking?.captureVariables
        ? maskSensitiveVariables(
            this.context.variableStore.getAll(),
            this.context.variableStore.getAllSensitiveKeys()
          )
        : {};

      // Update step result on success
      if (this.context.stepTracking) {
        await this.updateStepResult(stepId, 'success', '');
      }

      // Build state transition entries (interlaced format: state → action → state)
      if (this.context.stepTracking?.captureStateTransitions && this.context.stepTracking.stateTransitions) {
        const durationMs = Date.now() - startTime;
        const screenshotAfterPath = this.context.stepTracking.results[stepId]?.screenshot;
        const now = Date.now();

        // If this is the first entry, push initial state
        if (this.context.stepTracking.stateTransitions.length === 0) {
          this.context.stepTracking.stateTransitions.push({
            type: 'state',
            url: urlBefore,
            domSnapshot: domBefore || undefined,
            variables: variablesBefore,
            screenshotPath: screenshotBeforePath,
            timestamp: startTime,
          });
        }

        // Push action entry
        this.context.stepTracking.stateTransitions.push({
          type: 'action',
          stepId,
          description,
          action: {
            playwrightCode: [fn.toString()],
          },
          consoleLogs: this.getConsoleLogsForStep(stepId),
          durationMs,
          status: 'success',
        });

        // Push resulting state entry
        this.context.stepTracking.stateTransitions.push({
          type: 'state',
          url: urlAfter,
          domSnapshot: domAfter || undefined,
          variables: variablesAfter,
          screenshotPath: screenshotAfterPath,
          timestamp: now,
        });
      }

      // Update execution history with success feedback from agentNote
      let executionNote = this.context.agentNote;
      if (!executionNote || executionNote.trim() === '') {
        executionNote = 'Execution successful';
      }
      if (this.context.executionHistory && this.context.executionHistory.length > 0) {
        this.context.executionHistory[this.context.executionHistory.length - 1][1] = executionNote;
      }

      // Clear current step ID
      if (this.context.stepTracking) {
        this.context.stepTracking.currentStepId = undefined;
      }

      return result;
    } catch (error: any) {
      page = this.agentServices.validatePage(page);
      const ableToSelfHeal = canSelfHeal && !this.context.isSelfHealing;

      if (ableToSelfHeal) {
        // Save the screenshot to the test result folder on first failure
        if (this.context.stepTracking) {
          await this.updateStepResult(stepId, 'failure', error.message);
        }

        // Update execution history with failure feedback
        if (this.context.executionHistory && this.context.executionHistory.length > 0) {
          this.context.executionHistory[this.context.executionHistory.length - 1][1] = error.message;
        }
      }

      if (!description || description.trim() === '') {
        logger.error('No description provided for self-healing');
        // Clear current step ID
        if (this.context.stepTracking) {
          this.context.stepTracking.currentStepId = undefined;
        }
        throw error;
      }

      // If in self-healing mode already, don't attempt to heal again
      if (!ableToSelfHeal) {
        logger.info(`Failed to heal at step ${stepId}. ${description}`);
        this.context.isSelfHealing = false;

        // Build state transition entries for failure (interlaced format)
        if (this.context.stepTracking?.captureStateTransitions && this.context.stepTracking.stateTransitions) {
          const urlAfter = page.url();
          const domAfter = await this.captureDOMSnapshot(page);
          const variablesAfter = this.context.stepTracking.captureVariables
            ? maskSensitiveVariables(
                this.context.variableStore.getAll(),
                this.context.variableStore.getAllSensitiveKeys()
              )
            : {};
          const durationMs = Date.now() - startTime;
          const now = Date.now();

          // If this is the first entry, push initial state
          if (this.context.stepTracking.stateTransitions.length === 0) {
            this.context.stepTracking.stateTransitions.push({
              type: 'state',
              url: urlBefore,
              domSnapshot: domBefore || undefined,
              variables: variablesBefore,
              screenshotPath: screenshotBeforePath,
              timestamp: startTime,
            });
          }

          // Push action entry
          this.context.stepTracking.stateTransitions.push({
            type: 'action',
            stepId,
            description,
            action: {
              playwrightCode: [fn.toString()],
            },
            consoleLogs: this.getConsoleLogsForStep(stepId),
            durationMs,
            status: 'failure',
            errorMessage: error.message,
          });

          // Push resulting state entry
          this.context.stepTracking.stateTransitions.push({
            type: 'state',
            url: urlAfter,
            domSnapshot: domAfter || undefined,
            variables: variablesAfter,
            timestamp: now,
          });
        }

        // Update duration even when throwing
        if (this.context.stepTracking) {
          await this.updateStepResult(stepId, undefined, undefined);
          this.context.stepTracking.currentStepId = undefined;
        }
        throw error;
      }

      // Enable self-healing mode
      this.context.isSelfHealing = true;

      logger.info(`Action failed at step ${stepId}. ${description}`);
      logger.info(`with error: ${error.message}`);

      // Try to dismiss modal before self-healing if enabled
      let modalDismissedNote: string | undefined;
      let dismissedModalActions: ActionEntity[] | undefined;
      if (this.context.autoDismissModal) {
        logger.info('Attempting modal dismissal before self-healing...');
        const dismissResult = await this.dismissModalIfPresent(page, description);
        logger.info(`Modal dismissal result: ${dismissResult.details}`);
        if (dismissResult.modalDismissed) {
          modalDismissedNote = `[Auto-dismissed modal: ${dismissResult.details}]`;
          dismissedModalActions = dismissResult.actions;

          // Modal was dismissed - retry the original action before falling back to LLM self-healing
          logger.info(`Modal dismissed, retrying original action for step ${stepId}`);
          try {
            const retryResult = await fn();
            this.context.isSelfHealing = false;

            // Update execution history with success after modal dismissal
            if (this.context.executionHistory && this.context.executionHistory.length > 0) {
              this.context.executionHistory[this.context.executionHistory.length - 1][1] = modalDismissedNote + ' Retry successful';
            }

            if (this.context.stepTracking) {
              await this.updateStepResult(stepId, 'success', modalDismissedNote);
              this.context.stepTracking.results[stepId].dismissedModalActions = dismissedModalActions;
              this.context.stepTracking.currentStepId = undefined;
            }

            this.context.agentNote = modalDismissedNote;
            return retryResult;
          } catch (retryError: any) {
            logger.info(`Retry after modal dismissal failed: ${retryError.message}, falling back to self-healing`);
          }
        }
      }

      // Determine maxSteps for self-healing
      // 1: single-step (one retry), >1: multi-step recovery
      const effectiveMaxSteps = maxSteps ?? MAX_SELF_HEALING_STEPS;

      logger.info(`Calling execute() to self-heal (maxSteps: ${effectiveMaxSteps})`);

      // Whether the heal itself worked, as distinct from whether the rest of this
      // try block did. The catch below stamps `healFailed`, and it wraps far more
      // than the model call — the post-heal `page.url()` and DOM snapshot throw if
      // the healed action closed the page or its popup context. Without this flag
      // such a step lands in the catch before `autoHealed` is ever assigned and is
      // recorded as a failed heal, contradicting the healed entity that has already
      // been written to `_newActionEntities` and folded in as `healed` by the
      // reporter's cache summary.
      let healRecovered = false;

      try {
        const result = await this.execute(page, description, stepId, false, effectiveMaxSteps);
        this.context.isSelfHealing = false;

        if (!result.success) {
          throw new Error(`Self-healing failed: ${result.details}`);
        }
        healRecovered = true;

        // Store new action entity if stmtUid provided
        // Use the LAST action (not first) since multi-step may dismiss popups before the actual action
        const lastAction = result.actions?.at(-1);
        if (stmtUid && lastAction) {
          this._newActionEntities.set(stmtUid, lastAction);
          logger.info(`Stored new action entity for stmtUid: ${stmtUid} (last of ${result.actions?.length} actions)`);
        }

        // Capture state after self-healing
        const urlAfter = page.url();
        const domAfter = await this.captureDOMSnapshot(page);
        const variablesAfter = this.context.stepTracking?.captureVariables
          ? maskSensitiveVariables(
              this.context.variableStore.getAll(),
              this.context.variableStore.getAllSensitiveKeys()
            )
          : {};

        // Update status after successful self-healing, include modal dismissal note if applicable
        if (this.context.stepTracking) {
          this.context.stepTracking.results[stepId].autoHealed = true;
          this.context.stepTracking.results[stepId].healedAction = lastAction;
          if (dismissedModalActions) {
            this.context.stepTracking.results[stepId].dismissedModalActions = dismissedModalActions;
          }
          const message = modalDismissedNote || '';
          await this.updateStepResult(stepId, 'success', message);
        }

        // Build state transition entries for self-healed step (interlaced format)
        if (this.context.stepTracking?.captureStateTransitions && this.context.stepTracking.stateTransitions) {
          const durationMs = Date.now() - startTime;
          const screenshotAfterPath = this.context.stepTracking.results[stepId]?.screenshot;
          const now = Date.now();

          // If this is the first entry, push initial state
          if (this.context.stepTracking.stateTransitions.length === 0) {
            this.context.stepTracking.stateTransitions.push({
              type: 'state',
              url: urlBefore,
              domSnapshot: domBefore || undefined,
              variables: variablesBefore,
              screenshotPath: screenshotBeforePath,
              timestamp: startTime,
            });
          }

          // Push action entry
          this.context.stepTracking.stateTransitions.push({
            type: 'action',
            stepId,
            description,
            action: {
              actionEntity: lastAction,
              playwrightCode: result.actions?.map(a => a.locator || ''),
              llmPrompt: result.debugInfo?.userPrompt as string,
              llmResponse: result.debugInfo?.rawLlmResponse,
              llmReasoning: result.debugInfo?.reasoningContent,
            },
            consoleLogs: this.getConsoleLogsForStep(stepId),
            durationMs,
            status: 'success',
          });

          // Push resulting state entry
          this.context.stepTracking.stateTransitions.push({
            type: 'state',
            url: urlAfter,
            domSnapshot: domAfter || undefined,
            variables: variablesAfter,
            screenshotPath: screenshotAfterPath,
            timestamp: now,
          });
        }

        // Clear current step ID
        if (this.context.stepTracking) {
          this.context.stepTracking.currentStepId = undefined;
        }

        return result;
      } catch (healError: unknown) {
        this.context.isSelfHealing = false;

        // Record which of the two the model call bought. Reaching this catch means
        // the action failed, self-healing was allowed, and the model was called — so
        // an auto-heal fired either way; only the outcome differs. `healRecovered`
        // separates a heal that genuinely could not recover the step from one that
        // worked and was then undone by the post-heal bookkeeping (a closed page).
        // Recorded because nothing else survives a failed heal: no healed entity is
        // produced, so the statement would otherwise be indistinguishable from one
        // whose cached entity simply worked.
        if (this.context.stepTracking?.results[stepId]) {
          if (healRecovered) {
            this.context.stepTracking.results[stepId].autoHealed = true;
          } else {
            this.context.stepTracking.results[stepId].healFailed = true;
          }
        }

        // Built once so the recorded state transition and the thrown error say
        // the same thing — the report and debugger read the transition, and
        // showing only the self-heal message there reproduced issue #2209's
        // confusing output everywhere except the exception itself.
        const combinedError = buildSelfHealFailureError(error, healError);

        // Build state transition entries for failed self-healing (interlaced format)
        if (this.context.stepTracking?.captureStateTransitions && this.context.stepTracking.stateTransitions) {
          const urlAfter = page.url();
          const domAfter = await this.captureDOMSnapshot(page);
          const variablesAfter = this.context.stepTracking.captureVariables
            ? maskSensitiveVariables(
                this.context.variableStore.getAll(),
                this.context.variableStore.getAllSensitiveKeys()
              )
            : {};
          const durationMs = Date.now() - startTime;
          const now = Date.now();

          // If this is the first entry, push initial state
          if (this.context.stepTracking.stateTransitions.length === 0) {
            this.context.stepTracking.stateTransitions.push({
              type: 'state',
              url: urlBefore,
              domSnapshot: domBefore || undefined,
              variables: variablesBefore,
              screenshotPath: screenshotBeforePath,
              timestamp: startTime,
            });
          }

          // Push action entry
          this.context.stepTracking.stateTransitions.push({
            type: 'action',
            stepId,
            description,
            action: {
              playwrightCode: [fn.toString()],
            },
            consoleLogs: this.getConsoleLogsForStep(stepId),
            durationMs,
            status: 'failure',
            errorMessage: combinedError.message,
          });

          // Push resulting state entry
          this.context.stepTracking.stateTransitions.push({
            type: 'state',
            url: urlAfter,
            domSnapshot: domAfter || undefined,
            variables: variablesAfter,
            timestamp: now,
          });
        }

        // Clear current step ID
        if (this.context.stepTracking) {
          this.context.stepTracking.currentStepId = undefined;
        }

        // Report BOTH failures. Throwing only healError hid the real cause: a
        // failed navigation surfaced as the AI SDK's "baseURL must be a
        // non-empty string" — the LLM client's baseURL, an unrelated setting
        // worded almost identically to the test's own missing test.use({ baseURL }).
        // See issue #2209.
        throw combinedError;
      }
    }
  }

  /**
   * Extract element data using AI and store in variable
   */
  async extract(page: Page, elementDescription: string, variableName: string, stepId?: string): Promise<void> {
    if (stepId && this.context.stepTracking) {
      await this.createStepResult(page, stepId, `Extract ${elementDescription} into ${variableName}`, 'extract');
    }

    try {
      // Construct the statement for AI to understand what to extract
      const statement = `Extract ${elementDescription} and save to ${variableName}`;

      // Use execute to generate the extraction action
      const result = await this.execute(page, statement, stepId);

      if (!result.success) {
        throw new Error(`AI extraction failed: ${result.details}`);
      }

      // The AI will have generated a save_variable action that stores the value
      // in the context, so we don't need to do anything else here

      if (stepId && this.context.stepTracking) {
        await this.updateStepResult(stepId, 'success', `Extracted ${elementDescription} to ${variableName}`);
      }
    } catch (error: any) {
      if (stepId && this.context.stepTracking) {
        await this.updateStepResult(stepId, 'failure', error.message);
      }
      throw error;
    }
  }

  /**
   * Get DOM text from page
   */
  async getDOMText(page: Page): Promise<string> {
    const domService = new DomService(this.agentServices.getDomServiceOptions());
    const interactiveClassNames = this.agentServices.getInteractiveClassNames();
    const playwrightFrameFallbackDomains = this.agentServices.getIframeFallbackDomains();
    const domState = await domService.getClickableElements(page, {
      interactiveClassNames,
      playwrightFrameFallbackDomains,
    });
    return domState.elementTree.clickableElementsToString();
  }

  /**
   * Capture DOM snapshot for state transitions
   * @internal
   */
  private async captureDOMSnapshot(page: Page): Promise<{ elementTreeText: string; elementCount: number; timestamp: number } | null> {
    if (!this.context.stepTracking?.captureStateTransitions || !this.context.stepTracking?.captureDom) {
      return null;
    }

    try {
      const domService = new DomService(this.agentServices.getDomServiceOptions());
      const interactiveClassNames = this.agentServices.getInteractiveClassNames();
      const playwrightFrameFallbackDomains = this.agentServices.getIframeFallbackDomains();
      const domState = await domService.getClickableElements(page, {
        interactiveClassNames,
        playwrightFrameFallbackDomains,
        highlightElements: false,
        viewportExpansion: 0,
      });
      return {
        elementTreeText: domState.elementTree.clickableElementsToString(),
        elementCount: domState.selectorMap.size,
        timestamp: Date.now(),
      };
    } catch (e) {
      logger.warn('Failed to capture DOM snapshot:', e);
      return null;
    }
  }

  /**
   * Get console logs associated with a specific step
   * @internal
   */
  private getConsoleLogsForStep(stepId: string): Array<{ type: string; message: string; timestamp: number }> {
    if (!this.context.stepTracking?.consoleLogs) {
      return [];
    }
    return this.context.stepTracking.consoleLogs
      .filter(log => log.stepId === stepId)
      .map(log => ({
        type: log.type,
        message: log.message,
        timestamp: log.timestamp,
      }));
  }

  /**
   * Wait for page to be stable
   * @param page - Playwright Page object
   * @param timeoutMs - Maximum time to wait in milliseconds (default: 3000)
   * @param minWaitTimeMs - Minimum time to wait before returning (default: 1000)
   */
  async waitUntilStable(page: Page, timeoutMs: number = 3000, minWaitTimeMs: number = 1000): Promise<void> {
    return agentWait.waitUntilStable(page, timeoutMs, minWaitTimeMs);
  }

  /**
   * Wait until a condition becomes true using AI evaluation
   * Polls the condition at intervals until it's met or timeout is reached
   *
   * @param page - Playwright Page object
   * @param condition - Natural language condition to evaluate (e.g., "page shows success message")
   * @param timeoutSeconds - Maximum time to wait in seconds (default: 60, max: 280)
   * @returns true if condition was met, false if timeout was reached
   *
   * @example
   * ```typescript
   * // Wait for a success message to appear
   * const success = await agent.waitUntilCondition(page, "page shows success message", 30);
   * if (!success) {
   *   throw new Error("Success message did not appear");
   * }
   * ```
   */
  async waitUntilCondition(page: Page, condition: string, timeoutSeconds: number = 60, stepId: string): Promise<boolean> {
    // Tag every poll as `wait_until` so its LLM calls are attributed to WAIT_UNTIL
    // in the run usage summary rather than being lumped into IF. WAIT_UNTIL polls
    // until the condition is met, so this is typically the largest evaluate driver.
    return agentWait.waitUntilCondition(page, condition, (p, c, s) => this.evaluate(p, c, s, 'wait_until'), timeoutSeconds, stepId);
  }

  /**
   * Wait until a JavaScript predicate returns truthy, polling in-process (no model calls).
   * The fast counterpart to {@link waitUntilCondition}, used by `WAIT_UNTIL: "js:..."`.
   *
   * WAIT_UNTIL synchronizes but never fails the test: on timeout this records a
   * warning-tier step result (distinguishing "condition stayed falsy" from "the
   * predicate never evaluated cleanly") and returns false.
   *
   * @param page - Playwright Page object
   * @param predicate - Thunk evaluating the JS condition; may be async. Truthy return = met.
   * @param timeoutSeconds - Maximum time to wait in seconds (default: 60, max: 300)
   * @param stepId - Optional step id for debugger step tracking
   * @param description - Optional human-readable intent shown as the step label
   *   (the WAIT_UNTIL intent in the intent + sibling `js:` form)
   * @returns true if the condition was met, false on timeout (does not throw on timeout)
   */
  async waitForJs(
    page: Page,
    predicate: () => Promise<unknown> | unknown,
    timeoutSeconds: number = 60,
    stepId?: string,
    description?: string,
  ): Promise<boolean> {
    if (stepId && this.context.stepTracking) {
      await this.createStepResult(page, stepId, description ?? 'Wait for JS condition', 'evaluate');
    }

    try {
      const result = await agentWait.waitForJs(page, predicate, timeoutSeconds);
      const message = agentWait.formatJsWaitOutcome(result);
      if (!result.met) {
        logger.warn(message);
      }
      if (stepId && this.context.stepTracking) {
        await this.updateStepResult(stepId, result.met ? 'success' : 'warning', message);
      }
      return result.met;
    } catch (error) {
      if (stepId && this.context.stepTracking) {
        await this.updateStepResult(stepId, 'failure', (error as Error).message);
      }
      throw error;
    }
  }

  /**
   * Upload one or more files to a file input element
   * Supports multiple upload strategies: direct file input, file chooser dialog, or AI-powered upload
   *
   * @param page - Playwright Page object
   * @param filePaths - File path(s) relative to test data directory, or absolute paths
   * @param options - Upload options (selector, target description, etc.)
   * @returns Promise that resolves when upload is complete
   *
   * @example
   * ```typescript
   * // Upload with CSS selector
   * await agent.uploadFile(page, "document.pdf", {
   *   selector: "input[type='file']"
   * });
   *
   * // Upload multiple files with XPath
   * await agent.uploadFile(page, ["file1.pdf", "file2.jpg"], {
   *   selector: "xpath=//input[@type='file']",
   *   useFileInput: true
   * });
   *
   * // Upload with AI (no selector)
   * await agent.uploadFile(page, "avatar.png", {
   *   targetDescription: "profile picture upload area"
   * });
   * ```
   */
  async uploadFile(
    page: Page,
    filePaths: string | string[],
    options: agentFile.UploadFileOptions = {},
    stepId?: string,
  ): Promise<void> {
    return agentFile.uploadFile(page, filePaths, options, this.context, (p, s, sid) => this.execute(p, s, sid), stepId);
  }

  /**
   * Perform login page flow with navigation and AI-powered authentication
   * @param page - The page to login on
   * @param config - Login configuration
   * @param cache - Optional login cache with cached actions and validation expressions
   * @returns LoginResult with success status, page, and storage state
   */
  async loginPage(page: Page, config: LoginConfig, cache?: LoginCache): Promise<LoginResult<Page>> {
    const { LoginType } = await import('./agentLogin');

    logger.info("Start login");

    agentLogger.section('Login Flow');
    agentLogger.log(`Site URL: ${config.site_url}`);
    agentLogger.log(`Account type: ${config.account.type}`);
    agentLogger.log(`Has cached actions: ${!!cache?.cached_actions?.length}`);
    agentLogger.log(`Has validation exprs: ${!!cache?.validation_exprs?.length}`);

    if (config.skip_verification) {
      logger.info('Skipping login verification (skip_verification=true)');
      return { success: true, page };
    }

    // Enrich test context with credentials
    if (config.account.type === LoginType.PASSWORD || config.account.type === LoginType.OAUTH2) {
      this.context.variableStore.set('username', config.account.username, true);
      this.context.variableStore.set('password', config.account.password, true);
    }
    if (config.account.two_factor_auth_config?.type === 'totp') {
      this.context.variableStore.set('otp_secret_key', config.account.two_factor_auth_config.data, true);
    }

    // Navigate to the site
    logger.info(`Navigating to: ${config.site_url}`);
    await page.goto(config.site_url);
    // Wait for page to be stable, at least 3s
    await this.waitUntilStable(page, 10000, 3000);

    const shouldUseAiVerificationForAlreadyLoggedInCheck = Boolean(
      config.use_ai_verification_for_login_check && config.verification_hint?.trim(),
    );
    const aiVerificationStatement = shouldUseAiVerificationForAlreadyLoggedInCheck
      ? `Check if the page is already signed in. Consider it signed in only when this verification statement is satisfied: ${config.verification_hint!.trim()}`
      : undefined;

    if (shouldUseAiVerificationForAlreadyLoggedInCheck) {
      agentLogger.log('Level 1: Checking if already logged in via AI verification hint...');
      agentLogger.log(`Verification statement: ${aiVerificationStatement}`);

      try {
        const isLoggedIn = await this.evaluate(page, aiVerificationStatement!);
        if (isLoggedIn) {
          agentLogger.log('Level 1 SUCCESS: Already logged in via AI verification');
          logger.info('Login: Already logged in via AI verification');
          return {
            success: true,
            page,
            storage_state: null,
            cached_actions: cache?.cached_actions,
            validation_exprs: cache?.validation_exprs,
            alreadyLoggedIn: true, // Skip update since nothing changed
          };
        }
        agentLogger.log('Level 1 FAILED: AI verification indicates not signed in, trying Level 2');
      } catch (error: any) {
        agentLogger.log(`Level 1 ERROR: AI verification failed (${error.message}), trying Level 2`);
      }
    } else if (config.use_ai_verification_for_login_check && !config.verification_hint?.trim()) {
      agentLogger.log(
        'Level 1 SKIPPED: use_ai_verification_for_login_check is enabled but verification_hint is empty, falling back to cached validation expressions',
      );
    }

    // Level 1 fallback: Check if already logged in via storage state + cached validation expressions
    // Storage state is applied at the browser context level before this method is called
    if (!shouldUseAiVerificationForAlreadyLoggedInCheck && cache?.validation_exprs && cache.validation_exprs.length > 0) {
      agentLogger.log('Level 1: Checking if already logged in via storage state...');
      agentLogger.log(`Validation expressions: ${JSON.stringify(cache.validation_exprs)}`);
      const isLoggedIn = await validateLogin(page, cache.validation_exprs);
      if (isLoggedIn) {
        agentLogger.log('Level 1 SUCCESS: Already logged in via storage state');
        logger.info('Login: Already logged in via storage state');
        return {
          success: true,
          page,
          storage_state: null,
          cached_actions: cache.cached_actions,
          validation_exprs: cache.validation_exprs,
          alreadyLoggedIn: true, // Skip update since nothing changed
        };
      }
      agentLogger.log('Level 1 FAILED: Storage state validation failed, trying Level 2');
    }

    // Level 2: Try cached login actions (must verify success via AI statement or validation expressions)
    const hasValidationExprs = Boolean(cache?.validation_exprs && cache.validation_exprs.length > 0);
    if (cache?.cached_actions && cache.cached_actions.length > 0 &&
        (shouldUseAiVerificationForAlreadyLoggedInCheck || hasValidationExprs)) {
      agentLogger.log(`Level 2: Attempting cached login with ${cache.cached_actions.length} actions`);
      try {
        const cachedResult = await this.executeCachedLogin(page, cache.cached_actions, {
          validationExprs: cache.validation_exprs,
          aiVerificationStatement,
        });
        if (cachedResult.success) {
          agentLogger.log('Level 2 SUCCESS: Cached login succeeded');
          logger.info('Login: Cached login succeeded');
          const storageState = await page.context().storageState();

          return {
            success: true,
            page,
            storage_state: storageState,
            cached_actions: cache.cached_actions,
            validation_exprs: cache.validation_exprs,
          };
        }
        agentLogger.log('Level 2 FAILED: Cached login failed, trying Level 3');
      } catch (error: any) {
        agentLogger.log(`Level 2 ERROR: ${error.message}, trying Level 3`);
      }
    } else if (cache?.cached_actions && cache.cached_actions.length > 0) {
      agentLogger.log('Level 2 SKIPPED: Cached actions exist but no verification method available, going to Level 3');
    }

    // Build login prompt for agent-based login (Level 3)
    let signInPrompt = `First check if the page is already signed in. If it is, do nothing.
Use your best judgement to determine if the page is signed in.
`;

    if (config.verification_hint) {
      signInPrompt += `
Signed in verification hint: ${config.verification_hint}
`;
    }

    if (config.account.type === LoginType.PASSWORD) {
      signInPrompt += `
If the page is not signed in, sign in using provided credentials ($username, $password, etc).
`;
    } else {
      const oauth2Account = config.account as OAuth2Account;
      signInPrompt += `
If the page is not signed in, sign in with the OAuth provider "${oauth2Account.provider_name}" using provided credentials
($username, $password), and use $otp_secret_key to generate $otp_code for two-factor authentication. If you can't login with the provided credentials, just stop and report the failure.
`;
    }

    if (config.additional_prompt) {
      signInPrompt += `
Additional instructions: ${config.additional_prompt}
`;
    }

    // Try to login with agent
    try {
      agentLogger.log('Level 3: Attempting agent-based login');
      agentLogger.log(`Login prompt:\n${signInPrompt}`);
      
      // Temporarily switch knowledge retriever to use 'login' scenario
      // Save the original retriever to restore later
      const originalRetriever = (this.agentServices as any).knowledgeRetriever;
      let loginKnowledgeRetrieverSet = false;

      if (this.agentServices.hasKnowledgeRetriever() && originalRetriever) {
        agentLogger.log('Setting up login knowledge retriever...');
        // Create a wrapper that calls the original retriever with usageScenario='login'
        this.agentServices.setKnowledgeRetriever(async (statement: string, threshold?: number, topK?: number, usageScenario?: 'general' | 'login') => {
          // Force usageScenario to 'login' for all knowledge retrievals during login flow
          return await originalRetriever(statement, threshold, topK, 'login');
        });
        loginKnowledgeRetrieverSet = true;
        agentLogger.log('Login knowledge retriever configured');
      }

      // Declare loginResult in outer scope so it can be accessed after the try-finally block
      let loginResult;
      try {
        // Use run() instead of execute() to complete the full login flow (multiple actions)
        loginResult = await this.run(page, signInPrompt, 'login');
        
        if (!loginResult.success) {
          agentLogger.log('Level 3 FAILED: Agent login failed');
          logger.info('Login: Failed');
          return { success: false, page };
        }
      } finally {
        // Restore original knowledge retriever if we changed it
        if (loginKnowledgeRetrieverSet && originalRetriever) {
          this.agentServices.setKnowledgeRetriever(originalRetriever);
          agentLogger.log('Restored original knowledge retriever');
        }
      }

      // Get storage state after successful login
      const storageState = await page.context().storageState();

      // Generate validation locators for future login verification
      // This creates locators that distinguish signed-in from signed-out state
      // Skip if AI verification mode is enabled or num_verification_exprs is explicitly set to 0
      let validationExprs: string[] | undefined;
      if (shouldUseAiVerificationForAlreadyLoggedInCheck) {
        agentLogger.log('Skipping validation locator generation (AI verification mode enabled)');
      } else if (config.num_verification_exprs !== 0) {
        try {
          agentLogger.log('Generating validation locators for future login verification...');
          const generatedLocators = await generateAndValidateLoginLocators(
            page,
            config.site_url,
            {
              verification_hint: config.verification_hint,
              num_verification_exprs: config.num_verification_exprs,
            },
            // AI step callback - use this.run() which is equivalent to old aiStep
            async (p, prompt) => this.run(p, prompt),
            // DOM text callback
            async (p) => this.getDOMText(p)
          );
          if (generatedLocators) {
            validationExprs = generatedLocators;
            agentLogger.log(`Generated ${validationExprs.length} validation locator(s): ${JSON.stringify(validationExprs)}`);
          } else {
            agentLogger.log('Failed to generate validation locators, login will still succeed');
          }
        } catch (error: any) {
          agentLogger.log(`Error generating validation locators: ${error.message}`);
          // Don't fail login if validation locator generation fails
        }
      } else {
        agentLogger.log('Skipping validation locator generation (num_verification_exprs=0)');
      }

      agentLogger.log('Level 3 SUCCESS: Agent login succeeded');
      logger.info('Login: Agent login succeeded');

      // Preserve existing cached actions if Level 3 produced no actions (page was already logged in)
      const newActions = loginResult.actions || [];
      const finalCachedActions = newActions.length > 0 ? newActions : cache?.cached_actions;

      return {
        success: true,
        page,
        storage_state: storageState,
        cached_actions: finalCachedActions,
        validation_exprs: validationExprs,
      };
    } catch (error: any) {
      agentLogger.error(`Agent login failed: ${error.message}`);
      logger.info('Login: Failed');
      return { success: false, page };
    }
  }

  /**
   * Execute cached login actions directly without AI
   * @param page - The page to execute actions on
   * @param actions - Cached action entities from previous successful login
   * @param options - Verification options after action execution
   * @returns Success status
   */
  private async executeCachedLogin(
    page: Page,
    actions: ActionEntity[],
    options?: { validationExprs?: string[]; aiVerificationStatement?: string },
  ): Promise<{ success: boolean }> {
    // Dynamically import ActionHandler to avoid circular dependencies
    const ActionHandlerClass = (await import('../actions/handler')).default;
    const actionHandler = new ActionHandlerClass();

    // Execute each cached action using the action handler (which has legacy aliases)
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      agentLogger.log(
        `Executing cached action ${i + 1}/${actions.length}: ${action.action_description || action.action_data?.action_name}`,
      );

      try {
        if (!action.action_data) {
          agentLogger.log(`Action ${i + 1} missing action_data, skipping`);
          continue;
        }

        // Use actionHandler.execute which supports legacy action names
        // Pass agentServices (not 'this') since IAction.execute expects AgentServices
        await actionHandler.execute(page, action, this.agentServices);

        // Wait for stability after action
        await this.waitUntilStable(page, 5000);
      } catch (error: any) {
        agentLogger.error(`Cached action ${i + 1} failed: ${error.message}`);
        return { success: false };
      }
    }

    if (options?.aiVerificationStatement) {
      agentLogger.log('Verifying cached login result with AI verification statement');
      const isLoggedIn = await this.evaluate(page, options.aiVerificationStatement);
      if (!isLoggedIn) {
        return { success: false };
      }
      return { success: true };
    }

    // Validate login success using validation expressions
    if (options?.validationExprs && options.validationExprs.length > 0) {
      const isLoggedIn = await validateLogin(page, options.validationExprs);
      if (!isLoggedIn) {
        return { success: false };
      }
      return { success: true };
    }

    // Safety: never report cached login success without any verification method
    agentLogger.log('Cached login cannot be verified: missing AI verification statement and validation expressions');
    return { success: false };
  }

  /**
   * Perform an automated username/password login (with optional TOTP 2FA).
   *
   * High-level façade over {@link loginPage}: the agent navigates to
   * `options.url`, finds the login fields, enters the credentials, handles 2FA
   * when `totpSecret` is supplied, and verifies the result.
   *
   * @param page - Playwright page
   * @param options - Login URL, credentials, and optional TOTP secret
   * @returns `true` if login succeeded
   *
   * @example
   * await agent.login(page, {
   *   url: "https://example.com/login",
   *   username: "user@example.com",
   *   password: "secret123",
   *   totpSecret: "JBSWY3DPEHPK3PXP", // optional, for 2FA
   * });
   * await agent.assert(page, "Dashboard is visible");
   */
  async login(page: Page, options: LoginOptions): Promise<boolean> {
    // num_verification_exprs: 0 skips validation-expression generation — not
    // needed for a simple login without auto-login caching.
    const config: LoginConfig = {
      site_url: options.url,
      num_verification_exprs: 0,
      account: {
        type: LoginType.PASSWORD,
        username: options.username,
        password: options.password,
        ...(options.totpSecret && {
          two_factor_auth_config: {
            type: TwoFactorAuthType.TOTP,
            data: options.totpSecret,
          },
        }),
      },
    };

    const result = await this.loginPage(page, config);
    return result.success;
  }

  /**
   * Get completed execution history (excluding current incomplete step)
   */
  private getCompletedExecutionHistory(): Array<[string, string]> {
    if (!this.context.executionHistory || this.context.executionHistory.length === 0) {
      return [];
    }

    const lastEntry = this.context.executionHistory[this.context.executionHistory.length - 1];
    if (!lastEntry[1] || lastEntry[1].trim() === '') {
      return this.context.executionHistory.slice(0, -1);
    }

    return this.context.executionHistory;
  }

  /**
   * Add an entry to execution history
   */
  private addToExecutionHistory(statement: string, feedback: string): void {
    if (!this.context.executionHistory) {
      this.context.executionHistory = [];
    }
    this.context.executionHistory.push([statement, feedback]);
  }

  /** Resolve runtime placeholders once for user-visible step descriptions. */
  private resolveDescription(description: string): string {
    const sensitiveKeys = this.context.variableStore.getAllSensitiveKeys();
    const variables = Object.fromEntries(
      Object.entries(this.context.variableStore.getAll()).filter(
        ([key]) => !sensitiveKeys.has(key.startsWith('$') ? key.slice(1) : key),
      ),
    );
    return replaceVariables(description, variables);
  }

  /**
   * Replace a tracked step's primary screenshot with the page's current state.
   *
   * JS assertions call this from a generated finally block, so the report shows
   * the state the assertion actually observed after it finished. Screenshot
   * collection is reporting-only: failure here must never hide or change the
   * assertion's own result.
   */
  async replaceStepScreenshot(page: Page, stepId: string): Promise<void> {
    const tracking = this.context.stepTracking;
    const result = tracking?.results[stepId];
    if (!tracking?.artifactsDir || !result) return;

    try {
      page = this.agentServices.validatePage(page);
      const stepDir = path.join(tracking.artifactsDir, stepId.replace(/\./g, '-'));
      await fs.promises.mkdir(stepDir, { recursive: true });
      const screenshotPath = result.screenshot ?? path.join(stepDir, 'screenshot.png');
      await page.screenshot({ type: 'png', path: screenshotPath });
      result.screenshot = screenshotPath;
    } catch (error) {
      logger.warn(`replaceStepScreenshot failed for step ${stepId}: ${error}`);
    }
  }

  /**
   * Create step result for tracking
   */
  private async createStepResult(page: Page, stepId: string, description: string, type?: StepType): Promise<void> {
    if (!this.context.stepTracking) return;

    // Non-step entry points (verify, draft, execute, evaluate, etc.) also reach
    // this reporting boundary, so resolve their runtime placeholders here.
    description = this.resolveDescription(description);

    // Don't recreate if already exists
    if (this.context.stepTracking.results[stepId]) {
      return;
    }

    // Set current step ID for console log association
    this.context.stepTracking.currentStepId = stepId;
    // Notify listener of step change (for syncing with TestContext)
    if (this.context.stepTracking.onStepChange) {
      this.context.stepTracking.onStepChange(stepId);
    }

    try {
      page = this.agentServices.validatePage(page);
      await this.waitUntilStable(page);

      const result: StepExecutionResult = {
        description,
        startTime: Date.now(),
        artifacts: [],
        type,
        // Default: use the description as code. agent.step() overwrites this with fn.toString().
        code: description,
      };

      // Take screenshot if artifacts directory configured
      if (this.context.stepTracking.artifactsDir) {
        // Create per-step directory
        const stepDir = path.join(this.context.stepTracking.artifactsDir, stepId.replace(/\./g, '-'));
        fs.mkdirSync(stepDir, { recursive: true });
        const screenshotPath = path.join(stepDir, 'screenshot.png');
        page = this.agentServices.validatePage(page);
        await page.screenshot({ type: 'png', path: screenshotPath });
        result.screenshot = screenshotPath;
      }

      result.contextBefore = this.snapshotVariables();

      this.context.stepTracking.results[stepId] = result;
    } catch (error) {
      logger.warn(`createStepResult failed for step ${stepId}: ${error}`);
      // Ensure results[stepId] always exists so downstream direct property assignments don't throw
      this.context.stepTracking.results[stepId] = {
        description,
        startTime: Date.now(),
        artifacts: [],
        contextBefore: this.snapshotVariables(),
      };
    }
  }

  /**
   * Snapshot the current test variables with sensitive keys masked.
   * Used to capture per-step contextBefore / contextAfter so the report
   * can show how variables evolved across steps.
   */
  private snapshotVariables(): Record<string, unknown> {
    return maskSensitiveVariables(
      this.context.variableStore.getAll(),
      this.context.variableStore.getAllSensitiveKeys(),
    );
  }

  /**
   * Save debug info to local files and return artifact paths
   * Files are saved in the artifacts subdirectory of the screenshot directory
   * @internal
   */
  private saveDebugInfoToFiles(
    stepId: string,
    debugInfo: ActionGenerationDebugInfo,
    model?: string,
    iterationIndex: number = 0,
  ): Record<string, string> {
    const artifacts: Record<string, string> = {};

    if (!this.context.stepTracking?.artifactsDir) {
      logger.debug(`[saveDebugInfoToFiles] No artifacts directory configured, skipping debug info save`);
      return artifacts;
    }

    // Create per-step artifacts directory
    const stepArtifactsDir = path.join(
      this.context.stepTracking.artifactsDir,
      stepId.replace(/\./g, '-'),
    );

    try {
      fs.mkdirSync(stepArtifactsDir, { recursive: true });

      // Save system prompt
      if (debugInfo.systemPrompt) {
        const systemPromptPath = path.join(stepArtifactsDir, `system_prompt_${iterationIndex}.txt`);
        fs.writeFileSync(systemPromptPath, debugInfo.systemPrompt);
        artifacts.system_prompt_path = systemPromptPath;
        logger.debug(`[saveDebugInfoToFiles] Saved system prompt to: ${systemPromptPath}`);
      }

      // Save user prompt (can be string or structured MessageForLogging[])
      if (debugInfo.userPrompt) {
        if (typeof debugInfo.userPrompt === 'string') {
          // Legacy string format
          const userPromptPath = path.join(stepArtifactsDir, `user_prompt_${iterationIndex}.txt`);
          fs.writeFileSync(userPromptPath, debugInfo.userPrompt);
          artifacts.user_prompt_path = userPromptPath;
          logger.debug(`[saveDebugInfoToFiles] Saved user prompt to: ${userPromptPath}`);
        } else {
          // Structured MessageForLogging[] format - save as JSON
          // Strip base64 image data to reduce file size
          const strippedMessages = debugInfo.userPrompt.map((msg: any) => {
            if (Array.isArray(msg.content)) {
              return {
                ...msg,
                content: msg.content.map((part: any) => {
                  if (part.type === 'image' && part.file?.startsWith('data:')) {
                    return { ...part, file: '[base64 image data stripped]' };
                  }
                  return part;
                }),
              };
            }
            return msg;
          });
          const messagesPath = path.join(stepArtifactsDir, `messages_${iterationIndex}.json`);
          const messagesData = {
            system: debugInfo.systemPrompt,
            messages: strippedMessages,
          };
          fs.writeFileSync(messagesPath, JSON.stringify(messagesData, null, 2));
          artifacts.messages_path = messagesPath;
          logger.debug(`[saveDebugInfoToFiles] Saved messages to: ${messagesPath}`);
        }
      }

      // Save raw LLM response
      if (debugInfo.rawLlmResponse) {
        const modelPrefix = model ? model.replace(/[\/\\:]/g, '-') : 'llm';
        const responsePath = path.join(stepArtifactsDir, `${modelPrefix}_response_${iterationIndex}.txt`);
        fs.writeFileSync(responsePath, debugInfo.rawLlmResponse);
        artifacts.response_path = responsePath;
        logger.debug(`[saveDebugInfoToFiles] Saved LLM response to: ${responsePath}`);
      }

      // Save screenshot with SOM annotations (key is screenshot_path to match expected format)
      if (debugInfo.screenshotWithSom) {
        const screenshotPath = path.join(stepArtifactsDir, `screenshot_${iterationIndex}.png`);
        fs.writeFileSync(screenshotPath, Buffer.from(debugInfo.screenshotWithSom, 'base64'));
        artifacts.screenshot_path = screenshotPath;
        logger.debug(`[saveDebugInfoToFiles] Saved SOM screenshot to: ${screenshotPath}`);
      }

      // Save reasoning content if available (for native thinking models)
      if (debugInfo.reasoningContent) {
        const reasoningPath = path.join(stepArtifactsDir, `reasoning_${iterationIndex}.txt`);
        fs.writeFileSync(reasoningPath, debugInfo.reasoningContent);
        artifacts.reasoning_path = reasoningPath;
        logger.debug(`[saveDebugInfoToFiles] Saved reasoning to: ${reasoningPath}`);
      }

      logger.debug(`[saveDebugInfoToFiles] Saved ${Object.keys(artifacts).length} artifacts for step ${stepId}`);
    } catch (error) {
      logger.error(`[saveDebugInfoToFiles] Failed to save debug info for step ${stepId}:`, error);
    }

    return artifacts;
  }

  /**
   * Update step result
   */
  private async updateStepResult(
    stepId: string,
    status?: string,
    message?: any,
    artifacts?: Record<string, string>,
    debugInfo?: ActionGenerationDebugInfo,
  ): Promise<void> {
    if (!this.context.stepTracking) return;

    const result = this.context.stepTracking.results[stepId];
    if (!result) return;

    if (status) {
      result.status = status as StepExecutionResult['status'];
      result.contextAfter = this.snapshotVariables();
      // Clear current step ID when step completes (has a final status)
      this.context.stepTracking.currentStepId = undefined;
      // Notify listener of step change (for syncing with TestContext)
      if (this.context.stepTracking.onStepChange) {
        this.context.stepTracking.onStepChange(undefined);
      }
    }
    if (message !== undefined) {
      result.message = message;
    }
    if (artifacts) {
      result.artifacts.push(artifacts);
    }

    // Save debug info to local files (prompts, responses, screenshots)
    // Note: tokenUsages are NOT stored in step results - they're tracked via intelligentActionDetails
    if (debugInfo) {
      // Save debug artifacts to files; use current artifacts length as iteration index
      // so each iteration's screenshot gets a unique filename (screenshot_0.png, screenshot_1.png, ...)
      const model = debugInfo.tokenUsages?.[0]?.model;
      const iterationIndex = result.artifacts.length;
      const debugArtifacts = this.saveDebugInfoToFiles(stepId, debugInfo, model, iterationIndex);
      if (Object.keys(debugArtifacts).length > 0) {
        result.artifacts.push(debugArtifacts);
      }
    }

    // Auto-calculate duration from startTime
    result.duration = Date.now() - result.startTime;

    // Call callback if provided
    if (this.context.stepTracking.onStepComplete) {
      this.context.stepTracking.onStepComplete(stepId, result);
    }
  }

  /**
   * Write execution results to output directory
   * Writes: test-results.json, token-usages.json, ai-actions.json
   */
  async writeExecutionResults(outputDir: string, options?: { tokenUsages?: boolean }): Promise<void> {
    try {
      // Ensure output directory exists
      await fs.promises.mkdir(outputDir, { recursive: true });

      // Write test-results.json (step tracking results)
      if (this.context.stepTracking?.results && Object.keys(this.context.stepTracking.results).length > 0) {
        const testResultsPath = path.join(outputDir, 'test-results.json');
        await fs.promises.writeFile(testResultsPath, JSON.stringify(this.context.stepTracking.results, null, 2));
        logger.debug(`Test results written to: ${testResultsPath}`);
      }

      // Write token-usages.json if enabled
      if (options?.tokenUsages && this.context.tokenUsages && this.context.tokenUsages.length > 0) {
        const tokenUsagesPath = path.join(outputDir, 'token-usages.json');
        await fs.promises.writeFile(tokenUsagesPath, JSON.stringify(this.context.tokenUsages, null, 2));
        logger.debug(`Token usages written to: ${tokenUsagesPath}`);
      }

      // Write ai-actions.json (per-step LLM call tracking)
      if (this.context.aiActionDetails && this.context.aiActionDetails.length > 0) {
        const aiActionsPath = path.join(outputDir, 'ai-actions.json');
        await fs.promises.writeFile(aiActionsPath, JSON.stringify(this.context.aiActionDetails, null, 2));
        logger.debug(`AI action details written to: ${aiActionsPath}`);
      }
    } catch (error) {
      logger.error('Failed to write execution results:', error);
      throw error;
    }
  }
}
