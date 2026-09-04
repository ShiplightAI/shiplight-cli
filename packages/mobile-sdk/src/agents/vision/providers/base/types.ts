import type {
  GenerateActionOptions as BaseGenerateActionOptions,
  BuildTrajectoryOptions,
} from '../../types';

// Re-export for providers
export type { BuildTrajectoryOptions };
export type GenerateActionOptions = BaseGenerateActionOptions;
