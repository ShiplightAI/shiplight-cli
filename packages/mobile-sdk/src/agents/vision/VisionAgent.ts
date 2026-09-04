/**
 * Vision Agent - Pure vision-based mobile automation (coordinates)
 *
 * Uses screenshot only (no accessibility tree) with Gemini CUA or OpenAI CUA
 * to generate coordinate-based actions.
 *
 * Coordinates between VisionActionGenerator (AI) and VisionExecutor (device control)
 * to execute multi-step mobile automation tasks.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Device } from '../../devices/common/types';
import { VisionActionGenerator } from './generator';
import { VisionExecutor } from './executor';
import type { AIModelConfig, ExecutionHistoryEntry, TaskStep, MobileAgentOutput, ActionResult, GeneratedAction } from './types';
import { MobileActionType } from './types';
import type { IMobileAgent, GenerateActionStepResult, TaskExecutionResult, TaskExecutionOptions } from '../types';
import type { MobileActionEntity } from '../text-vision/actions';
import type { TaskStepRecord } from '../text-vision/types';

export interface ExecutionState {
  steps: Array<Omit<TaskStep, 'stepNumber'>>;
  executionHistory: ExecutionHistoryEntry[];
  sessionId: string;
  startTime: Date;
}

export interface VisionAgentConfig {
  device: Device;
  modelConfig: AIModelConfig;
  debugDir?: string;
}

/**
 * @deprecated Use VisionAgentConfig instead
 */
export type MobileAgentConfig = VisionAgentConfig;

export class VisionAgent implements IMobileAgent {
  private visionActionGenerator: VisionActionGenerator;
  private actionExecutor: VisionExecutor;
  private config: VisionAgentConfig;
  private shouldStop = false;
  private debugDir: string;
  private sessionDir: string;
  private currentState: ExecutionState | null = null; // Internal state for executeSingleStep
  private lastResult: TaskExecutionResult | null = null;

