/**
 * AgentContext - Core context for AI agent operations
 * This is framework-agnostic and can be used outside of Playwright tests
 */

import { WebAgentContext } from './types';
import type { VariableStore } from 'shiplight-types';

/**
 * Generate a timestamp string in datetime format (America/Los_Angeles timezone)
 * Format: "YYYY-MM-DDTHH:MM:SS.mmm±HH:MM"
 * Example: "2025-11-03T19:55:37.128-08:00"
 */
function getCurrentTimeStamp(): string {
  const now = new Date();

  // Get time parts in America/Los_Angeles timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  const day = parts.find(p => p.type === 'day')!.value;
  const hour = parts.find(p => p.type === 'hour')!.value;
  const minute = parts.find(p => p.type === 'minute')!.value;
  const second = parts.find(p => p.type === 'second')!.value;
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

  // Calculate timezone offset for America/Los_Angeles
  const laTimeStr = `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}`;
  const utcTimeStr = now.toISOString().slice(0, -1); // Remove 'Z'

  const laAsUtc = Date.parse(laTimeStr + 'Z');
  const actualUtc = Date.parse(utcTimeStr + 'Z');
  const offsetMinutes = Math.round((actualUtc - laAsUtc) / (1000 * 60));

  const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
  const offsetMins = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
  const offsetSign = offsetMinutes <= 0 ? '+' : '-';

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}${offsetSign}${offsetHours}:${offsetMins}`;
}

/**
 * Options for creating an AgentContext
 */
export interface AgentContextOptions {
  model?: string;  // LLM model to use for AI operations (optional - only needed for AI-powered actions)
  fallbackModels?: string[];  // Ordered fallback models tried on availability failure of the primary
  computer_use_model?: string;  // LLM model to use for computer use operations (optional - defaults to model if not set)
  computer_use_fallback_models?: string[];  // Ordered fallback computer-use models tried on availability failure of the primary CUA model
  variableStore: VariableStore;  // Shared variable store (required - must be shared with TestContext)
  organizationId?: string;
  organizationSettings?: Record<string, any>;
  executionHistory?: Array<[string, string]>;
  testDataDir?: string;
  downloadDir?: string;
  useNativeGenerator?: boolean;
  autoDismissModal?: boolean;  // Auto-dismiss modal dialogs (cookie consent, popups) before self-healing
}

/**
 * Create a new AgentContext
 *
 * WebAgentContext is internal - access variables via context.variableStore
 */
export function createAgentContext(options: AgentContextOptions): WebAgentContext {
  const variableStore = options.variableStore;

  // Initialize currentTime in the shared variable store if not already set
  if (!variableStore.has('currentTime')) {
    variableStore.set('currentTime', getCurrentTimeStamp());
  }

  return {
    // LLM model
    model: options.model,
    fallbackModels: options.fallbackModels,
    computer_use_model: options.computer_use_model,
    computer_use_fallback_models: options.computer_use_fallback_models,

    // Shared variable storage
    variableStore,

    // Configuration
    organizationId: options.organizationId,
    organizationSettings: options.organizationSettings,
    executionHistory: options.executionHistory || [],
    testDataDir: options.testDataDir,
    downloadDir: options.downloadDir,
    useNativeGenerator: options.useNativeGenerator,
    autoDismissModal: options.autoDismissModal,

    // Initialize execution state
    tokenUsages: [],
    aiActionDetails: [],
  };
}
