/**
 * Agent Login - Login validation and execution utilities
 *
 * Provides functions for validating login state and executing cached login actions.
 * Adapted from the v1 monorepo's login helper, which is not part of this
 * repository.
 */

import { BrowserContext, Page } from 'playwright';
import { waitForPageAndFramesLoad } from '../browser/browserUtils';
import { agentLogger } from '../utils/agentLogger';
import logger from '../utils/logger';
import type { AgentStepResult } from './types';
import { LoginType } from 'shiplight-types';
export { LoginType };

// Constants
const LOCATOR_VALIDATION_TIMEOUT_MS = 5000;
const PAGE_LOAD_WAIT_TIME_MS = 10000;

/**
 * Callback type for AI-powered step execution (equivalent to old aiStep)
 * This allows agentLogin to use the agent's run() method without direct dependency
 */
export type AIStepCallback = (page: Page, prompt: string) => Promise<AgentStepResult>;

/**
 * Callback type for getting DOM text from a page
 */
export type GetDOMTextCallback = (page: Page) => Promise<string>;

/**
 * Execute Playwright code string on a page
 */
async function executePlaywrightCode(page: Page, code: string): Promise<any> {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const wrappedCode = `
    return await (${code});
  `;
  const func = new AsyncFunction("page", wrappedCode);
  return await func(page);
}

/**
 * Check multiple locators on a page
 * Returns individual success results for each locator, allowing fine-grained validation
 *
 * @param page - The page to validate expressions on
 * @param locators - The locators to validate (without 'page.' prefix)
 * @param failFast - If true, stop on first failure
 * @returns Object with successResults array and logs
 */
export async function checkLocators(
  page: Page,
  locators: string[],
  failFast: boolean
): Promise<{ successResults: boolean[]; logs: string[] }> {
  const logs: string[] = [];
  const successResults: boolean[] = [];

  for (const locator of locators) {
    let success = false;

    try {
      // Build the full locator expression
      const locatorExpression = `page.${locator}`;
      agentLogger.log(`Checking element existence: ${locatorExpression}`);
      logs.push(`Checking element existence: ${locatorExpression}`);

      try {
        // Try waiting for element to be attached (fastest check)
        await executePlaywrightCode(page,
          `${locatorExpression}.waitFor({ state: 'attached', timeout: ${LOCATOR_VALIDATION_TIMEOUT_MS} })`
        );
        agentLogger.log(`Element is attached: ${locatorExpression}`);
        logs.push(`Element is attached: ${locatorExpression}`);
        success = true;
      } catch (waitError: any) {
        // waitFor timed out - fall back to snapshot check
        // This handles cases where waitFor fails even when element exists
        const count = await executePlaywrightCode(page, `${locatorExpression}.count()`) as number;

        if (count > 0) {
          agentLogger.log(`Element found (snapshot): ${locatorExpression}`);
          logs.push(`Element found (snapshot): ${locatorExpression}`);
          success = true;
        } else {
          agentLogger.log(`Element not found: ${locatorExpression}`);
          logs.push(`Element not found: ${locatorExpression}`);
          success = false;
        }
      }
    } catch (error: any) {
      agentLogger.log(`Error checking element: ${error.message}`);
      logs.push(`Error checking element: ${error.message}`);
      success = false;
    }

    successResults.push(success);
    if (!success && failFast) {
      break;
    }
  }

  return { successResults, logs };
}

/**
 * Validate login state by checking multiple locators
 * All locators must pass for validation to succeed
 *
 * @param page - The page to validate
 * @param locators - Array of locator expressions (without 'page.' prefix)
 * @param failFast - If true, stop on first failure (default: true)
 * @returns Object with success status and logs
 */
export async function validateLoginLocators(
  page: Page,
  locators: string[],
  failFast: boolean = true
): Promise<{ success: boolean; logs: string[] }> {
  const { successResults, logs } = await checkLocators(page, locators, failFast);

  // All locators must succeed
  const success = successResults.length === locators.length && successResults.every(r => r);
  return { success, logs };
}