  constructor(config: VisionAgentConfig) {
    this.config = config;
    this.debugDir = config.debugDir || './logs';

    // Create session directory with timestamp
    // This ensures each session has its own folder and files don't get overwritten
    this.sessionDir = ''; // Will be set when executeSingleStep or executeTask is first called

    const platform = config.device.interfaceType;
    this.visionActionGenerator = new VisionActionGenerator({
      platform,
      modelConfig: config.modelConfig,
    });

    this.actionExecutor = new VisionExecutor(config.device);

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(this.debugDir)) {
      fs.mkdirSync(this.debugDir, { recursive: true });
    }
  }

  /**
   * Setup agent dependencies
   *
   * VisionAgent uses direct ADB - no additional setup needed.
   */
  async setup(): Promise<void> {
    // No-op for VisionAgent - uses direct ADB, no Appium needed
  }

  /**
   * Create or get the session directory for this execution
   */
  private getSessionDir(sessionId: string): string {
    if (!this.sessionDir) {
      // Format: YYYY-MM-DD-HH-MM-SS (filesystem-safe)
      const timestamp = new Date().toISOString()
        .replace(/:/g, '-')
        .replace(/\..+/, '')
        .replace('T', '-');

      this.sessionDir = path.join(this.debugDir, `${timestamp}-${sessionId}`);

      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }
    }
    return this.sessionDir;
  }

  /**
   * Get the vision action generator (for external use)
   */
  getVisionActionGenerator(): VisionActionGenerator {
    return this.visionActionGenerator;
  }

  /**
   * Stop the current task execution
   */
  stop(): void {
    this.shouldStop = true;
    console.log('\n⏹️  Stop requested - will stop after current action completes');
  }

  /**
   * Resize screenshot to match display dimensions
   * OpenAI CUA uses actual image dimensions, so we must resize the screenshot
   * to match the scaled device size we report
   */
  private async resizeScreenshot(base64Screenshot: string, targetWidth: number, targetHeight: number): Promise<string> {
    const sharp = (await import('sharp')).default;

    // Extract base64 data
    const base64Data = base64Screenshot.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Resize image
    const resizedBuffer = await sharp(buffer)
      .resize(targetWidth, targetHeight, {
        fit: 'fill', // Exact dimensions, may distort if aspect ratio differs
      })
      .png()
      .toBuffer();

    // Convert back to base64 data URL
    return `data:image/png;base64,${resizedBuffer.toString('base64')}`;
  }

  /**
   * Extract dimensions from base64 screenshot (for debugging)
   */
  private async getScreenshotDimensions(base64Screenshot: string): Promise<{ width: number; height: number }> {
    // Extract base64 data
    const base64Data = base64Screenshot.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // PNG dimensions are at bytes 16-23 (big-endian)
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);

    return { width, height };
  }

  /**
   * Draw crosshair on screenshot at specified coordinates for visual verification
   */
  private async drawCrosshair(base64Screenshot: string, x: number, y: number, color = '#FF0000'): Promise<string> {
    const sharp = (await import('sharp')).default;

    // Extract base64 data
    const base64Data = base64Screenshot.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Get image dimensions
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;

    // Crosshair parameters
    const crosshairSize = 40; // Length of each line from center
    const lineWidth = 4;

    // Create SVG crosshair overlay
    const svg = `
      <svg width="${width}" height="${height}">
        <!-- Horizontal line -->
        <line x1="${Math.max(0, x - crosshairSize)}" y1="${y}"
              x2="${Math.min(width, x + crosshairSize)}" y2="${y}"
              stroke="${color}" stroke-width="${lineWidth}" />
        <!-- Vertical line -->
        <line x1="${x}" y1="${Math.max(0, y - crosshairSize)}"
              x2="${x}" y2="${Math.min(height, y + crosshairSize)}"
              stroke="${color}" stroke-width="${lineWidth}" />
        <!-- Center dot -->
        <circle cx="${x}" cy="${y}" r="${lineWidth}" fill="${color}" />
        <!-- Coordinate label -->
        <text x="${x + 10}" y="${y - 10}"
              font-family="monospace" font-size="16" font-weight="bold"
              fill="${color}" stroke="white" stroke-width="1" paint-order="stroke">
          (${x}, ${y})
        </text>
      </svg>
    `;

    // Composite SVG onto image
    const modifiedBuffer = await sharp(buffer)
      .composite([
        {
          input: Buffer.from(svg),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();

    // Convert back to base64 data URL
    return `data:image/png;base64,${modifiedBuffer.toString('base64')}`;
  }

  /**
   * Execute an action step
   * Executes the generated action and records the result in the execution state
   * Returns the execution result and whether the task is complete
   */
  async executeActionStep(
    state: ExecutionState,
    statement: string,
    agentOutput: MobileAgentOutput,
    screenshotPath: string,
    onAction?: (action: GeneratedAction) => void
  ): Promise<{ success: boolean; isDone: boolean; doneSuccess?: boolean }> {
    try {
      // Notify about action before execution
      if (onAction) {
        onAction(agentOutput.action);
      }

      // Execute action
      console.log('⚡ Executing action...');
      const result: ActionResult = await this.actionExecutor.execute(agentOutput.action);

      if (!result.success) {
        console.error(`❌ Action failed: ${result.message}`);
      } else {
        console.log(`✅ Action completed in ${result.duration}ms`);
      }

      // Record step and execution history
      // Extract description from action's reasoning field, then remove reasoning from action
      const description = 'reasoning' in agentOutput.action ? agentOutput.action.reasoning : undefined;

      // Remove reasoning from action before storing (it's now in step.description)
      const actionToStore = { ...agentOutput.action };
      if ('reasoning' in actionToStore) {
        delete actionToStore.reasoning;
      }

      // Store screenshot file path instead of base64 data to keep JSON small
      const step: Omit<TaskStep, 'stepNumber'> = {
        action: actionToStore,
        screenshot: screenshotPath, // File path instead of base64 data
        description, // Human-readable description from custom function 'text' parameter
        result,
        timestamp: new Date(),
      };

      state.steps.push(step);
      state.executionHistory.push({
        statement,
        screenshot: screenshotPath, // File path instead of base64 data
        agentOutput,
        result,
        timestamp: new Date(),
      });

      // Check if task is done
      if (agentOutput.action.type === MobileActionType.DONE) {
        const doneParams = agentOutput.action.parameters as any;
        console.log(`\n🏁 Task completed: ${doneParams.text}`);
        console.log(`   Success: ${doneParams.success}`);
        return {
          success: doneParams.success,
          isDone: true,
          doneSuccess: doneParams.success,
        };
      }

      return {
        success: result.success,
        isDone: false,
      };
    } catch (error: any) {
      console.error(`\n❌ Step failed with error: ${error.message}`);
      console.error(error.stack);

      // Record failed step
      state.steps.push({
        action: { type: 'error', parameters: { error: error.message } },
        screenshot: '',
        result: {
          success: false,
          message: error.message,
        },
        timestamp: new Date(),
      });

      return {
        success: false,
        isDone: false,
      };
    }
  }

  /**
   * Execute a single step (IMobileAgent interface)
   *
   * Combines generateActionStep and executeAction into one call.
   * Uses internal state that persists across calls for execution history.
   * Call resetState() to clear the history and start fresh.
   *
   * @param task - The task/statement to execute
   * @returns Whether the step succeeded
   */
  async executeSingleStep(task: string): Promise<boolean> {
    // Initialize internal state if not exists
    if (!this.currentState) {
      this.currentState = {
        sessionId: `session-${Date.now()}`,
        startTime: new Date(),
        steps: [],
        executionHistory: [],
      };
    }

    return this.executeSingleStepWithState(this.currentState, task);
  }

  /**
   * Reset the internal execution state
   *
   * Call this to clear execution history and start fresh.
   * Useful when starting a new task/session.
   */
  resetState(): void {
    this.currentState = null;
    this.lastResult = null;
    this.sessionDir = ''; // Reset session directory too
  }

  /**
   * Get the current internal execution state
   *
   * Returns the state used by executeSingleStep, or null if not initialized.
   */
  getState(): ExecutionState | null {
    return this.currentState;
  }

  /**
   * Get the last execution result
   *
   * Returns the result from the last executeTask or executeSingleStep call.
   * For executeSingleStep, builds result from accumulated internal state.
   */
  getLastResult(): TaskExecutionResult | null {
    // If we have a stored result from executeTask, return it
    if (this.lastResult) {
      return this.lastResult;
    }

    // Build result from internal state (for executeSingleStep)
    if (this.currentState && this.currentState.steps.length > 0) {
      return this.buildResultFromState(this.currentState);
    }

    return null;
  }

  /**
   * Build TaskExecutionResult from ExecutionState
   */
  private buildResultFromState(state: ExecutionState): TaskExecutionResult {
    const steps = state.steps;
    const lastStep = steps[steps.length - 1];
    const success = lastStep?.result?.success ?? false;

    // Convert TaskStep[] to TaskStepRecord[] format
    const stepRecords: TaskStepRecord[] = steps.map((step, index) => ({
      stepNumber: index + 1,
      timestamp: step.timestamp.getTime(),
      duration: 0, // Not tracked in TaskStep
      thinking: step.description,
      goal: step.description || `Step ${index + 1}`,
      actions: [{
        action_data: {
          action_name: step.action.type?.toLowerCase() || 'unknown',
          kwargs: step.action.parameters || {},
        },
        action_description: step.description || '',
      }],
      outcome: {
        success: step.result?.success ?? false,
        error: step.result?.success ? undefined : step.result?.message,
      },
      screenshotBefore: step.screenshot,
    }));

    // Build actions list
    const actions: MobileActionEntity[] = stepRecords.map(r => r.actions[0]);

    return {
      success,
      completed: true,
      trajectory: {
        steps: steps.length,
        actions,
        stepRecords,
      },
      metadata: {
        sessionId: state.sessionId,
        totalSteps: steps.length,
        totalDuration: Date.now() - state.startTime.getTime(),
        model: this.config.modelConfig.model || 'unknown',
        agentType: 'vision',
        successfulSteps: steps.filter(s => s.result?.success).length,
        failedSteps: steps.filter(s => !s.result?.success).length,
      },
      summary: success ? 'Task completed' : 'Task failed',
      error: success ? undefined : lastStep?.result?.message,
    };
  }

  /**
   * Execute a single step with ExecutionState
   * Takes a screenshot, generates an action via AI, and executes it
   * This method combines generateActionStep and executeActionStep
   */
  async executeSingleStepWithState(
    state: ExecutionState,
    statement: string,
    onAction?: (action: GeneratedAction) => void
  ): Promise<boolean> {
    try {
      // Generate action
      const { agentOutput, screenshotPath } = await this.generateActionStepInternal(state, statement);

      // Execute action
      const { success, isDone, doneSuccess } = await this.executeActionStep(state, statement, agentOutput, screenshotPath, onAction);

      if (isDone) {
        return doneSuccess ?? false;
      }

      return success;
    } catch (error: any) {
      console.error(`\n❌ Step failed with error: ${error.message}`);
      console.error(error.stack);

      // Record failed step
      state.steps.push({
        action: { type: 'error', parameters: { error: error.message } },
        screenshot: '',
        result: {
          success: false,
          message: error.message,
        },
        timestamp: new Date(),
      });

      return false;
    }
  }

  /**
   * Execute a complete task with multiple steps (original method with ExecutionState)
   * Continues executing steps until task is complete, max steps reached, or an error occurs
   * Supports event callbacks and abort signals for streaming and cancellation
   *
   * @deprecated Use executeTask(task, options) for IMobileAgent interface compatibility
   */
  async executeTaskWithState(
    state: ExecutionState,
    task: string,
    maxSteps: number = 40,
    options?: {
      onEvent?: (event: { type: string; data?: any }) => void;
      abortSignal?: AbortSignal;
    }
  ): Promise<boolean> {
    console.log(`\n🚀 Starting task execution`);
    console.log(`📝 Task: ${task}`);
    console.log(`🔢 Max steps: ${maxSteps}`);
    console.log(`🆔 Session: ${state.sessionId}`);

    this.shouldStop = false;
    let taskSuccess = false;

    // Send started event
    if (options?.onEvent) {
      options.onEvent({
        type: 'started',
        data: { statement: task },
      });
    }

    try {
      for (let i = 0; i < maxSteps; i++) {
        // Check if stop was requested or aborted
        if (this.shouldStop || options?.abortSignal?.aborted) {
          console.log('\n⏹️  Task execution stopped by user');
          if (options?.onEvent) {
            options.onEvent({
              type: 'aborted',
              data: {
                message: 'Task execution was aborted',
                sessionId: state.sessionId,
              },
            });
          }
          break;
        }

        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`Step ${i + 1}/${maxSteps}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        // Create onAction callback to send Action events
        const onAction = options?.onEvent
          ? (action: GeneratedAction) => {
              // Convert GeneratedAction to ActionEntity format for event
              const actionEntity = {
                action_data: {
                  action_name: action.type,
                  kwargs: action.parameters || {},
                },
                action_description: action.reasoning || `Execute ${action.type}`,
              };
              options.onEvent!({
                type: 'action',
                data: { action_entity: actionEntity },
              });
            }
          : undefined;

        // Execute single step
        const stepSuccess = await this.executeSingleStepWithState(state, task, onAction);

        // Check if this was the final step (DONE action)
        const lastStep = state.steps[state.steps.length - 1];
        if (lastStep.action.type === MobileActionType.DONE) {
          const doneParams = lastStep.action.parameters as any;
          taskSuccess = doneParams.success;
          break;
        }

        // If step failed, stop execution
        if (!stepSuccess) {
          console.log('\n❌ Step failed - stopping task execution');
          taskSuccess = false;
          break;
        }
      }

      // Check if we hit max steps without completion
      const lastStep = state.steps[state.steps.length - 1];
      if (lastStep?.action.type !== MobileActionType.DONE && !this.shouldStop && !options?.abortSignal?.aborted) {
        console.log(`\n⚠️  Reached maximum steps (${maxSteps}) without task completion`);
        taskSuccess = false;
      }

      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Task Summary`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Total steps: ${state.steps.length}`);
      console.log(`Result: ${taskSuccess ? '✅ Success' : '❌ Failed'}`);
      console.log(`Duration: ${((Date.now() - state.startTime.getTime()) / 1000).toFixed(1)}s`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      // Send completion event (testContext should be added by the caller after updating session variables)
      if (options?.onEvent) {
        options.onEvent({
          type: 'completion',
          data: {
            success: taskSuccess,
            details: taskSuccess ? 'Task completed successfully' : 'Task execution failed or incomplete',
          },
        });
      }

      return taskSuccess;
    } catch (error: any) {
      // Send error event
      if (options?.onEvent) {
        options.onEvent({
          type: 'error',
          data: {
            error: error.message || 'Task execution failed',
            sessionId: state.sessionId,
          },
        });
      }

      // Re-throw if it's not an abort error
      if (error.name !== 'AbortError') {
        throw error;
      }

      return false;
    }
  }

  /**
   * Save trajectory to file and display summary
   */
  async saveAndShowTrajectory(state: ExecutionState, taskSuccess?: boolean): Promise<void> {
    console.log('\n💾 Saving trajectory...');

    // Determine success status
    // If taskSuccess is explicitly provided, use it
    // Otherwise, check if last action is DONE with success=true
    let success = false;
    if (taskSuccess !== undefined) {
      success = taskSuccess;
      console.log(`   Success status (from parameter): ${success}`);
    } else if (state.steps.length > 0) {
      const lastStep = state.steps[state.steps.length - 1];
      const isDone = lastStep.action.type === MobileActionType.DONE;
      const doneSuccess = isDone ? (lastStep.action.parameters as any).success : undefined;
      success = isDone && doneSuccess === true;
      console.log(`   Last action type: ${lastStep.action.type}`);
      if (isDone) {
        console.log(`   DONE action success parameter: ${doneSuccess}`);
      }
      console.log(`   Trajectory success: ${success}`);
    }

    // Build trajectory using vision action generator
    const trajectory = this.visionActionGenerator.buildTrajectory({
      steps: state.steps,
      startTime: state.startTime,
      endTime: new Date(),
      success,
    });

    // Save trajectory as JSON in session directory
    const sessionDir = this.getSessionDir(state.sessionId);
    const trajectoryPath = path.join(sessionDir, 'trajectory.json');
    fs.writeFileSync(trajectoryPath, JSON.stringify(trajectory, null, 2));
    console.log(`📁 Trajectory saved: ${trajectoryPath}`);

    // Display summary
    console.log('\n📊 Trajectory Summary:');
    console.log(`   Platform: ${trajectory.metadata.platform}`);
    console.log(`   Model: ${trajectory.metadata.model}`);
    console.log(`   Total steps: ${trajectory.metadata.totalSteps}`);
    console.log(`   Success: ${trajectory.success ? '✅' : '❌'}`);
    console.log(`   Duration: ${((trajectory.metadata.endTime!.getTime() - trajectory.metadata.startTime.getTime()) / 1000).toFixed(1)}s`);

    // Display step-by-step breakdown
    console.log('\n📝 Step Breakdown:');
    trajectory.steps.forEach((step, index) => {
      const status = step.result?.success ? '✅' : '❌';
      const actionType = step.action.type;
      let actionDetail = '';

      // Build action detail string
      if (actionType === MobileActionType.TAP && 'x' in step.action.parameters) {
        actionDetail = ` at (${step.action.parameters.x}, ${step.action.parameters.y})`;
      } else if (actionType === MobileActionType.INPUT) {
        actionDetail = `: "${step.action.parameters.text}"`;
      } else if (actionType === MobileActionType.SWIPE) {
        actionDetail = ` ${step.action.parameters.direction}`;
      } else if (actionType === MobileActionType.SWIPE_POINTS) {
        const params = step.action.parameters as any;
        actionDetail = ` from (${params.from?.x}, ${params.from?.y}) to (${params.to?.x}, ${params.to?.y})`;
      } else if (actionType === MobileActionType.DONE) {
        actionDetail = `: ${step.action.parameters.text || 'Complete'}`;
      }

      // Show description first if available (from custom function 'text' parameter)
      if (step.description) {
        // Truncate long descriptions for display
        const maxLength = 100;
        const displayDescription = step.description.length > maxLength
          ? step.description.substring(0, maxLength) + '...'
          : step.description;
        console.log(`   ${index + 1}. ${status} ${displayDescription}`);
        console.log(`      ${actionType}${actionDetail}`);
      } else {
        console.log(`   ${index + 1}. ${status} ${actionType}${actionDetail}`);
      }
    });

    console.log('\n✨ Trajectory saved successfully!\n');
  }

  // =========================================================================
  // IMobileAgent interface implementation
  // =========================================================================

  /**
   * Generate an action step without executing it (IMobileAgent interface)
   *
   * Note: VisionAgent's generateActionStep requires an ExecutionState.
   * This simplified version creates a temporary state for compatibility.
   */
  async generateActionStep(
    task: string,
    _previousFeedback?: string,
  ): Promise<GenerateActionStepResult> {
    // Create a temporary execution state
    const tempState: ExecutionState = {
      sessionId: `temp-${Date.now()}`,
      startTime: new Date(),
      steps: [],
      executionHistory: [],
    };

    // Use the internal generateActionStep method
    const result = await this.generateActionStepInternal(tempState, task);

    // Convert GeneratedAction to MobileActionEntity format
    const action: MobileActionEntity = {
      action_data: {
        action_name: result.agentOutput.action.type.toLowerCase(),
        kwargs: result.agentOutput.action.parameters || {},
      },
      action_description: result.agentOutput.action_description || task,
    };

    return {
      action,
      screenshot: result.screenshot,
      reasoning: result.agentOutput.memory || result.agentOutput.action_description,
      done: result.agentOutput.action.type === MobileActionType.DONE,
    };
  }

  /**
   * Execute a generated action (IMobileAgent interface)
   */
  async executeAction(action: MobileActionEntity): Promise<ActionResult> {
    // Convert MobileActionEntity back to GeneratedAction format
    const generatedAction: GeneratedAction = {
      type: action.action_data.action_name.toUpperCase() as MobileActionType,
      parameters: action.action_data.kwargs || {},
      reasoning: action.action_description,
    };

    return this.actionExecutor.execute(generatedAction);
  }

  /**
   * Execute a complete task (IMobileAgent interface)
   */
  async executeTask(
    task: string,
    options?: TaskExecutionOptions,
  ): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    const maxSteps = options?.maxSteps || 40;

    // Create execution state
    const state: ExecutionState = {
      sessionId: `session-${Date.now()}`,
      startTime: new Date(),
      steps: [],
      executionHistory: [],
    };

    // Use the internal executeTask method
    const success = await this.executeTaskInternal(state, task, maxSteps, {
      onEvent: options?.onEvent ? (event) => {
        // Convert internal events to TaskExecutionEvent format
        if (event.type === 'action') {
          // Send action_entity directly (matches TextVisionAgent format)
          options.onEvent?.({ type: 'action', action: event.data.action_entity, step: state.steps.length });
        } else if (event.type === 'completion') {
          options.onEvent?.({ type: 'complete', totalSteps: state.steps.length, duration: Date.now() - startTime });
        }
      } : undefined,
      abortSignal: options?.abortSignal,
    });

    const totalDuration = Date.now() - startTime;

    return {
      success,
      completed: true,
      trajectory: {
        steps: state.steps.length,
        actions: state.steps.map(s => ({
          action_data: {
            action_name: s.action.type.toLowerCase(),
            kwargs: s.action.parameters || {},
          },
          action_description: s.description || '',
        })),
        stepRecords: state.steps.map((s, i) => ({
          stepNumber: i + 1,
          timestamp: s.timestamp.getTime(),
          duration: s.result?.duration || 0,
          goal: s.description || '',
          actions: [{
            action_data: {
              action_name: s.action.type.toLowerCase(),
              kwargs: s.action.parameters || {},
            },
            action_description: s.description || '',
          }],
          outcome: {
            success: s.result?.success || false,
            error: s.result?.success ? undefined : s.result?.message,
          },
        })),
      },
      metadata: {
        sessionId: state.sessionId,
        totalSteps: state.steps.length,
        totalDuration,
        model: this.config.modelConfig.model,
        agentType: 'vision',
        successfulSteps: state.steps.filter(s => s.result?.success).length,
        failedSteps: state.steps.filter(s => !s.result?.success).length,
      },
      summary: success ? 'Task completed successfully' : 'Task failed',
      error: success ? undefined : 'Task did not complete successfully',
    };
  }

  /**
   * Cleanup resources (IMobileAgent interface)
   */
  async cleanup(): Promise<void> {
    // Stop any ongoing execution
    this.stop();

    // Disconnect device
    if (this.config.device && typeof this.config.device.destroy === 'function') {
      await this.config.device.destroy();
    }
  }

  /**
   * Take a screenshot of the current screen (IMobileAgent interface)
   *
   * Returns base64-encoded PNG image data.
   * This is a lightweight operation that doesn't invoke the LLM.
   */
  async screenshot(): Promise<string> {
    return this.config.device.screenshotBase64();
  }

  /**
   * @deprecated Use cleanup() instead
   */
  async disconnect(): Promise<void> {
    return this.cleanup();
  }

  /**
   * Internal method to generate an action step with ExecutionState
   * Takes a screenshot, generates an action via AI, and saves debug information
   * Returns the generated action output and screenshot paths
   */
  private async generateActionStepInternal(
    state: ExecutionState,
    statement: string,
  ): Promise<{
    agentOutput: MobileAgentOutput;
    screenshotPath: string;
    resizedPath: string;
    screenshot: string;
    resizedScreenshot: string;
    deviceSize: { width: number; height: number; dpr: number };
  }> {
    console.log(`\n📋 Step ${state.steps.length + 1}: ${statement}`);

    // 1. Take screenshot
    console.log('📸 Taking screenshot...');
    const screenshot = await this.config.device.screenshotBase64();

    // Get session directory and step number
    const sessionDir = this.getSessionDir(state.sessionId);
    const stepNum = state.steps.length + 1;
    const screenshotPath = path.join(sessionDir, `step-${stepNum}-before.png`);
    const resizedPath = path.join(sessionDir, `step-${stepNum}-resized.png`);

    // 2. Get device info
    const deviceSize = await this.config.device.size();
    const capabilities = this.config.device.actionSpace();

    // 3. Resize screenshot to match the scaled device size
    // OpenAI CUA uses actual image dimensions, so we must resize the image
    // to match the display size we report, otherwise coordinates will be wrong
    console.log(`📐 Device size (scaled): ${deviceSize.width}x${deviceSize.height} (DPR: ${deviceSize.dpr})`);
    const resizedScreenshot = await this.resizeScreenshot(screenshot, deviceSize.width, deviceSize.height);

    // Log the actual resized screenshot dimensions
    const resizedDims = await this.getScreenshotDimensions(resizedScreenshot);
    console.log(`📐 Resized screenshot: ${resizedDims.width}x${resizedDims.height}`);

    // 4. Generate action via AI
    console.log(`🤖 Generating action via AI (display_width: ${deviceSize.width}, display_height: ${deviceSize.height})...`);

    // Save prompt to file for debugging
    const promptLogPath = path.join(sessionDir, `step-${stepNum}-prompt.txt`);
    const promptLog = `TASK: ${statement}

DEVICE INFO:
- Display size: ${deviceSize.width}x${deviceSize.height}
- DPR: ${deviceSize.dpr}
- Platform: ${this.config.device.interfaceType}

SCREENSHOT: step-${stepNum}-resized.png (sent to AI)

CAPABILITIES: ${JSON.stringify(capabilities, null, 2)}
`;
    fs.writeFileSync(promptLogPath, promptLog);
    console.log(`📝 Prompt logged: ${promptLogPath}`);

    const agentOutput: MobileAgentOutput = await this.visionActionGenerator.generateAction({
      statement,
      screenshot: resizedScreenshot, // Pass resized screenshot to AI
      capabilities,
      // Don't pass executionHistory with screenshots to save tokens - AI doesn't need full history
      executionHistory: undefined,
      deviceInfo: {
        width: deviceSize.width,
        height: deviceSize.height,
        dpr: deviceSize.dpr,
      },
    });

    console.log(`💭 AI reasoning: ${agentOutput.memory || agentOutput.screen_vision_description}`);
    console.log(`🎯 Action: ${agentOutput.action.type}`);

    // Show action description if available
    if ('reasoning' in agentOutput.action && agentOutput.action.reasoning) {
      console.log(`   📝 ${agentOutput.action.reasoning}`);
    }

    // Save AI response to file for debugging
    const responseLogPath = path.join(sessionDir, `step-${stepNum}-response.json`);
    fs.writeFileSync(responseLogPath, JSON.stringify(agentOutput, null, 2));
    console.log(`📝 Response logged: ${responseLogPath}`);

    // Draw crosshairs and save screenshots for actions with coordinates
    if (agentOutput.action.type === MobileActionType.TAP && 'x' in agentOutput.action.parameters) {
      const x = agentOutput.action.parameters.x;
      const y = agentOutput.action.parameters.y;
      console.log(`   📍 Coordinates: (${x}, ${y})`);

      // Draw crosshair on resized screenshot (AI coordinates) and save
      const resizedWithCrosshair = await this.drawCrosshair(resizedScreenshot, x, y, '#FF0000');
      const resizedBase64 = resizedWithCrosshair.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(resizedPath, resizedBase64, 'base64');
      console.log(`💾 Resized screenshot (with crosshair) saved: ${resizedPath}`);

      // Draw crosshair on original screenshot (native coordinates after scaling) and save
      const dpr = deviceSize.dpr || 1;
      const nativeX = Math.round(x * dpr);
      const nativeY = Math.round(y * dpr);
      const originalWithCrosshair = await this.drawCrosshair(screenshot, nativeX, nativeY, '#00FF00');
      const originalBase64 = originalWithCrosshair.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(screenshotPath, originalBase64, 'base64');
      console.log(`💾 Original screenshot (with crosshair) saved: ${screenshotPath}`);
    } else if (agentOutput.action.type === MobileActionType.DOUBLE_TAP && 'x' in agentOutput.action.parameters) {
      const x = agentOutput.action.parameters.x;
      const y = agentOutput.action.parameters.y;
      console.log(`   📍 Coordinates: (${x}, ${y})`);

      // Draw crosshair on resized screenshot (AI coordinates) and save
      const resizedWithCrosshair = await this.drawCrosshair(resizedScreenshot, x, y, '#FF0000');
      const resizedBase64 = resizedWithCrosshair.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(resizedPath, resizedBase64, 'base64');
      console.log(`💾 Resized screenshot (with crosshair) saved: ${resizedPath}`);

      // Draw crosshair on original screenshot (native coordinates after scaling) and save
      const dpr = deviceSize.dpr || 1;
      const nativeX = Math.round(x * dpr);
      const nativeY = Math.round(y * dpr);
      const originalWithCrosshair = await this.drawCrosshair(screenshot, nativeX, nativeY, '#00FF00');
      const originalBase64 = originalWithCrosshair.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(screenshotPath, originalBase64, 'base64');
      console.log(`💾 Original screenshot (with crosshair) saved: ${screenshotPath}`);
    } else if (agentOutput.action.type === MobileActionType.LONG_PRESS && 'x' in agentOutput.action.parameters) {
      const x = agentOutput.action.parameters.x;
      const y = agentOutput.action.parameters.y;
      console.log(`   📍 Coordinates: (${x}, ${y})`);

      // Draw crosshair on resized screenshot (AI coordinates) and save
      const resizedWithCrosshair = await this.drawCrosshair(resizedScreenshot, x, y, '#FF0000');
      const resizedBase64 = resizedWithCrosshair.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(resizedPath, resizedBase64, 'base64');
      console.log(`💾 Resized screenshot (with crosshair) saved: ${resizedPath}`);

      // Draw crosshair on original screenshot (native coordinates after scaling) and save
      const dpr = deviceSize.dpr || 1;
      const nativeX = Math.round(x * dpr);
      const nativeY = Math.round(y * dpr);
      const originalWithCrosshair = await this.drawCrosshair(screenshot, nativeX, nativeY, '#00FF00');
      const originalBase64 = originalWithCrosshair.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(screenshotPath, originalBase64, 'base64');
      console.log(`💾 Original screenshot (with crosshair) saved: ${screenshotPath}`);
    } else if (agentOutput.action.type === MobileActionType.SWIPE_POINTS) {
      const params = agentOutput.action.parameters as any;
      console.log(`   📍 From: (${params.from.x}, ${params.from.y}) To: (${params.to.x}, ${params.to.y})`);

      // Draw crosshairs on resized screenshot (AI coordinates) - from point in red, to point in blue
      let resizedWithCrosshair = await this.drawCrosshair(resizedScreenshot, params.from.x, params.from.y, '#FF0000');
      resizedWithCrosshair = await this.drawCrosshair(resizedWithCrosshair, params.to.x, params.to.y, '#0000FF');
      const resizedBase64 = resizedWithCrosshair.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(resizedPath, resizedBase64, 'base64');
      console.log(`💾 Resized screenshot (with crosshair) saved: ${resizedPath}`);

      // Draw crosshairs on original screenshot (native coordinates after scaling)
      const dpr = deviceSize.dpr || 1;
      const nativeFromX = Math.round(params.from.x * dpr);
      const nativeFromY = Math.round(params.from.y * dpr);
      const nativeToX = Math.round(params.to.x * dpr);
      const nativeToY = Math.round(params.to.y * dpr);
      let originalWithCrosshair = await this.drawCrosshair(screenshot, nativeFromX, nativeFromY, '#00FF00');
      originalWithCrosshair = await this.drawCrosshair(originalWithCrosshair, nativeToX, nativeToY, '#00FFFF');
      const originalBase64 = originalWithCrosshair.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(screenshotPath, originalBase64, 'base64');
      console.log(`💾 Original screenshot (with crosshair) saved: ${screenshotPath}`);
    } else if (agentOutput.action.type === MobileActionType.INPUT) {
      console.log(`   ⌨️  Text: "${agentOutput.action.parameters.text}"`);

      // No crosshair for input actions, save screenshots without modification
      const resizedBase64 = resizedScreenshot.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(resizedPath, resizedBase64, 'base64');
      console.log(`💾 Resized screenshot saved: ${resizedPath}`);

      const originalBase64 = screenshot.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(screenshotPath, originalBase64, 'base64');
      console.log(`💾 Original screenshot saved: ${screenshotPath}`);
    } else {
      // For other actions without coordinates, save screenshots without modification
      const resizedBase64 = resizedScreenshot.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(resizedPath, resizedBase64, 'base64');
      console.log(`💾 Resized screenshot saved: ${resizedPath}`);

      const originalBase64 = screenshot.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(screenshotPath, originalBase64, 'base64');
      console.log(`💾 Original screenshot saved: ${screenshotPath}`);
    }

    return {
      agentOutput,
      screenshotPath,
      resizedPath,
      screenshot,
      resizedScreenshot,
      deviceSize: {
        width: deviceSize.width,
        height: deviceSize.height,
        dpr: deviceSize.dpr || 1,
      },
    };
  }

  /**
   * Internal helper for executeTask (keeps original signature for backward compat)
   */
  private async executeTaskInternal(
    state: ExecutionState,
    statement: string,
    maxSteps: number,
    options?: { onEvent?: (event: any) => void; abortSignal?: AbortSignal },
  ): Promise<boolean> {
    // Delegate to the original executeTask method
    return this.executeTaskWithState(state, statement, maxSteps, options);
  }
}

/**
 * @deprecated Use VisionAgent instead. MobileAgent is an alias for backward compatibility.
 */
export const MobileAgent = VisionAgent;
export type MobileAgent = VisionAgent;
