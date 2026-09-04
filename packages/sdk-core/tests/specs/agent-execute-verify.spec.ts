/**
 * Test: agent.execute() with verification statements
 *
 * Verifies that agent.execute() can handle verification/assertion statements
 * like "Verify current in google page" without errors.
 *
 * Issue: The 'verify' action calls agent.assert() but agentServices passed
 * to the action doesn't have this method, causing "agent.assert is not a function" error.
 */

import { test, expect } from '@playwright/test';
import { WebAgent, createAgentContext, configureSdk } from 'sdk-core';
import { VariableStore, resolveWebAgentModelFromEnv } from 'shiplight-types';

test.describe('agent.execute() with verify statements', () => {
  let agent: WebAgent;

  test.beforeEach(() => {
    configureSdk({ env: { GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ?? '', ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '' } });
    const model = resolveWebAgentModelFromEnv(process.env);
    const variableStore = new VariableStore();
    const agentContext = createAgentContext({
      model,
      variableStore,
      testDataDir: '/tmp',
    });
    agent = new WebAgent(agentContext);
  });

  test('should handle verification statement without error', async ({ page }) => {
    // Navigate to Google
    await page.goto('https://www.google.com');
    await page.waitForLoadState('load');

    // This should NOT throw "agent.assert is not a function" error
    // The verify action needs access to agent.assert() method
    const result = await agent.execute(page, 'Verify current page is Google', 'main.0');

    // We expect the assertion to pass since we're on google.com
    expect(result.success).toBe(true);
    expect(result.details).toBeTruthy();
  });

  test('should handle verification with negative result', async ({ page }) => {
    // Navigate to example.com
    await page.goto('https://example.com');
    await page.waitForLoadState('load');

    // This verification should fail (we're not on google)
    // But it should not throw a function error - it should return a failure result
    try {
      const result = await agent.execute(page, 'Verify current page is Google', 'main.1');

      // The assertion should fail (we're on example.com, not google.com)
      // It might return success=false or throw an error depending on implementation
      if (result.success) {
        // If it returns success, the details should indicate the assertion failed
        expect(result.details).toContain('false');
      }
    } catch (error: any) {
      // If it throws, it should be an assertion failure, not "agent.assert is not a function"
      expect(error.message).not.toContain('agent.assert is not a function');
      // The error should explain why the assertion failed (e.g., mention wrong page)
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  test('should handle "verify" in statement', async ({ page }) => {
    await page.goto('https://www.google.com');
    await page.waitForLoadState('load');

    // Alternative phrasing with "verify"
    const result = await agent.execute(page, 'verify that the search box is visible', 'main.2');

    expect(result.success).toBe(true);
  });

  test('should handle "check" in statement', async ({ page }) => {
    await page.goto('https://www.google.com');
    await page.waitForLoadState('load');

    // Alternative phrasing with "check"
    const result = await agent.execute(page, 'check if the Google logo is displayed', 'main.3');

    expect(result.success).toBe(true);
  });
});