/**
 * Validate if user is logged in using validation expressions
 *
 * @param page - The page to validate
 * @param validationExprs - Array of Playwright locator expressions
 * @returns true if all validation expressions pass (user is logged in)
 */
export async function validateLogin(page: Page, validationExprs: string[]): Promise<boolean> {
  if (!validationExprs || validationExprs.length === 0) {
    agentLogger.log('No validation expressions provided, cannot validate login');
    return false;
  }

  agentLogger.log(`Validating login with ${validationExprs.length} expression(s)`);
  const { success, logs } = await validateLoginLocators(page, validationExprs, true);

  if (success) {
    agentLogger.log('All validation expressions passed');
  } else {
    agentLogger.log(`Validation failed: ${logs.join(', ')}`);
  }

  return success;
}

/**
 * Create an unsigned-in browser context for comparison
 * Uses the same browser but a fresh context without any storage state
 *
 * @param page - The current page (used to get the browser)
 * @param siteUrl - The site URL to navigate to
 * @returns Object with context and page, plus cleanup function
 */
export async function createUnsignedInContext(
  page: Page,
  siteUrl: string
): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
  const browser = page.context().browser();
  if (!browser) {
    throw new Error('Cannot create unsigned-in context: browser not available');
  }

  // Create a fresh context without any storage state
  const context = await browser.newContext();
  const unsignedPage = await context.newPage();

  // Navigate to the site
  await unsignedPage.goto(siteUrl);
  await waitForPageAndFramesLoad(unsignedPage, PAGE_LOAD_WAIT_TIME_MS);

  return {
    context,
    page: unsignedPage,
    close: async () => {
      await unsignedPage.close();
      await context.close();
    },
  };
}

/**
 * Generate validation locators using AI
 * These locators can be used to verify if a user is logged in
 *
 * Originally the v1 login helper's generateValidationLocators (that code is
 * not part of this repository).
 *
 * @param page - The signed-in page to analyze
 * @param unsignedDomText - DOM text from an unsigned-in page for comparison
 * @param priorInfo - Previous generation attempts and their results (for retry logic)
 * @param verificationHint - Optional hint about what indicates signed-in status
 * @param numLocators - Number of locators to generate
 * @param aiStep - Callback to execute AI prompt (typically agent.run)
 * @returns Array of Playwright locator expressions (without 'page.' prefix)
 */
export async function generateValidationLocators(
  page: Page,
  unsignedDomText: string,
  priorInfo: string | null,
  verificationHint: string | null,
  numLocators: number,
  aiStep: AIStepCallback
): Promise<string[]> {
  let verificationCodePrompt = `
Based on the current page status, generate ${numLocators} Playwright locators in JavaScript code that can
be used by a program to verify the page is signed in.
Each expression should yield a locator object that can be used for waiting and checking visibility.
`;

  if (unsignedDomText) {
    verificationCodePrompt += `
For your comparison, the DOM elements of the UNSIGNED IN page are:
"""
${unsignedDomText}
"""
`;
  }

  verificationCodePrompt += `
Output the code in a code block with \`\`\`javascript\`\`\` at the beginning and \`\`\` at the end.

Here is an example of the right format:
\`\`\`javascript
getByRole("button", { name: "Logout" }).first()
\`\`\`

User name, id, email etc are great choices as a part of locators if they present.
They tend to be strong and stable indicators of signed in status.

Don't use locators that may change with page content, such as:
- time of day
- location
- language
- timezone
- device
- browser
- operating system
- numbers
- and other dynamic values

It is a good idea to add 'first()' to the locator to make it more stable for locators
that can result in multiple results.
`;

  if (priorInfo) {
    verificationCodePrompt += `
Previously generated expressions and their results:
"""
${priorInfo}
"""
Avoid regenerating these failed ones, but can reuse the successful ones.`;
  }

  if (verificationHint) {
    verificationCodePrompt += `
${verificationHint}
`;
  }

  verificationCodePrompt += `
Remember, you must have the javascript code block in your final response.
`;

  agentLogger.log('Agent generating validation locators');
  agentLogger.log(`Prompt:\n${verificationCodePrompt}`);
  const result = await aiStep(page, verificationCodePrompt);
  if (!result.success) {
    throw new Error(result.details || 'Agent failed to generate verification code');
  }

  // Parse the result.details to get the verification code
  const details = result.details || '';
  const verificationCode = details.match(/```javascript\n(.*)\n```/s);
  if (!verificationCode) {
    throw new Error('Agent failed to generate verification code: no javascript code block found');
  }

  const code: string = verificationCode[1];
  const locators = code.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const expressions = locators.map(locator => {
    if (locator.startsWith('page.')) {
      locator = locator.slice(5);
    }
    return locator;
  });

  return expressions;
}

