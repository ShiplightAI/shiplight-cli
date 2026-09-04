/**
 * Agent Logger
 *
 * Logs agent execution details (prompts, LLM responses, token usage) to a file.
 * These logs are separate from the console logger to provide detailed debug info.
 *
 * Similar interface to web-sdk's agentLogger for consistency.
 */

import { appendFileSync } from 'fs';
import { getMobileSdkConfig } from '../config';

class AgentLogger {
  private initialized = false;

  /**
   * Initialize the log file (only on first call, appends session header)
   */
  init(): void {
    if (this.initialized) {
      return;
    }

    const logPath = getMobileSdkConfig().agentLogPath;
    if (logPath) {
      try {
        appendFileSync(logPath, `\n${'='.repeat(80)}\nMobile Agent Execution Log\nStarted: ${new Date().toISOString()}\n${'='.repeat(80)}\n\n`);
        this.initialized = true;
      } catch (error) {
        console.error(`[AgentLogger] Failed to initialize log file: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Log a message to the agent log file
   */
  log(message: string): void {
    const logPath = getMobileSdkConfig().agentLogPath;
    if (!logPath) return;

    if (!this.initialized) {
      this.init();
    }

    try {
      const timestamp = new Date().toISOString();
      appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    } catch (error) {
      // Silently fail - don't disrupt execution
    }
  }

  /**
   * Log a section header
   */
  section(title: string): void {
    this.log(`\n${'─'.repeat(60)}\n${title}\n${'─'.repeat(60)}`);
  }

  /**
   * Log step information
   */
  step(stepNumber: number, maxSteps: number, info: {
    task?: string;
    thinking?: string;
    goal?: string;
    action?: string;
    locator?: string;
  }): void {
    this.section(`Step ${stepNumber}/${maxSteps}`);
    if (info.task) this.log(`Task: ${info.task}`);
    if (info.thinking) this.log(`Thinking: ${info.thinking}`);
    if (info.goal) this.log(`Goal: ${info.goal}`);
    if (info.action) this.log(`Action: ${info.action}`);
    if (info.locator) this.log(`Locator: ${info.locator}`);
  }

  /**
   * Log LLM call details
   * Handles both OpenAI format (promptTokens/completionTokens) and Gemini format (inputTokens/outputTokens)
   */
  llmCall(model: string, duration: number, usage?: {
    promptTokens?: number;
    completionTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }): void {
    this.log(`LLM Call: ${model}`);
    this.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
    if (usage) {
      const prompt = usage.promptTokens || usage.inputTokens || 0;
      const completion = usage.completionTokens || usage.outputTokens || 0;
      const total = usage.totalTokens || (prompt + completion);
      this.log(`Tokens: ${prompt} prompt + ${completion} completion = ${total} total`);
    }
  }

  /**
   * Log prompts sent to LLM
   */
  prompt(systemPrompt: string, userPrompt: string): void {
    this.section('LLM Prompt');
    this.log(`System Prompt:\n${systemPrompt}`);
    this.log(`\nUser Prompt:\n${userPrompt}`);
  }

  /**
   * Log LLM response
   */
  response(text: string): void {
    this.log(`LLM Response:\n${text}`);
  }

  /**
   * Log parsed action from LLM response
   */
  action(actionName: string, locator?: string, kwargs?: Record<string, any>): void {
    this.log(`Parsed Action: ${actionName}`);
    if (locator) this.log(`  Locator: ${locator}`);
    if (kwargs && Object.keys(kwargs).length > 0) {
      this.log(`  Kwargs: ${JSON.stringify(kwargs)}`);
    }
  }

  /**
   * Log element tree summary
   */
  elementTree(elementCount: number, treePreview?: string): void {
    this.log(`Element Tree: ${elementCount} elements`);
    if (treePreview) {
      this.log(`Preview:\n${treePreview}`);
    }
  }

  /**
   * Log an error
   */
  error(message: string, error?: Error): void {
    this.log(`ERROR: ${message}`);
    if (error) {
      this.log(`Error details: ${error.message}`);
      if (error.stack) {
        this.log(`Stack: ${error.stack}`);
      }
    }
  }

  /**
   * Log action result
   */
  actionResult(success: boolean, message?: string): void {
    this.log(`Result: ${success ? 'SUCCESS' : 'FAILED'}${message ? ` - ${message}` : ''}`);
  }

  /**
   * Check if logging is enabled
   */
  isEnabled(): boolean {
    return !!getMobileSdkConfig().agentLogPath;
  }

  /**
   * Reset initialization state (for new sessions)
   */
  reset(): void {
    this.initialized = false;
  }
}

// Export singleton instance
export const agentLogger = new AgentLogger();
