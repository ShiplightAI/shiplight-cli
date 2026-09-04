/**
 * Base Vision Provider
 * Abstract base class for all vision-based AI providers (Gemini, OpenAI, etc.)
 */

import type { AIModelConfig, MobileAgentOutput, Trajectory } from '../../types';
import type { GenerateActionOptions, BuildTrajectoryOptions } from './types';

export abstract class BaseVisionProvider {
  constructor(
    protected platform: 'android' | 'ios',
    protected modelConfig: AIModelConfig
  ) {}

  /**
   * Generate a single action from screenshot and task description
   * Each provider implements this with their own API
   */
  abstract generateAction(options: GenerateActionOptions): Promise<MobileAgentOutput>;

  /**
   * Build trajectory from task execution
   */
  abstract buildTrajectory(options: BuildTrajectoryOptions): Trajectory;

  /**
   * Build system prompt for the provider
   * Some providers use built-in prompts (OpenAI), others need custom prompts (Gemini)
   */
  protected abstract buildSystemPrompt(): string;

  /**
   * Build user prompt for the provider
   */
  protected abstract buildUserPrompt(task: string, deviceInfo: { width: number; height: number }): string;

  /**
   * Translate coordinates from provider's coordinate system to device coordinates
   * - Gemini: 1000x1000 normalized → device size
   * - OpenAI: Native screen coordinates → no translation needed
   */
  protected abstract translateCoordinates(
    args: Record<string, any>,
    deviceInfo: { width: number; height: number }
  ): Record<string, any>;
}
