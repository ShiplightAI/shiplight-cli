/**
 * Mobile SDK Configuration
 *
 * Centralized configuration for the Mobile SDK.
 * Similar pattern to web-sdk's SdkConfig.
 */

import { TextVisionAgent, type TextVisionAgentConfig } from './agents/text-vision';
import { VisionAgent, type VisionAgentConfig } from './agents/vision';
import type { RetryConfig } from './agents/text-vision';
import type { IMobileAgent } from './agents/types';
import type { Device } from './devices/common/types';
import { AndroidDevice } from './devices/android/device';

/**
 * Supported AI providers
 */
export type AIProvider = 'gemini' | 'openai' | 'anthropic';

/**
 * Agent type selection
 */
export type AgentType = 'vision' | 'text-vision';

/**
 * Mobile SDK Configuration
 *
 * Note: Vertex AI is handled transparently by the providers.
 * Set these environment variables for Vertex AI:
 * - GOOGLE_GENAI_USE_VERTEXAI=True
 * - GOOGLE_CLOUD_PROJECT=your-project
 * - GOOGLE_CLOUD_LOCATION=us-central1
 */
export interface MobileSdkConfig {
  /** Agent type: 'vision' (pure vision with ADB) or 'text-vision' (element tree + Appium) */
  agentType: AgentType;

  /** AI provider to use (default: gemini) */
  provider: AIProvider;

  /** Model name override (uses provider default if not set) */
  model?: string;

  /** Temperature for AI generation (default: 0.1) */
  temperature?: number;

  /** Appium server host (default: localhost) - only for text-vision agent */
  appiumHost: string;

  /** Appium server port (default: 4723) - only for text-vision agent */
  appiumPort: number;

  /** Android device ID/serial (required for Android) */
  androidDeviceId?: string;

  /** iOS device UDID (required for iOS) */
  iosDeviceId?: string;

  /** Don't reset app state between sessions (default: true) */
  noReset: boolean;

  /** Maximum steps per task (default: 15) */
  maxStepsPerTask: number;

  /** Retry configuration - only for text-vision agent */
  retryConfig: RetryConfig;

  /** Debug mode - logs more information */
  debug: boolean;

  /** Debug directory for logs and screenshots - only for vision agent */
  debugDir?: string;

  /** Path to write agent execution logs (prompts, LLM responses, token usage) */
  agentLogPath?: string;

  /**
   * Internal environment variables (API keys, secrets, etc.)
   * Allows passing API keys via env map instead of apiKey field.
   */
  env?: Record<string, string>;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: MobileSdkConfig = {
  agentType: 'text-vision',
  provider: 'gemini',
  appiumHost: 'localhost',
  appiumPort: 4723,
  noReset: true,
  maxStepsPerTask: 30,
  retryConfig: {
    maxRetries: 1,
    retryDelayMs: 500,
  },
  debug: false,
  debugDir: './logs',
};

/**
 * Mobile SDK Config Manager (singleton)
 */
class MobileSdkConfigManager {
  private config: MobileSdkConfig;

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Get current configuration
   */
  getConfig(): MobileSdkConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (partial update)
   */
  updateConfig(updates: Partial<MobileSdkConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    };
  }

  /**
   * Reset configuration to defaults
   */
  resetConfig(): void {
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Get specific config value
   */
  get<K extends keyof MobileSdkConfig>(key: K): MobileSdkConfig[K] {
    return this.config[key];
  }

  /**
   * Set specific config value
   */
  set<K extends keyof MobileSdkConfig>(key: K, value: MobileSdkConfig[K]): void {
    this.config[key] = value;
  }
}

// Export singleton instance
const mobileSdkConfig = new MobileSdkConfigManager();
export default mobileSdkConfig;

/**
 * Configure the Mobile SDK
 * @param config - Partial configuration to update
 */
export function configureMobileSdk(config: Partial<MobileSdkConfig>): void {
  mobileSdkConfig.updateConfig(config);
}

/**
 * Get Mobile SDK configuration
 */
export function getMobileSdkConfig(): MobileSdkConfig {
  return mobileSdkConfig.getConfig();
}


/**
 * Initialize options for createAgent
 */
export interface InitializeAgentOptions {
  /** Override device ID (uses config value if not set) */
  deviceId?: string;

