/**
 * Text + Vision Agent
 *
 * Uses screenshot + accessibility tree (element tree) with Gemini
 * to generate selector-based actions for reliable mobile automation.
 *
 * Uses Appium for both action execution AND element tree extraction
 * to avoid UIAutomator conflicts.
 */

import { nanoid } from 'nanoid';
import { exec, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { GeminiProProvider, type GeminiProConfig } from './provider';
import { TextVisionExecutor, type AppiumConfig, DEFAULT_RETRY_CONFIG, type RetryConfig } from './executor';
import { ActionHandler, type MobileActionEntity, type ActionResult } from './actions';
import { GeminiVisionProvider } from '../vision/providers/gemini/GeminiVisionProvider';
import type { MobileAgentOutput } from '../vision/types';
import { MobileAgentServices } from './mobileAgentServices';
import { parsePageSourceToTreeString } from '../../elements/parsePageSource';
import { createLogger } from '../../utils/logger';
import type { IMobileAgent, GenerateActionStepResult, StepTrackingConfig } from '../types';
import type {
  TaskExecutionResult,
  TaskExecutionTrajectory,
  TaskStepRecord,
  TaskExecutionMetadata,
  TaskExecutionOptions,
  TaskExecutionEvent,
} from './types';

const execAsync = promisify(exec);

const log = createLogger('TextVisionAgent');

// Re-export types for convenience
export type {
  TaskExecutionResult,
  TaskExecutionTrajectory,
  TaskStepRecord,
  TaskExecutionMetadata,
  TaskExecutionOptions,
  TaskExecutionEvent,
} from './types';

/**
 * Configuration for TextVisionAgent
 */
export interface TextVisionAgentConfig {
  /** Gemini Pro configuration */
  geminiConfig: GeminiProConfig;

  /** Appium configuration */
  appiumConfig: AppiumConfig;

  /** Retry configuration */
  retryConfig?: RetryConfig;

  /** Maximum steps per task (default: 15) */
  maxStepsPerTask?: number;

  /** Debug mode - logs more information */
  debug?: boolean;

  /** Step tracking configuration for artifacts */
  stepTracking?: StepTrackingConfig;
}

/**
 * TextVisionAgent - Uses text (element tree) + vision (screenshot) for automation
 *
 * Implements IMobileAgent interface for interoperability with other mobile agents.
 */
export class TextVisionAgent implements IMobileAgent {
  private provider: GeminiProProvider;
  private executor: TextVisionExecutor;
  private actionHandler: ActionHandler;
  private services: MobileAgentServices | null = null;
  private retryConfig: RetryConfig;
  private maxStepsPerTask: number;
  private model: string;
  private appiumConfig: AppiumConfig;
  private appiumProcess?: ChildProcess;
  private lastResult: TaskExecutionResult | null = null;
  private stepTracking?: StepTrackingConfig;
  private visionProvider?: GeminiVisionProvider;

  constructor(config: TextVisionAgentConfig) {
    this.provider = new GeminiProProvider(config.geminiConfig);
    this.executor = new TextVisionExecutor(config.appiumConfig);
    this.actionHandler = new ActionHandler();
    this.appiumConfig = config.appiumConfig;
    this.retryConfig = config.retryConfig ?? DEFAULT_RETRY_CONFIG;
    this.maxStepsPerTask = config.maxStepsPerTask ?? 40;
    this.model = config.geminiConfig.model ?? 'gemini-3-flash-preview';
    this.stepTracking = config.stepTracking;
  }

  /**
   * Set step tracking configuration
   */
  setStepTracking(config: StepTrackingConfig): void {
    this.stepTracking = config;
  }

  /**
   * Get the vision provider for coordinate-based fallback
   * Uses Gemini Computer Use (gemini-2.5-computer-use-preview-10-2025) which is
   * specifically trained for coordinate-based vision tasks with 1000x1000 normalized coordinates
   */
  private getVisionProvider(): GeminiVisionProvider {
    if (!this.visionProvider) {
      this.visionProvider = new GeminiVisionProvider('android', {
        provider: 'gemini',
        model: 'gemini-2.5-computer-use-preview-10-2025',
      });
    }
    return this.visionProvider;
  }

  /**
   * Setup agent dependencies - starts Appium server and connects
   *
   * Call this before first use to ensure Appium is ready and connected.
   */
  async setup(): Promise<void> {
    log.info('Setting up TextVisionAgent...');
    await this.ensureAppiumRunning();

    // Connect to Appium eagerly (instead of waiting for first command)
    await this.executor.connect();

    // Create services with the connected driver and provider
    this.services = new MobileAgentServices(this.executor.getDriver(), this.provider);

    log.info('Setup complete');
  }

  /**
   * Check if Appium server is running
   */
  private async isAppiumRunning(): Promise<boolean> {
    const host = this.appiumConfig.host ?? 'localhost';
    const port = this.appiumConfig.port ?? 4723;
    try {
      const { stdout } = await execAsync(`curl -s http://${host}:${port}/status`);
      const status = JSON.parse(stdout);
      return status.value?.ready === true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure Appium is running (start if needed)
   */
  private async ensureAppiumRunning(): Promise<void> {
    const host = this.appiumConfig.host ?? 'localhost';
    const port = this.appiumConfig.port ?? 4723;

    log.debug(`Checking Appium at ${host}:${port}...`);

    if (await this.isAppiumRunning()) {
      log.info(`Appium already running at ${host}:${port}`);
      return;
    }

    log.info('Starting Appium server...');

    // Find appium command
    try {
      await execAsync('which appium');
    } catch {
      throw new Error(
        'Appium not found. Please install it:\n' +
        '  npm install -g appium\n' +
        '  appium driver install uiautomator2'
      );
    }

    // Start Appium in background
    this.appiumProcess = spawn('appium', ['-p', String(port)], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.appiumProcess.on('error', (err) => {
      log.error(`Failed to start Appium: ${err.message}`);
    });

    // Wait for Appium to be ready (up to 30 seconds)
    for (let i = 0; i < 30; i++) {
      if (await this.isAppiumRunning()) {
        log.info(`Appium server started at ${host}:${port}`);
        return;
      }
      await this.sleep(1000);
    }

    throw new Error(
      'Appium server failed to start within 30 seconds.\n' +
      'Please install Appium:\n' +
      '  npm install -g appium\n' +
      '  appium driver install uiautomator2'
    );
  }

  /**
   * Connect to Appium (handles both actions and element tree via UIAutomator2)
   * @deprecated Connection is now automatic. This method is kept for backward compatibility.
   */
  async connect(): Promise<void> {
    // Connection is now lazy - happens automatically on first command
    log.debug('Connect called (connection will happen automatically on first command)');
  }

  /**
   * Cleanup resources - disconnect from Appium and stop server if we started it
   */
  async cleanup(): Promise<void> {
    log.info('Cleaning up...');
    await this.executor.disconnect();
    this.services = null;

    // Stop Appium if we started it
    if (this.appiumProcess) {
      log.info('Stopping Appium server...');
      this.appiumProcess.kill();
      this.appiumProcess = undefined;
    }

    log.info('Cleanup complete');
  }

  /**
   * Set variables for substitution in actions
   */
  setVariables(variables: Map<string, string>): void {
    if (!this.services) {
      throw new Error('Services not initialized. Call setup() first.');
    }
    this.services.setVariables(variables);
  }

  /**
   * Set a single variable
   */
  setVariable(key: string, value: string): void {
    if (!this.services) {
      throw new Error('Services not initialized. Call setup() first.');
    }
    this.services.setVariable(key, value);
  }

  /**
   * Generate an action step without executing it
   *
   * Takes a screenshot, gets the element tree, and generates an action via AI.
   * Useful for previewing what the agent would do without actually doing it.
   *
   * @param task - The task/statement to generate action for
   * @param previousFeedback - Optional feedback from previous action (for retry context)
   * @returns Generated action, screenshot, element tree, and reasoning
   */
  async generateActionStep(
    task: string,
    previousFeedback?: string,
  ): Promise<GenerateActionStepResult> {
    log.info(`Generating action for: ${task}`);

    // Take screenshot
    log.debug('Taking screenshot...');
    const screenshot = await this.executor.screenshot();

    // Get element tree from Appium
    log.debug('Getting element tree...');
    const pageSource = await this.executor.getPageSource();
    const elementTree = parsePageSourceToTreeString(pageSource);
    log.debug(`Found ${elementTree.split('\n').length} elements`);

    // Generate action via AI
    log.debug('Generating action...');
    const generateResult = await this.provider.generateAction({
      task,
      screenshot,
      elementTree,
      previousFeedback,
    });

    const action = generateResult.action;

    // Log action info
    const actionInfo = action.locator
      ? `${action.action_data.action_name} (${action.locator})`
      : action.action_data.action_name;
    log.info(`Generated action: ${actionInfo}`);

    if (generateResult.reasoning) {
      log.info(`Reasoning: ${generateResult.reasoning}`);
    }

    return {
      action,
      screenshot,
      elementTree,
      reasoning: generateResult.reasoning,
      done: generateResult.done,
    };
  }

  /**
   * Execute a generated action
   *
   * Use this after generateActionStep to execute the action.
   *
   * @param action - The action to execute
   * @returns Action result (success/failure)
   */
  async executeAction(action: MobileActionEntity): Promise<ActionResult> {
    if (!this.services) {
      throw new Error('Services not initialized. Call setup() first.');
    }
    log.info(`Executing action: ${action.action_data.action_name}`);
    const driver = this.executor.getDriver();
    return this.actionHandler.execute(driver, action, this.services);
  }

  /**
   * Execute a single step (generate + execute one action)
   *
   * Combines generateActionStep and executeAction into one call.
   * Useful for step-by-step execution with manual control.
   *
   * @param task - The task/statement to execute
   * @returns Whether the step succeeded
   */
  async executeSingleStep(task: string): Promise<boolean> {
    log.info(`Executing single step: ${task}`);

    try {
      // Generate action
      const stepResult = await this.generateActionStep(task);
      const action = stepResult.action;

      // Check if it's a "done" action (no execution needed)
      if (action.action_data.action_name === 'done') {
        const success = action.action_data.kwargs?.success ?? false;
        log.info(`Task completed: ${action.action_data.kwargs?.message || 'Done'}`);
        return success;
      }

      // Execute action
      const result = await this.executeAction(action);

      if (result.success) {
        log.info(`Step succeeded: ${result.message}`);
      } else {
        log.warn(`Step failed: ${result.error}`);
      }

      return result.success;
    } catch (error: any) {
      log.error(`Step error: ${error.message}`);
      return false;
    }
  }

  /**
   * Execute a task
   */
  async executeTask(
    task: string,
    options?: TaskExecutionOptions,
  ): Promise<TaskExecutionResult> {
    const sessionId = nanoid(8);
    const startTime = Date.now();
    const stepRecords: TaskStepRecord[] = [];
    const actions: MobileActionEntity[] = [];
    const maxSteps = options?.maxSteps ?? this.maxStepsPerTask;
    const onEvent = options?.onEvent;

    log.info(`Max steps: ${maxSteps}`);

    // Emit start event
    await onEvent?.({ type: 'start', task, maxSteps });

    // Reset conversation for new task
    this.provider.resetConversation();

    let completed = false;
    let success = false;
    let message = '';
    let successfulSteps = 0;
    let failedSteps = 0;

    for (let stepNum = 1; stepNum <= maxSteps && !completed; stepNum++) {
      log.info(`--- Step ${stepNum}/${maxSteps} ---`);

      // Check abort signal
      if (options?.abortSignal?.aborted) {
        message = 'Task aborted';
        break;
      }

      await onEvent?.({ type: 'step_start', step: stepNum });
      const stepStartTime = Date.now();

      const stepRecord = await this.executeStep(task, stepNum, stepRecords, onEvent);
      stepRecords.push(stepRecord);
      actions.push(...stepRecord.actions);

      const stepDuration = Date.now() - stepStartTime;
      await onEvent?.({ type: 'step_complete', step: stepNum, duration: stepDuration });

      // Track success/failure
      if (stepRecord.outcome.success) {
        successfulSteps++;
      } else {
        failedSteps++;
      }

      // Check if task is done
      const lastAction = stepRecord.actions[stepRecord.actions.length - 1];
      if (lastAction?.action_data.action_name === 'done') {
        completed = true;
        success = lastAction.action_data.kwargs?.success ?? false;
        message = lastAction.action_data.kwargs?.message ?? 'Task completed';
        log.info(`Task completed: ${message} (success: ${success})`);
      }

      // Check if step failed
      if (!stepRecord.outcome.success) {
        log.warn(`Step failed: ${stepRecord.outcome.error}`);
        // Continue - AI will see the error as feedback and try different approach
      }
    }

    if (!completed) {
      message = `Max steps (${maxSteps}) reached without completion`;
      log.warn(message);
    }

    const totalDuration = Date.now() - startTime;

    log.debug(`Task finished: ${success ? 'SUCCESS' : 'FAILED'}`);
    log.debug(`Total steps: ${stepRecords.length}`);
    log.debug(`Duration: ${totalDuration}ms`);

    // Emit complete event
    await onEvent?.({ type: 'complete', totalSteps: stepRecords.length, duration: totalDuration });

    // Build result
    const trajectory: TaskExecutionTrajectory = {
      steps: stepRecords.length,
      actions,
      stepRecords,
    };

    const metadata: TaskExecutionMetadata = {
      sessionId,
      totalSteps: stepRecords.length,
      totalDuration,
      model: this.model,
      agentType: 'text-vision',
      successfulSteps,
      failedSteps,
    };

    const result: TaskExecutionResult = {
      success,
      completed,
      trajectory,
      metadata,
      summary: message,
      error: success ? undefined : message,
    };

    // Store for getLastResult()
    this.lastResult = result;

    return result;
  }

  /**
   * Execute a single step with retry logic
   *
   * On first attempt: Uses text-based locator approach (GeminiProProvider with element tree)
   * On retry: Uses Gemini Computer Use (GeminiVisionProvider) for coordinate-based fallback
   */
  private async executeStep(
    task: string,
    stepNumber: number,
    previousSteps: TaskStepRecord[],
    onEvent?: (event: TaskExecutionEvent) => void | Promise<void>,
  ): Promise<TaskStepRecord> {
    let lastError: string | undefined;
    let attempts = 0;
    const stepStartTime = Date.now();

    while (attempts <= this.retryConfig.maxRetries) {
      attempts++;

      // Use Gemini Computer Use on retry (when locator-based approach failed)
      const useVisionFallback = attempts > 1;

      if (useVisionFallback) {
        log.info(`Attempt ${attempts}/${this.retryConfig.maxRetries + 1} (Gemini Computer Use fallback - coordinate-based)`);
      }

      // Take screenshot
      log.debug('Taking screenshot...');
      const screenshot = await this.executor.screenshot();

      // Get screen dimensions (needed for vision fallback coordinate translation)
      const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const metadata = await sharp(imageBuffer).metadata();
      const screenWidth = metadata.width || 1080;
      const screenHeight = metadata.height || 1920;

      let action: MobileActionEntity;
      let reasoning: string | undefined;
      let done = false;
      let debugInfo: any;

      if (useVisionFallback) {
        // Use Gemini Computer Use for coordinate-based fallback
        log.debug(`Screen dimensions: ${screenWidth} x ${screenHeight}`);
        log.debug('Using Gemini Computer Use for coordinate-based action...');

        const visionProvider = this.getVisionProvider();
        const taskWithError = lastError
          ? `${task}\n\nPrevious attempt failed: ${lastError}\nPlease try a different approach.`
          : task;

        const visionResult = await visionProvider.generateAction({
          statement: taskWithError,
          screenshot,
          deviceInfo: { width: screenWidth, height: screenHeight },
          capabilities: [], // Not needed for Gemini Computer Use
        });

        // Convert GeneratedAction to MobileActionEntity
        // Use action_description from vision result (LLM-generated human-readable description)
        action = this.convertVisionActionToEntity(visionResult.action, visionResult.action_description);
        reasoning = ('reasoning' in visionResult.action ? visionResult.action.reasoning : undefined) || visionResult.screen_vision_description;
        done = visionResult.action.type === 'done';

        // Build debug info for vision fallback
        debugInfo = {
          systemPrompt: '(Gemini Computer Use - system prompt embedded in provider)',
          userPrompt: taskWithError,
          rawResponse: JSON.stringify(visionResult, null, 2),
          model: 'gemini-2.5-computer-use-preview-10-2025',
        };
      } else {
        // First attempt: use text-based locator approach
        log.debug('Getting element tree...');
        const pageSource = await this.executor.getPageSource();
        const elementTreeString = parsePageSourceToTreeString(pageSource);
        log.debug(`Found ${elementTreeString.split('\n').length} elements`);

        // Generate action
        log.debug('Generating action...');
        const generateResult = await this.provider.generateAction({
          task,
          screenshot,
          elementTree: elementTreeString,
          previousFeedback: lastError,
        });

        action = generateResult.action;
        reasoning = generateResult.reasoning;
        done = generateResult.done;
        debugInfo = generateResult.debugInfo;
      }

      // Save step artifacts if step tracking is enabled (pass action for coordinate visualization)
      const artifactDir = await this.saveStepArtifacts(stepNumber, attempts, screenshot, action, debugInfo);

      // Log reasoning first, then action
      if (reasoning) {
        log.info(`Reasoning: ${reasoning}`);
        await onEvent?.({ type: 'thinking', text: reasoning });
      }

      log.info(`Generated action: ${JSON.stringify(action, null, 2)}`);

      // Execute action
      log.debug('Executing action...');
      const driver = this.executor.getDriver();
      const result = await this.actionHandler.execute(driver, action, this.services!);

      if (result.success) {
        log.info(`Action succeeded: ${result.message}`);
        // Emit action event ONLY after successful execution
        // This ensures frontend only records actions that actually succeeded
        await onEvent?.({ type: 'action', action, step: stepNumber });

        // Wait for UI to settle after action (animations, rendering, etc.)
        await this.sleep(500);

        return {
          stepNumber,
          timestamp: stepStartTime,
          duration: Date.now() - stepStartTime,
          thinking: reasoning,
          goal: action.action_description,
          actions: [action],
          outcome: {
            success: true,
          },
          screenshotBefore: screenshot,
        };
      }

      // Action failed
      lastError = result.error;
      log.warn(`Action failed: ${result.error}`);

      // Rename artifact folder to mark as failed (so it's not overwritten on retry)
      if (artifactDir) {
        this.renameArtifactDirAsFailed(artifactDir, attempts);
      }

      // If this was a "done" action that failed to parse, don't retry
      if (done) {
        return {
          stepNumber,
          timestamp: stepStartTime,
          duration: Date.now() - stepStartTime,
          thinking: reasoning,
          goal: action.action_description,
          actions: [action],
          outcome: {
            success: false,
            error: result.error,
          },
          screenshotBefore: screenshot,
        };
      }

      // Wait before retry
      if (attempts <= this.retryConfig.maxRetries) {
        log.debug(`Waiting ${this.retryConfig.retryDelayMs}ms before retry...`);
        await this.sleep(this.retryConfig.retryDelayMs);
      }
    }

    // All retries exhausted
    const failedAction: MobileActionEntity = {
      action_data: {
        action_name: 'done',
        kwargs: { success: false, message: `Failed after ${attempts} attempts: ${lastError}` },
      },
      action_description: 'Step failed after retries',
    };

    return {
      stepNumber,
      timestamp: stepStartTime,
      duration: Date.now() - stepStartTime,
      goal: 'Step failed after retries',
      actions: [failedAction],
      outcome: {
        success: false,
        error: `Failed after ${attempts} attempts: ${lastError}`,
      },
    };
  }

  /**
   * Convert GeneratedAction from GeminiVisionProvider to MobileActionEntity
   *
   * GeminiVisionProvider uses normalized 1000x1000 coordinates but translates them
   * to device coordinates internally. The action types map as follows:
   *
   * Vision Action Type -> MobileActionEntity action_name
   * - tap -> tap_coordinates (x, y)
   * - scroll -> scroll (from_x, from_y, to_x, to_y)
   * - swipe_points -> swipe_coordinates (from_x, from_y, to_x, to_y)
   * - input -> input_text (text)
   * - back -> back
   * - home -> home
   * - wait -> wait (seconds)
   * - done -> done (success, message)
   *
   * @param visionAction - The action from the vision provider
   * @param actionDescription - LLM-generated human-readable description from MobileAgentOutput
   */
  private convertVisionActionToEntity(
    visionAction: MobileAgentOutput['action'],
    actionDescription: string,
  ): MobileActionEntity {
    const { type, parameters } = visionAction;

    // Map vision action types to text-vision action names
    switch (type) {
      case 'tap':
        return {
          action_data: {
            action_name: 'tap_coordinates',
            kwargs: { x: parameters.x, y: parameters.y },
          },
          action_description: actionDescription,
        };

      case 'scroll':
        return {
          action_data: {
            action_name: 'scroll',
            kwargs: {
              from_x: parameters.from?.x,
              from_y: parameters.from?.y,
              to_x: parameters.to?.x,
              to_y: parameters.to?.y,
            },
          },
          action_description: actionDescription,
        };

      case 'swipe_points':
        return {
          action_data: {
            action_name: 'swipe_coordinates',
            kwargs: {
              from_x: parameters.from?.x,
              from_y: parameters.from?.y,
              to_x: parameters.to?.x,
              to_y: parameters.to?.y,
            },
          },
          action_description: actionDescription,
        };

      case 'input':
        return {
          action_data: {
            action_name: 'input_text',
            kwargs: { text: parameters.text },
          },
          action_description: actionDescription,
        };

      case 'back':
        return {
          action_data: {
            action_name: 'back',
            kwargs: {},
          },
          action_description: actionDescription,
        };

      case 'home':
        return {
          action_data: {
            action_name: 'home',
            kwargs: {},
          },
          action_description: actionDescription,
        };

      case 'wait':
        return {
          action_data: {
            action_name: 'wait',
            kwargs: { seconds: parameters.seconds || 1 },
          },
          action_description: actionDescription,
        };

      case 'done':
        return {
          action_data: {
            action_name: 'done',
            kwargs: {
              success: parameters.success ?? true,
              message: parameters.text || 'Task complete',
            },
          },
          action_description: actionDescription,
        };

      default:
        // Unknown action type - pass through as-is
        log.warn(`Unknown vision action type: ${type}, passing through as-is`);
        return {
          action_data: {
            action_name: type as string,
            kwargs: parameters,
          },
          action_description: actionDescription,
        };
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Save step artifacts (screenshot, LLM prompts/response)
   * Similar to web-sdk's saveDebugInfoToFiles
   * @returns The artifact directory path, or undefined if not saved
   */
  private async saveStepArtifacts(
    stepNumber: number,
    attemptNumber: number,
    screenshot: string,
    action?: MobileActionEntity,
    debugInfo?: {
      systemPrompt: string;
      userPrompt: string;
      rawResponse: string;
      model: string;
    },
  ): Promise<string | undefined> {
    if (!this.stepTracking?.artifactsDir) {
      return undefined;
    }

    const stepDir = path.join(this.stepTracking.artifactsDir, `step-${stepNumber}`);

    try {
      fs.mkdirSync(stepDir, { recursive: true });

      // Save screenshot (convert base64 to binary)
      const screenshotPath = path.join(stepDir, 'screenshot.png');
      // Remove data URL prefix if present
      const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // Draw crosshairs for coordinate-based actions
      const annotatedBuffer = await this.annotateScreenshotWithCoordinates(imageBuffer, action);
      fs.writeFileSync(screenshotPath, annotatedBuffer);

      // Save LLM debug info
      if (debugInfo) {
        // Save system prompt
        const systemPromptPath = path.join(stepDir, 'system_prompt.txt');
        fs.writeFileSync(systemPromptPath, debugInfo.systemPrompt);

        // Save user prompt
        const userPromptPath = path.join(stepDir, 'user_prompt.txt');
        fs.writeFileSync(userPromptPath, debugInfo.userPrompt);

        // Save response
        const responsePath = path.join(stepDir, `${debugInfo.model}_response.txt`);
        fs.writeFileSync(responsePath, debugInfo.rawResponse);
      }

      log.debug(`Saved artifacts for step ${stepNumber} (attempt ${attemptNumber}) to ${stepDir}`);
      return stepDir;
    } catch (error: any) {
      log.warn(`Failed to save step artifacts: ${error.message}`);
      return undefined;
    }
  }

  /**
   * Annotate screenshot with crosshairs for coordinate-based actions
   */
  private async annotateScreenshotWithCoordinates(
    imageBuffer: Buffer,
    action?: MobileActionEntity,
  ): Promise<Buffer> {
    if (!action) {
      return imageBuffer;
    }

    const actionName = action.action_data.action_name;
    const kwargs = action.action_data.kwargs || {};

    // Extract coordinates based on action type
    const points: Array<{ x: number; y: number; color: string; label?: string }> = [];

    if (actionName === 'tap_coordinates' && kwargs.x !== undefined && kwargs.y !== undefined) {
      points.push({ x: kwargs.x, y: kwargs.y, color: 'red', label: 'tap' });
    } else if (actionName === 'scroll') {
      if (kwargs.from_x !== undefined && kwargs.from_y !== undefined) {
        points.push({ x: kwargs.from_x, y: kwargs.from_y, color: 'green', label: 'from' });
      }
      if (kwargs.to_x !== undefined && kwargs.to_y !== undefined) {
        points.push({ x: kwargs.to_x, y: kwargs.to_y, color: 'red', label: 'to' });
      }
    }

    if (points.length === 0) {
      return imageBuffer;
    }

    // Get image dimensions
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width || 1080;
    const height = metadata.height || 1920;

    // Create SVG overlay with crosshairs
    const crosshairSize = 30;
    const svgParts: string[] = [];

    for (const point of points) {
      const { x, y, color } = point;
      // Crosshair lines
      svgParts.push(`<line x1="${x - crosshairSize}" y1="${y}" x2="${x + crosshairSize}" y2="${y}" stroke="${color}" stroke-width="3"/>`);
      svgParts.push(`<line x1="${x}" y1="${y - crosshairSize}" x2="${x}" y2="${y + crosshairSize}" stroke="${color}" stroke-width="3"/>`);
      // Circle
      svgParts.push(`<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="${color}" stroke-width="3"/>`);
    }

    // Draw line between points for scroll action
    if (actionName === 'scroll' && points.length === 2) {
      svgParts.push(`<line x1="${points[0].x}" y1="${points[0].y}" x2="${points[1].x}" y2="${points[1].y}" stroke="blue" stroke-width="2" stroke-dasharray="10,5"/>`);
      // Arrow head at destination
      const angle = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);
      const arrowSize = 15;
      const ax1 = points[1].x - arrowSize * Math.cos(angle - Math.PI / 6);
      const ay1 = points[1].y - arrowSize * Math.sin(angle - Math.PI / 6);
      const ax2 = points[1].x - arrowSize * Math.cos(angle + Math.PI / 6);
      const ay2 = points[1].y - arrowSize * Math.sin(angle + Math.PI / 6);
      svgParts.push(`<polygon points="${points[1].x},${points[1].y} ${ax1},${ay1} ${ax2},${ay2}" fill="blue"/>`);
    }

    const svgOverlay = `<svg width="${width}" height="${height}">${svgParts.join('')}</svg>`;

    // Composite the overlay onto the image
    const annotatedBuffer = await sharp(imageBuffer)
      .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
      .png()
      .toBuffer();

    return annotatedBuffer;
  }

  /**
   * Rename artifact directory to mark as failed attempt
   */
  private renameArtifactDirAsFailed(artifactDir: string, attemptNumber: number): void {
    try {
      const failedDir = `${artifactDir}-failed-attempt-${attemptNumber}`;
      if (fs.existsSync(artifactDir)) {
        fs.renameSync(artifactDir, failedDir);
        log.debug(`Renamed failed artifact dir to ${failedDir}`);
      }
    } catch (error: any) {
      log.warn(`Failed to rename artifact dir: ${error.message}`);
    }
  }

  /**
   * Take a screenshot of the current screen
   *
   * Returns base64-encoded PNG image data.
   * This is a lightweight operation that doesn't invoke the LLM.
   */
  async screenshot(): Promise<string> {
    return this.executor.screenshot();
  }

  /**
   * Get the underlying executor (for advanced use cases)
   */
  getExecutor(): TextVisionExecutor {
    return this.executor;
  }

  /**
   * Get the underlying provider (for advanced use cases)
   */
  getProvider(): GeminiProProvider {
    return this.provider;
  }

  /**
   * Reset internal execution state
   *
   * Clears conversation history to start fresh.
   */
  resetState(): void {
    this.provider.resetConversation();
    this.lastResult = null;
    log.info('State reset - conversation history cleared');
  }

  /**
   * Get the last execution result
   *
   * Returns the result from the last executeTask or executeSingleStep call.
   */
  getLastResult(): TaskExecutionResult | null {
    return this.lastResult;
  }
}
