/**
 * SDK Configuration
 *
 * Centralized configuration for the SDK.
 * Config must be set programmatically using configureSdk().
 */

import { LogLevel } from './utils/logLevel';

/**
 * Default wall-clock ceiling for one LLM call. See SdkConfig.llmCallTimeoutMs.
 *
 * Sized against the retry budget, not a single request. The ceiling covers the
 * whole call, and the AI SDK retries *inside* it (`maxRetries` defaults to 2,
 * so three attempts plus backoff share the budget). Observed agent statements
 * have taken up to ~98s end to end, so a ceiling near that would abort healthy
 * work as soon as one transient retry occurred.
 *
 * 5 minutes leaves roughly 3x headroom over the slowest observed statement
 * while still cutting the pathological case — a 25m31s stall against a gateway
 * returning 504s — by 5x. Erring high is deliberate: a false abort breaks a
 * working run, whereas a slightly longer stall only costs time.
 */
export const DEFAULT_LLM_CALL_TIMEOUT_MS = 300_000;

export interface SdkConfig {
  /** Log level for SDK operations */
  logLevel: LogLevel;
  /** Enable debug mode for agent operations */
  debugAgent: boolean;
  /** Path to write test results JSON */
  testResultsJsonPath?: string;
  /** Path to write console logs */
  consoleLogsPath?: string;
  /** Path to write agent execution logs (prompts, LLM thinking, internal state) */
  agentLogPath?: string;
  /** Route all log output to stderr (for stdio-based MCP servers) */
  stderrOnly?: boolean;
  /**
   * Wall-clock ceiling for a single LLM call, in milliseconds.
   *
   * This bounds the whole `generateText`/`generateObject` call — every retry
   * attempt and the backoff between them — not one HTTP request. Without it a
   * degraded provider has no upper bound: one call once spent 25m31s across 5
   * attempts against a gateway returning 504s, which is slow responses plus
   * exponential backoff rather than a hung socket, so a transport timeout
   * would not have caught it.
   *
   * Note this is a budget for the *call*, not per attempt — the AI SDK's
   * retries and backoff all draw from it, so it must be several times the
   * duration of a single healthy generation.
   *
   * Set to 0 to disable the ceiling.
   *
   * @default 300000 (5 minutes)
   */
  llmCallTimeoutMs?: number;
  /**
   * Internal environment variables (API keys, secrets, etc.)
   * Not accessible via process.env in test code.
   * Use getSdkConfig().env?.KEY_NAME to access.
   */
  env?: Record<string, string>;
}

class SdkConfigManager {
  private config: SdkConfig;

  constructor() {
    // Initialize with defaults
    this.config = this.getDefaultConfig();
  }

  private getDefaultConfig(): SdkConfig {
    return {
      logLevel: LogLevel.INFO,
      debugAgent: false,
      testResultsJsonPath: undefined,
      consoleLogsPath: undefined,
      llmCallTimeoutMs: DEFAULT_LLM_CALL_TIMEOUT_MS,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): SdkConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (partial update)
   */
  updateConfig(updates: Partial<SdkConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    };
  }

  /**
   * Reset configuration to defaults
   */
  resetConfig(): void {
    this.config = this.getDefaultConfig();
  }

  /**
   * Get specific config value
   */
  get<K extends keyof SdkConfig>(key: K): SdkConfig[K] {
    return this.config[key];
  }

  /**
   * Set specific config value
   */
  set<K extends keyof SdkConfig>(key: K, value: SdkConfig[K]): void {
    this.config[key] = value;
  }
}

// Export singleton instance
const sdkConfig = new SdkConfigManager();
export default sdkConfig;

/**
 * Configure the SDK
 * @param config - Partial configuration to update
 */
export function configureSdk(config: Partial<SdkConfig>): void {
  sdkConfig.updateConfig(config);
}

/**
 * Get SDK configuration
 */
export function getSdkConfig(): SdkConfig {
  return sdkConfig.getConfig();
}

/**
 * Parse SDK_LOG_LEVEL into a LogLevel.
 * Accepts: debug, info, warn, error, silent (case-insensitive).
 * Returns undefined if unset or unrecognized (caller keeps its default).
 *
 * Reads from the host-supplied env map, never `process.env` (FR-010): the CLI
 * and MCP server each own an allowlist, and reading ambient environment here
 * would make those allowlists unenforceable. Callers that run before
 * `configureSdk()` pass the map explicitly.
 */
export function parseSdkLogLevelFromEnv(
  env?: Record<string, string | undefined>,
): LogLevel | undefined {
  const source = env ?? sdkConfig.getConfig().env;
  const raw = source?.SDK_LOG_LEVEL?.toLowerCase();
  switch (raw) {
    case 'debug': return LogLevel.DEBUG;
    case 'info': return LogLevel.INFO;
    case 'warn': return LogLevel.WARN;
    case 'error': return LogLevel.ERROR;
    case 'silent': return LogLevel.SILENT;
    default: return undefined;
  }
}
