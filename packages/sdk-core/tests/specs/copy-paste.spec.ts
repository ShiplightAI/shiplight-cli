/**
 * Test: Copy-Paste functionality using keyboard shortcuts
 *
 * Tests the press action with ControlOrMeta+a, ControlOrMeta+c, ControlOrMeta+v
 * to verify copy-paste works correctly between two input fields.
 *
 * Note: Uses ControlOrMeta for cross-platform compatibility (Ctrl on Windows/Linux, Cmd on Mac)
 */

import { test, expect } from '@playwright/test';
import { WebAgent, createAgentContext, ActionHandler } from 'sdk-core';
import { VariableStore } from 'shiplight-types';

test.describe('Copy-Paste with keyboard shortcuts', () => {
  let agent: WebAgent;
  let actionHandler: ActionHandler;

  test.beforeEach(() => {
    const variableStore = new VariableStore();
    const agentContext = createAgentContext({
      variableStore,
      testDataDir: '/tmp',
    });
    agent = new WebAgent(agentContext);
    actionHandler = new ActionHandler();
  });

  test('should copy text from one input and paste to another', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Create a simple HTML page with two text inputs
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <h1>Copy-Paste Test</h1>
          <div>
            <label for="source">Source:</label>
            <input type="text" id="source" value="Hello World" style="width: 200px; padding: 8px;">
          </div>
          <br>
          <div>
            <label for="target">Target:</label>
            <input type="text" id="target" value="" style="width: 200px; padding: 8px;">
          </div>
        </body>
      </html>
    `);

    await page.waitForLoadState('domcontentloaded');

    // Step 1: Click on the source input to focus it
    await actionHandler.execute(page, {
      action_description: 'Click on source input',
      locator: "getByLabel('Source:')",
      action_data: {
        action_name: 'click',
        kwargs: {},
      },
    }, agent.agentServices);

    // Verify source input is focused
    const sourceInput = page.getByLabel('Source:');
    await expect(sourceInput).toBeFocused();

    // Step 2: Press ControlOrMeta+a to select all text
    await actionHandler.execute(page, {
      action_description: 'Select all text',
      action_data: {
        action_name: 'press',
        kwargs: { keys: 'ControlOrMeta+a' },
      },
    }, agent.agentServices);

    // Step 3: Press ControlOrMeta+c to copy
    await actionHandler.execute(page, {
      action_description: 'Copy selected text',
      action_data: {
        action_name: 'press',
        kwargs: { keys: 'ControlOrMeta+c' },
      },
    }, agent.agentServices);

    // Step 4: Click on the target input to focus it
    await actionHandler.execute(page, {
      action_description: 'Click on target input',
      locator: "getByLabel('Target:')",
      action_data: {
        action_name: 'click',
        kwargs: {},
      },
    }, agent.agentServices);

    // Verify target input is focused
    const targetInput = page.getByLabel('Target:');
    await expect(targetInput).toBeFocused();

    // Step 5: Press ControlOrMeta+v to paste
    await actionHandler.execute(page, {
      action_description: 'Paste text',
      action_data: {
        action_name: 'press',
        kwargs: { keys: 'ControlOrMeta+v' },
      },
    }, agent.agentServices);

    // Step 6: Verify the text was pasted correctly
    await expect(targetInput).toHaveValue('Hello World');

    // Also verify source still has original text
    await expect(sourceInput).toHaveValue('Hello World');
  });

  test('should copy partial text selection and paste', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Create HTML with text inputs
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <input type="text" id="source" value="ABCDEFGHIJ" aria-label="source">
          <input type="text" id="target" value="" aria-label="target">
        </body>
      </html>
    `);

    await page.waitForLoadState('domcontentloaded');

    // Focus source input
    await actionHandler.execute(page, {
      action_description: 'Click on source input',
      locator: "getByLabel('source')",
      action_data: {
        action_name: 'click',
        kwargs: {},
      },
    }, agent.agentServices);

    // Select all and copy
    await actionHandler.execute(page, {
      action_description: 'Select all',
      action_data: {
        action_name: 'press',
        kwargs: { keys: 'ControlOrMeta+a' },
      },
    }, agent.agentServices);

    await actionHandler.execute(page, {
      action_description: 'Copy',
      action_data: {
        action_name: 'press',
        kwargs: { keys: 'ControlOrMeta+c' },
      },
    }, agent.agentServices);

    // Click target and paste
    await actionHandler.execute(page, {
      action_description: 'Click on target input',
      locator: "getByLabel('target')",
      action_data: {
        action_name: 'click',
        kwargs: {},
      },
    }, agent.agentServices);

    await actionHandler.execute(page, {
      action_description: 'Paste',
      action_data: {
        action_name: 'press',
        kwargs: { keys: 'ControlOrMeta+v' },
      },
    }, agent.agentServices);

    // Verify paste worked
    const targetInput = page.getByLabel('target');
    await expect(targetInput).toHaveValue('ABCDEFGHIJ');
  });

  test('should handle cut and paste', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Create HTML with text inputs
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <input type="text" id="source" value="Cut Me" aria-label="source">
          <input type="text" id="target" value="" aria-label="target">
        </body>
      </html>
    `);

    await page.waitForLoadState('domcontentloaded');

    // Focus source, select all, cut
    await actionHandler.execute(page, {
      action_description: 'Click on source input',
      locator: "getByLabel('source')",
      action_data: {
        action_name: 'click',
        kwargs: {},
      },
    }, agent.agentServices);

    await actionHandler.execute(page, {
      action_description: 'Select all',
      action_data: {
        action_name: 'press',
        kwargs: { keys: 'ControlOrMeta+a' },
      },
    }, agent.agentServices);

    await actionHandler.execute(page, {
      action_description: 'Cut',
      action_data: {
        action_name: 'press',
        kwargs: { keys: 'ControlOrMeta+x' },
      },
    }, agent.agentServices);

    // Verify source is now empty
    const sourceInput = page.getByLabel('source');
    await expect(sourceInput).toHaveValue('');

    // Click target and paste
    await actionHandler.execute(page, {
      action_description: 'Click on target input',
      locator: "getByLabel('target')",
      action_data: {
        action_name: 'click',
        kwargs: {},
      },
    }, agent.agentServices);

    await actionHandler.execute(page, {
      action_description: 'Paste',
      action_data: {
        action_name: 'press',
        kwargs: { keys: 'ControlOrMeta+v' },
      },
    }, agent.agentServices);

    // Verify paste worked
    const targetInput = page.getByLabel('target');
    await expect(targetInput).toHaveValue('Cut Me');
  });
});
