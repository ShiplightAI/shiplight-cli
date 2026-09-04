/**
 * Test: Interactive Class Names Feature
 *
 * This test verifies that custom CSS class names can be configured to be treated
 * as interactive elements during DOM analysis.
 */

import { test, expect } from '@playwright/test';
import { createAgentContext, DomService, AgentServices } from 'sdk-core';
import { VariableStore } from 'shiplight-types';

test.describe('Interactive Class Names', () => {
  test('should detect elements with custom interactive class names', async ({ page }) => {
    // Create test HTML with custom interactive classes
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            .tw-cursor-pointer { cursor: pointer; }
            .custom-clickable { cursor: pointer; }
            .my-button { padding: 10px; }
          </style>
        </head>
        <body>
          <!-- Standard button (should always be detected) -->
          <button id="standard-button">Standard Button</button>

          <!-- Custom class elements (only detected if configured) -->
          <div class="tw-cursor-pointer" id="tailwind-element">Tailwind Clickable</div>
          <span class="custom-clickable" id="custom-element">Custom Clickable</span>
          <div class="my-button" id="my-button-element">My Button</div>

          <!-- Regular div (should not be detected) -->
          <div id="regular-div">Regular Div</div>
        </body>
      </html>
    `;

    // Use data URL to avoid about:blank issue
    await page.goto(`data:text/html,${encodeURIComponent(html)}`);

    // Verify page loaded correctly
    const buttonCount = await page.locator('button').count();
    const pageUrl = page.url();
    console.log(`Page has ${buttonCount} button(s)`);
    console.log(`Page URL: ${pageUrl}`);

    // Test 1: Without interactive class names configuration
    const contextWithout = createAgentContext({ variableStore: new VariableStore() });
    const domServiceWithout = new DomService();

    // Access agent services via the context
    const interactiveClassNamesWithout = contextWithout.organizationSettings?.agent_settings?.interactive_class_names || [];

    const domStateWithout = await domServiceWithout.getClickableElements(page, {
      interactiveClassNames: interactiveClassNamesWithout
    });

    console.log(`DOM State elementTree: ${domStateWithout.elementTree ? 'exists' : 'null'}`);
    console.log(`DOM State selectorMap: ${domStateWithout.selectorMap ? domStateWithout.selectorMap.size : 'null'}`);

    // Count interactive elements (only standard button should be detected)
    let interactiveCountWithout = 0;
    const selectorMapWithout = domStateWithout.selectorMap;
    for (const [, element] of selectorMapWithout) {
      if (element.isInteractive) {
        interactiveCountWithout++;
      }
    }

    console.log(`Without config - Interactive elements detected: ${interactiveCountWithout}`);
    console.log(`Without config - Selector map size: ${selectorMapWithout.size}`);

    // Should detect at least the standard button
    expect(interactiveCountWithout).toBeGreaterThanOrEqual(1);

    // Test 2: With interactive class names configuration
    const contextWith = createAgentContext({
      variableStore: new VariableStore(),
      organizationSettings: {
        agent_settings: {
          interactive_class_names: ['tw-cursor-pointer', 'custom-clickable', 'my-button']
        }
      }
    });

    const domServiceWith = new DomService();
    const interactiveClassNamesWith = contextWith.organizationSettings?.agent_settings?.interactive_class_names || [];

    const domStateWith = await domServiceWith.getClickableElements(page, {
      interactiveClassNames: interactiveClassNamesWith
    });

    // Count interactive elements (should detect standard button + 3 custom class elements)
    let interactiveCountWith = 0;
    const selectorMapWith = domStateWith.selectorMap;
    for (const [, element] of selectorMapWith) {
      if (element.isInteractive) {
        interactiveCountWith++;
      }
    }

    console.log(`With config - Interactive elements detected: ${interactiveCountWith}`);
    console.log(`With config - Selector map size: ${selectorMapWith.size}`);

    // Should detect more elements with custom classes configured
    expect(interactiveCountWith).toBeGreaterThan(interactiveCountWithout);

    // Should detect at least 4 elements (1 standard button + 3 custom class elements)
    expect(interactiveCountWith).toBeGreaterThanOrEqual(4);

    // Verify specific elements are detected
    let foundTailwind = false;
    let foundCustom = false;
    let foundMyButton = false;

    for (const [, element] of selectorMapWith) {
      const id = element.attributes.id;
      if (id === 'tailwind-element' && element.isInteractive) foundTailwind = true;
      if (id === 'custom-element' && element.isInteractive) foundCustom = true;
      if (id === 'my-button-element' && element.isInteractive) foundMyButton = true;
    }

    expect(foundTailwind).toBe(true);
    expect(foundCustom).toBe(true);
    expect(foundMyButton).toBe(true);

    console.log('✅ All custom class elements detected as interactive');
  });

  test('should work with AgentServices.getInteractiveClassNames()', async ({ page }) => {
    // Create test HTML
    const html = `
      <!DOCTYPE html>
      <html>
        <body>
          <div class="app-clickable" id="test-element">Test Element</div>
        </body>
      </html>
    `;
    await page.goto(`data:text/html,${encodeURIComponent(html)}`);

    // Create context with organization settings
    const context = createAgentContext({
      variableStore: new VariableStore(),
      organizationSettings: {
        agent_settings: {
          interactive_class_names: ['app-clickable']
        }
      }
    });

    // Create AgentServices
    const agentServices = new AgentServices(context);

    // Get interactive class names via AgentServices
    const classNames = agentServices.getInteractiveClassNames();

    expect(classNames).toEqual(['app-clickable']);

    // Use with DOM service
    const domService = new DomService();
    const domState = await domService.getClickableElements(page, {
      interactiveClassNames: classNames
    });

    // Verify element is detected
    let found = false;
    for (const [, element] of domState.selectorMap) {
      if (element.attributes.id === 'test-element' && element.isInteractive) {
        found = true;
      }
    }

    expect(found).toBe(true);
    console.log('✅ AgentServices.getInteractiveClassNames() works correctly');
  });

  test('should return empty array when not configured', async ({ page }) => {
    await page.goto('data:text/html,<html><body><div>Test</div></body></html>');

    // Create context without organization settings
    const context = createAgentContext({ variableStore: new VariableStore() });

    const agentServices = new AgentServices(context);

    const classNames = agentServices.getInteractiveClassNames();

    expect(classNames).toEqual([]);
    console.log('✅ Returns empty array when not configured');
  });
});