/**
 * Generate and validate login locators with retry logic
 * This is the main function for generating validation_exprs after a successful agent login
 *
 * Originally from the v1 login helper (that code is not part of this
 * repository).
 *
 * @param signedInPage - The page after successful login
 * @param siteUrl - The site URL for creating unsigned-in context
 * @param config - Login configuration with verification hints
 * @param aiStep - Callback to execute AI prompt
 * @param getDOMText - Callback to get DOM text from a page
 * @returns Array of validated locator expressions, or null if generation failed
 */
export async function generateAndValidateLoginLocators(
  signedInPage: Page,
  siteUrl: string,
  config: { verification_hint?: string; num_verification_exprs?: number },
  aiStep: AIStepCallback,
  getDOMText: GetDOMTextCallback
): Promise<string[] | null> {
  // Create an unsigned-in context for comparison
  let unsignedInEnv: { context: BrowserContext; page: Page; close: () => Promise<void> } | null = null;

  try {
    unsignedInEnv = await createUnsignedInContext(signedInPage, siteUrl);

    // Capture the DOM text of the unsigned-in page for comparison
    const unsignedDomText = await getDOMText(unsignedInEnv.page);

    const maxTries = 3;
    let prevLogs = '';

    for (let i = 0; i < maxTries; i++) {
      try {
        const locators = await generateValidationLocators(
          signedInPage,
          unsignedDomText,
          prevLogs || null,
          config.verification_hint ?? null,
          config.num_verification_exprs ?? 1,
          aiStep
        );
        agentLogger.log(`Generated validation locators: ${JSON.stringify(locators)}`);

        // Test signed-in status: validate all locators (don't fail fast - we need all results)
        {
          const { successResults, logs } = await checkLocators(signedInPage, locators, false);
          prevLogs += `Test results on a SIGNED IN page. EXPECT ALL PASS:\n${logs.join('\n')}\n\n`;
          // Every locator must be successful
          if (!successResults.every(success => success)) {
            agentLogger.log(`Locator validation on signed-in page failed. Results: ${JSON.stringify(successResults)}`);
            agentLogger.log(`Validation logs:\n${logs.join('\n')}`);
            continue;
          }
        }

        // Test unsigned-in status: validate all locators should FAIL
        {
          agentLogger.log('Validating locators in unsigned-in context, EXPECT ALL TO FAIL');
          const { successResults, logs } = await checkLocators(unsignedInEnv.page, locators, false);
          prevLogs += `Test results on an UNSIGNED IN page. EXPECT ALL FAIL:\n${logs.join('\n')}\n\n`;
          // Every locator must fail (opposite of signed-in status)
          if (successResults.some(success => success)) {
            agentLogger.log(`Locator validation on unsigned-in page failed (some passed when should fail). Results: ${JSON.stringify(successResults)}`);
            agentLogger.log(`Validation logs:\n${logs.join('\n')}`);
            continue;
          }
        }

        // Both validations passed - we have good locators
        agentLogger.log('Generated validation locators passed dual validation');
        return locators;
      } catch (error: any) {
        agentLogger.log(`Failed to generate validation expressions (attempt ${i + 1}/${maxTries}): ${error.message}`);
      }
    }

    agentLogger.log('Failed to generate valid locators after max retries');
    return null;
  } finally {
    if (unsignedInEnv) {
      await unsignedInEnv.close();
    }
  }
}
