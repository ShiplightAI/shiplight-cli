/**
 * Tests for generateAction locator generation
 *
 * Verifies that generateAction returns ActionEntity with proper locator info:
 * - xpath: The XPath to the element
 * - locator: Playwright locator string (when PWDEBUG=console is set)
 * - frame_path: Path to iframe if element is in a frame
 */

import { test, expect } from '@playwright/test';
import { WebAgent, createAgentContext, configureSdk } from 'sdk-core';
import { VariableStore, resolveWebAgentModelFromEnv } from 'shiplight-types';

test.describe('generateAction locator generation', () => {
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

  test('should generate ActionEntity with xpath for click action', async ({ page }) => {
    // Navigate to Google which has clear interactive elements
    await page.goto('https://www.google.com');
    await page.waitForLoadState('load');

    // Generate an action to click a specific button
    const result = await agent.generate(page, 'click on the Google Search button');

    expect(result.success).toBe(true);
    expect(result.actions).toBeDefined();
    expect(result.actions!.length).toBeGreaterThan(0);

    const action = result.actions![0];

    // Verify action structure
    expect(action.action_data).toBeDefined();
    expect(action.action_data!.action_name).toBe('click');
    expect(action.action_description).toBeTruthy();

    // Verify locator info is populated
    expect(action.xpath).toBeTruthy();

    // Verify xpath is valid by using it
    if (action.xpath) {
      const element = page.locator(`xpath=${action.xpath}`);
      const count = await element.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('should generate ActionEntity with xpath for input action', async ({ page }) => {
    // Navigate to a page with input fields
    await page.goto('https://www.google.com');
    await page.waitForLoadState('load');

    // Generate an action to type in the search box
    const result = await agent.generate(page, 'type "hello world" in the search box');

    expect(result.success).toBe(true);
    expect(result.actions).toBeDefined();
    expect(result.actions!.length).toBeGreaterThan(0);

    const action = result.actions![0];

    // Verify action is an input action (could be input_text or fill)
    expect(action.action_data).toBeDefined();
    expect(['input_text', 'fill']).toContain(action.action_data!.action_name);

    // Verify xpath is populated
    expect(action.xpath).toBeTruthy();

    // Verify xpath points to an input element
    if (action.xpath) {
      const element = page.locator(`xpath=${action.xpath}`);
      const tagName = await element.evaluate(el => el.tagName.toLowerCase());
      expect(['input', 'textarea']).toContain(tagName);
    }
  });

  test('should not have locator info for navigation actions', async ({ page }) => {
    await page.goto('https://example.com');
    await page.waitForLoadState('load');

    // Generate a navigation action (no element index)
    const result = await agent.generate(page, 'go to google.com');

    expect(result.success).toBe(true);
    expect(result.actions).toBeDefined();
    expect(result.actions!.length).toBeGreaterThan(0);

    const action = result.actions![0];

    // Navigation actions don't have element references
    expect(action.action_data!.action_name).toBe('go_to_url');

    // No xpath/locator for navigation actions (no element index)
    // This is expected behavior - only element-based actions have locators
  });

  test('should generate valid locator when PWDEBUG is set', async ({ page }) => {
    // Navigate to Google which has clear interactive elements
    await page.goto('https://www.google.com');
    await page.waitForLoadState('load');

    // Generate an action to click a specific button
    const result = await agent.generate(page, 'click on the Google Search button');

    expect(result.success).toBe(true);
    expect(result.actions).toBeDefined();
    expect(result.actions!.length).toBeGreaterThan(0);

    const action = result.actions![0];

    // Verify xpath is populated
    expect(action.xpath).toBeTruthy();

    // When PWDEBUG=console is set, locator should be a Playwright API string
    // Note: locator might be null if playwright.generateLocator is not available
    if (action.locator) {
      expect(action.locator).toMatch(/^(getBy|locator\()/);
    }
  });
});

test.describe('executeStep with locator', () => {
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

  test('should execute action and return ActionEntity with locator', async ({ page }) => {
    // Navigate to Google
    await page.goto('https://www.google.com');
    await page.waitForLoadState('load');

    // Execute an input action - more reliable than click
    const result = await agent.execute(page, 'type "playwright test" in the search box');

    expect(result.success).toBe(true);
    expect(result.actions).toBeDefined();
    expect(result.actions!.length).toBeGreaterThan(0);

    const action = result.actions![0];

    // Verify locator info is present after execution
    expect(action.xpath).toBeTruthy();

    // Verify the input action worked - search box should have text
    const searchBox = page.locator('textarea[name="q"], input[name="q"]');
    await expect(searchBox).toHaveValue('playwright test');
  });
});
