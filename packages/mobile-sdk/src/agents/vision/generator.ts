/**
 * Vision Action Generator - Factory for AI providers
 *
 * Creates the appropriate vision provider based on model config
 * and delegates action generation to that provider.
 */

import { BaseVisionProvider } from './providers/base/BaseVisionProvider';
import { OpenAIVisionProvider } from './providers/openai/OpenAIVisionProvider';
import { GeminiVisionProvider } from './providers/gemini/GeminiVisionProvider';
import type { AIModelConfig, MobileAgentOutput, Trajectory } from './types';
import type { GenerateActionOptions, BuildTrajectoryOptions } from './providers/base/types';

export class VisionActionGenerator {
  private provider: BaseVisionProvider;

  constructor(config: { platform: 'android' | 'ios'; modelConfig: AIModelConfig }) {
    // Create provider based on config
    switch (config.modelConfig.provider) {
      case 'gemini':
        this.provider = new GeminiVisionProvider(config.platform, config.modelConfig);
        break;

      case 'openai':
        this.provider = new OpenAIVisionProvider(config.platform, config.modelConfig);
        break;

      default:
        throw new Error(
          `Unsupported AI provider: ${config.modelConfig.provider}. ` +
          'Supported providers: gemini, openai'
        );
    }
  }

  /**
   * Generate action using the configured provider
   */
  async generateAction(options: GenerateActionOptions): Promise<MobileAgentOutput> {
    return this.provider.generateAction(options);
  }

  /**
   * Build trajectory using the configured provider
   */
  buildTrajectory(options: BuildTrajectoryOptions): Trajectory {
    return this.provider.buildTrajectory(options);
  }
}