  /** Pre-connected device instance (for VisionAgent) */
  device?: Device;

  /** Override config values */
  config?: Partial<MobileSdkConfig>;
}

/**
 * Initialize a mobile agent using the current SDK configuration
 *
 * Creates either a VisionAgent or TextVisionAgent based on config.agentType:
 * - 'vision': Pure vision agent using ADB directly (requires device or deviceId)
 * - 'text-vision': Text+vision agent using Appium (requires deviceId and Appium server)
 *
 * This is the recommended way to create an agent. It handles:
 * - API key resolution from config, env map, or process.env
 * - Default model selection based on provider
 * - Device/Appium configuration
 *
 * @param options - Optional overrides
 * @returns Configured IMobileAgent (VisionAgent or TextVisionAgent)
 *
 * @example
 * ```typescript
 * // TextVisionAgent (default)
 * configureMobileSdk({
 *   agentType: 'text-vision',
 *   provider: 'gemini',
 *   androidDeviceId: 'emulator-5554',
 * });
 * const agent = initializeAgent();
 *
 * // VisionAgent
 * configureMobileSdk({
 *   agentType: 'vision',
 *   provider: 'gemini',
 *   androidDeviceId: 'emulator-5554',
 * });
 * const agent = initializeAgent();
 * ```
 */
export async function initializeAgent(options: InitializeAgentOptions = {}): Promise<IMobileAgent> {
  // Get current config and merge with options
  const config = {
    ...getMobileSdkConfig(),
    ...options.config,
  };

  // Resolve device ID
  const deviceId = options.deviceId || config.androidDeviceId || config.iosDeviceId;
  if (!deviceId && !options.device) {
    throw new Error(
      'Device ID is required. Set androidDeviceId or iosDeviceId in config, or pass deviceId/device in options.'
    );
  }

  if (config.agentType === 'vision') {
    // VisionAgent - uses direct ADB
    return initializeVisionAgent(config, deviceId, options.device);
  } else {
    // TextVisionAgent - uses Appium
    return initializeTextVisionAgent(config, deviceId!);
  }
}

/**
 * Initialize a VisionAgent
 *
 * Note: Vertex AI and API key handling is done transparently by the provider.
 * The provider reads from SDK config.env or process.env.
 */
async function initializeVisionAgent(
  config: MobileSdkConfig,
  deviceId?: string,
  providedDevice?: Device,
): Promise<IMobileAgent> {
  // Use provided device or create new AndroidDevice
  let device: Device;
  if (providedDevice) {
    device = providedDevice;
  } else if (deviceId) {
    device = new AndroidDevice(deviceId);
    await device.connect();
  } else {
    throw new Error('Device ID or device instance is required for VisionAgent');
  }

  const agentConfig: VisionAgentConfig = {
    device,
    modelConfig: {
      provider: config.provider,
      model: config.model || getDefaultModelForVision(config.provider),
      temperature: config.temperature ?? 0.1,
    },
    debugDir: config.debugDir,
  };

  return new VisionAgent(agentConfig);
}

/**
 * Get default model for VisionAgent (uses computer-use models)
 */
function getDefaultModelForVision(provider: AIProvider): string {
  switch (provider) {
    case 'gemini':
      return 'gemini-2.5-computer-use-preview-10-2025';
    case 'openai':
      return 'computer-use-preview';
    case 'anthropic':
      return 'claude-3-5-sonnet-20241022';
    default:
      return 'gemini-2.5-computer-use-preview-10-2025';
  }
}

/**
 * Initialize a TextVisionAgent
 *
 * Note: Vertex AI and API key handling is done transparently by llmProvider.
 * The provider reads from SDK config.env or process.env.
 */
function initializeTextVisionAgent(
  config: MobileSdkConfig,
  deviceId: string,
): IMobileAgent {
  const agentConfig: TextVisionAgentConfig = {
    geminiConfig: {
      model: config.model,
      temperature: config.temperature,
    },
    appiumConfig: {
      udid: deviceId,
      host: config.appiumHost,
      port: config.appiumPort,
      noReset: config.noReset,
    },
    retryConfig: config.retryConfig,
    maxStepsPerTask: config.maxStepsPerTask,
    debug: config.debug,
  };

  return new TextVisionAgent(agentConfig);
}
