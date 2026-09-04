/**
 * MobileAgentServices - Service layer for mobile action execution
 *
 * Provides utility methods and driver access to actions.
 * Consolidates all services needed for action execution:
 * - Driver access for element interactions
 * - Variable management for test data substitution
 * - AI-powered evaluation for assertions
 */

import type { Browser } from 'webdriverio';
import type { GeminiProProvider } from './provider';
import { replaceVariables } from 'shiplight-types';
import { parsePageSourceToTreeString } from '../../elements/parsePageSource';
import { createLogger } from '../../utils/logger';

const log = createLogger('MobileAgentServices');

/**
 * Result from statement evaluation
 */
export interface EvaluateResult {
  success: boolean;
  explanation: string;
  error?: string;
}

/**
 * MobileAgentServices provides all utilities needed for mobile action execution
 *
 * Key responsibilities:
 * - Provide driver access for element interactions
 * - Manage variables for test data substitution
 * - Provide evaluate() for AI-powered assertions (using text + vision)
 * - Abstract driver operations (screenshot, page source, screen size)
 */
export class MobileAgentServices {
  private driver: Browser;
  private provider: GeminiProProvider;
  private variables: Map<string, string>;

  constructor(driver: Browser, provider: GeminiProProvider) {
    this.driver = driver;
    this.provider = provider;
    this.variables = new Map();
  }

  // ===========================================================================
  // Driver Access
  // ===========================================================================

  /**
   * Get the WebDriverIO browser instance
   * Used by actions that need direct driver access
   */
  getDriver(): Browser {
    return this.driver;
  }

  /**
   * Update the driver instance (e.g., after reconnection)
   */
  setDriver(driver: Browser): void {
    this.driver = driver;
    log.debug('Driver instance updated');
  }

  // ===========================================================================
  // Variable Management
  // ===========================================================================

  /**
   * Get a variable value
   * @param name - Variable name (without $ prefix)
   */
  getVariable(name: string): string | undefined {
    const cleanName = name.startsWith('$') ? name.slice(1) : name;
    return this.variables.get(cleanName);
  }

  /**
   * Set a variable value
   * @param name - Variable name (without $ prefix)
   * @param value - Value to store
   */
  setVariable(name: string, value: string): void {
    const cleanName = name.startsWith('$') ? name.slice(1) : name;
    this.variables.set(cleanName, value);
    log.debug(`Variable set: ${cleanName}`);
  }

  /**
   * Get all variables
   */
  getVariables(): Map<string, string> {
    return this.variables;
  }

  /**
   * Set all variables at once (replaces existing)
   */
  setVariables(variables: Map<string, string>): void {
    this.variables = variables;
  }

  /**
   * Replace variable placeholders in a string
   * Supports multiple formats: $varName, ${varName}, {{ varName }}, <secret>varName</secret>
   * @param text - Text with variable placeholders
   * @returns Text with variables substituted
   */
  replaceVariables(text: string): string {
    return replaceVariables(text, this.variables);
  }

  // ===========================================================================
  // Evaluation (for AI assertions)
  // ===========================================================================

  /**
   * Evaluate a statement using AI (for ai_assert action)
   *
   * Takes a screenshot and element tree, then uses the provider to evaluate
   * whether the statement is true based on the current screen state.
   *
   * @param statement - Statement to evaluate (e.g., "The login button is visible")
   * @returns Evaluation result with success flag and explanation
   */
  async evaluate(statement: string): Promise<EvaluateResult> {
    log.debug(`Evaluating: ${statement}`);

    // Take screenshot
    const screenshot = await this.screenshot();

    // Get element tree
    const pageSource = await this.driver.getPageSource();
    const elementTree = parsePageSourceToTreeString(pageSource);

    // Evaluate using the provider (text + vision)
    return this.provider.evaluate({
      statement,
      screenshot,
      elementTree,
    });
  }

  // ===========================================================================
  // Internal Driver Operations (used by evaluate())
  // ===========================================================================

  /**
   * Take a screenshot (internal use for evaluate)
   * @returns Base64 encoded PNG screenshot with data URI prefix
   */
  private async screenshot(): Promise<string> {
    const base64 = await this.driver.takeScreenshot();
    return `data:image/png;base64,${base64}`;
  }
}
