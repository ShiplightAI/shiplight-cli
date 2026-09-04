/**
 * Agent Logger
 *
 * Logs agent execution details (prompts, LLM thinking, internal state) to a file.
 * These logs are separate from the main logger to avoid cluttering console output.
 */

import { appendFileSync, writeFileSync } from 'fs';
import { getSdkConfig } from '../config';

class AgentLogger {
  private initialized = false;

  /**
   * Initialize the log file (only on first call, appends section header)
   */
  init(): void {
    // Only initialize once per session
    if (this.initialized) {
      return;
    }

    const logPath = getSdkConfig().agentLogPath;
    if (logPath) {
      try {
        // Append a new session header instead of overwriting
        appendFileSync(logPath, `\n=== Agent Execution Log ===\nStarted: ${new Date().toISOString()}\n\n`);
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
    const logPath = getSdkConfig().agentLogPath;
    if (!logPath) return;

    if (!this.initialized) {
      this.init();
    }

    try {
      const timestamp = new Date().toISOString();
      appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    } catch (error) {
      // Silently fail - don't disrupt test execution
    }
  }

  /**
   * Log a section header
   */
  section(title: string): void {
    this.log(`\n${'='.repeat(60)}\n${title}\n${'='.repeat(60)}`);
  }

  /**
   * Log step information
   */
  step(stepNumber: number, maxSteps: number, info: {
    task?: string;
    url?: string;
    thinking?: string;
    evaluation?: string;
    memory?: string;
    goal?: string;
    actions?: string;
  }): void {
    this.section(`Step ${stepNumber}/${maxSteps}`);
    if (info.task) this.log(`Task: ${info.task}`);
    if (info.url) this.log(`URL: ${info.url}`);
    if (info.thinking) this.log(`Thinking: ${info.thinking}`);
    if (info.evaluation) this.log(`Evaluation: ${info.evaluation}`);
    if (info.memory) this.log(`Memory: ${info.memory}`);
    if (info.goal) this.log(`Goal: ${info.goal}`);
    if (info.actions) this.log(`Actions: ${info.actions}`);
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
      const total = usage.totalTokens || 0;
      this.log(`Tokens: ${prompt} prompt + ${completion} completion = ${total} total`);
    }
  }

  /**
   * Log native thinking from LLM
   */
  thinking(text: string): void {
    this.log(`Native Thinking:\n${text}`);
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
   * Check if logging is enabled
   */
  isEnabled(): boolean {
    return !!getSdkConfig().agentLogPath;
  }
}

// Export singleton instance
export const agentLogger = new AgentLogger();
