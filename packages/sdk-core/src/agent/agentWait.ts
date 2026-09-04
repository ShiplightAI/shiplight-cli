/**
 * Wait utilities for Agent
 * Contains various wait/polling methods for browser automation
 */

import { Page } from 'playwright';
import logger from '../utils/logger';
import type { WebAgentContext } from './types';
import { waitForPageAndFramesLoad } from '../browser/browserUtils';

/**
 * Wait for page to be stable (network idle with smart filtering)
 * Uses sophisticated network monitoring that filters out irrelevant requests
 * (analytics, ads, streaming, etc.) to determine when page is truly stable.
 *
 * @param page - Playwright Page object
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 3000)
 * @param minWaitTimeMs - Minimum time to wait before returning (default: 1000)
 */
export async function waitUntilStable(page: Page, timeoutMs: number = 3000, minWaitTimeMs: number = 1000): Promise<void> {
  try {
    await waitForPageAndFramesLoad(page, timeoutMs, minWaitTimeMs);
  } catch {
    // Timeout is ok, page might still be loading
  }
}

/**
 * Wait for a download to complete
 * @param page - Playwright Page object
 * @param context - Agent context containing download status
 * @param timeoutSeconds - Maximum time to wait in seconds
 */
export async function waitForDownloadComplete(
  page: Page,
  context: WebAgentContext,
  timeoutSeconds: number
): Promise<void> {
  const timeoutMs = timeoutSeconds * 1000;
  const downloadCheckInterval = 100; // Check every 100ms
  const startTime = Date.now();

  // Wait for the download to complete
  while (!context.downloadStatus || context.downloadStatus.status === 'inProgress') {
    if (Date.now() - startTime > timeoutMs) {
      let errorMsg: string;
      if (!context.downloadStatus) {
        errorMsg = 'No download in progress or completed';
      } else {
        errorMsg = `Timed out after ${timeoutMs}ms waiting for download to complete`;
      }
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    await page.waitForTimeout(downloadCheckInterval);
  }

  // Check if download failed
  if (context.downloadStatus.status === 'failed') {
    const errorMsg = `Download failed: ${context.downloadStatus.error || 'Unknown error'}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
  context.agentNote = `Download completed: ${context.downloadStatus.filename}`;
}

/**
 * Wait until a condition becomes true using AI evaluation
 * Polls the condition at intervals until it's met or timeout is reached
 *
 * @param page - Playwright Page object
 * @param condition - Natural language condition to evaluate (e.g., "page shows success message")
 * @param evaluateCondition - Function that evaluates the condition using AI (returns boolean)
 * @param timeoutSeconds - Maximum time to wait in seconds (default: 60, max: 300)
 * @returns true if condition was met, false if timeout was reached
 */
export async function waitUntilCondition(
  page: Page,
  condition: string,
  evaluateCondition: (page: Page, condition: string, stepId?: string) => Promise<boolean>,
  timeoutSeconds: number = 60,
  stepId: string
): Promise<boolean> {
  const maxWaitSeconds = Math.min(timeoutSeconds, 300);
  const maxCheckCount = 10;
  const checkInterval = Math.max(10, maxWaitSeconds / maxCheckCount) * 1000;
  const endTime = Date.now() + maxWaitSeconds * 1000;

  logger.info(`Waiting for condition: "${condition}" (timeout: ${maxWaitSeconds}s)`);

  while (true) {
    const lastCheckTime = Date.now();

    try {
      // Evaluate the condition using AI
      const isConditionMet = await evaluateCondition(page, condition, stepId);

      if (isConditionMet) {
        logger.info(`Condition met: "${condition}"`);
        return true;
      }
    } catch (error: any) {
      logger.warn(`Error evaluating condition: ${error.message}`);
    }

    const currentTime = Date.now();
    if (currentTime > endTime) {
      logger.warn(`Timeout waiting for condition: "${condition}"`);
      return false;
    }

    // Wait before next check
    const waitTime = checkInterval - (Date.now() - lastCheckTime);
    if (waitTime > 0) {
      await page.waitForTimeout(waitTime);
    }
  }
}

/**
 * Outcome of a {@link waitForJs} poll loop. `evalCount - errorCount` is the
 * number of clean (non-throwing) evaluations — when it is zero at timeout, the
 * predicate never evaluated successfully and the expression itself is suspect
 * (e.g. a browser-only global referenced in the Node test context).
 */
export interface JsWaitResult {
  /** True if the predicate returned truthy before the timeout. */
  met: boolean;
  /** Total number of predicate invocations. */
  evalCount: number;
  /** Number of invocations that threw. */
  errorCount: number;
  /** Message of the most recent predicate error, if any invocation threw. */
  lastError?: string;
  /** Wall-clock time spent in the wait. */
  elapsedMs: number;
}

/**
 * Wait until a JavaScript predicate returns truthy, polling in-process.
 *
 * The fast/cheap counterpart to {@link waitUntilCondition}: it makes **no model
 * calls**, so it can poll far more frequently. Used by `WAIT_UNTIL: "js:..."`.
 *
 * A throwing predicate (e.g. a transient error while the page is navigating) is
 * swallowed and retried until the timeout — it does not abort the wait. Errors
 * are counted and the last message is kept, so callers can tell a condition
 * that stayed falsy apart from an expression that never evaluated at all.
 *
 * @param page - Playwright Page object
 * @param predicate - Thunk evaluating the JS condition; may be async. Truthy return = met.
 * @param timeoutSeconds - Maximum time to wait in seconds (default: 60, max: 300)
 * @returns the poll outcome — never throws; `met` is false if the timeout was reached
 */
export async function waitForJs(
  page: Page,
  predicate: () => Promise<unknown> | unknown,
  timeoutSeconds: number = 60,
): Promise<JsWaitResult> {
  const maxWaitSeconds = Math.min(timeoutSeconds, 300);
  const pollIntervalMs = 250;
  const startTime = Date.now();
  const endTime = startTime + maxWaitSeconds * 1000;

  logger.info(`Waiting for JS condition (timeout: ${maxWaitSeconds}s)`);

  let evalCount = 0;
  let errorCount = 0;
  let lastError: string | undefined;
  let lastLoggedError: string | undefined;
  while (true) {
    try {
      evalCount++;
      const value = await predicate();
      if (value) {
        logger.info('JS wait condition met');
        return { met: true, evalCount, errorCount, lastError, elapsedMs: Date.now() - startTime };
      }
    } catch (error) {
      // Transient error (e.g. navigation in flight) — keep polling until timeout.
      // Log only when the message changes, so a persistently-throwing predicate
      // (e.g. a bad selector) doesn't flood the log ~4x/second for up to 300s.
      errorCount++;
      const message = (error as Error).message;
      lastError = message;
      if (message !== lastLoggedError) {
        logger.warn(`Error evaluating JS wait condition: ${message}`);
        lastLoggedError = message;
      }
    }

    if (Date.now() > endTime) {
      logger.warn('Timeout waiting for JS condition');
      return { met: false, evalCount, errorCount, lastError, elapsedMs: Date.now() - startTime };
    }

    await page.waitForTimeout(pollIntervalMs);
  }
}

/**
 * Render a {@link JsWaitResult} as a one-line step message. WAIT_UNTIL
 * synchronizes but never fails the test, so the not-met variants are worded as
 * warnings ("— continuing") and distinguish "condition stayed falsy" from
 * "the predicate never evaluated cleanly" (a likely-invalid expression).
 */
export function formatJsWaitOutcome(result: JsWaitResult): string {
  const seconds = (result.elapsedMs / 1000).toFixed(1);
  if (result.met) {
    const evals = `${result.evalCount} evaluation${result.evalCount === 1 ? '' : 's'}`;
    return `Condition met after ${seconds}s (${evals})`;
  }
  if (result.evalCount > 0 && result.errorCount === result.evalCount) {
    return (
      `Condition never evaluated successfully (${result.evalCount} attempts, all errored) — ` +
      `the expression is likely invalid: ${result.lastError}. ` +
      `Waited the full ${seconds}s — continuing`
    );
  }
  const errorSuffix = result.errorCount > 0 ? `, ${result.errorCount} errored` : '';
  return `Condition not met within ${seconds}s (evaluated ${result.evalCount} times${errorSuffix}) — continuing`;
}
