#!/usr/bin/env tsx
/**
 * Test script for single action generation with locator verification
 *
 * Tests that WebAgent.performAction() generates correct locators for interactive elements
 * performAction() calls executeStep directly for precise single-action execution.
 *
 * Example: "click the search button" should generate a valid Playwright locator
 *
 * Prerequisites:
 * - Set GOOGLE_API_KEY or ANTHROPIC_API_KEY in .env file (based on MODEL)
 * - Set MODEL in .env file (default: gemini-2.5-pro)
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '.env') });

// Dynamic import to ensure env vars are loaded first
const { WebAgent, createAgentContext, pickBestLocator, BrowserManager, VariableStore, configureSdk } = await import('sdk-core');

// Configure SDK with API key based on model
const model = process.env.MODEL;
if (!model) {
  console.error('❌ Error: MODEL not set');
  console.log('   Add to .env file. Supported models:');
  console.log('   - Anthropic: claude-sonnet-4-6, claude-haiku-4-5, claude-opus-4-6');
  console.log('   - Google: gemini-2.5-pro, gemini-2.5-flash');
  process.exit(1);
}
const isAnthropicModel = model.startsWith('claude-');

const envConfig: Record<string, string> = {};
if (isAnthropicModel) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error('❌ Error: ANTHROPIC_API_KEY not set');
    console.log('   Add to .env file or get your key from: https://console.anthropic.com/');
    console.log(`   Required for model: ${model}`);
    process.exit(1);
  }
  envConfig.ANTHROPIC_API_KEY = anthropicKey;
  console.log(`📦 Using Anthropic model: ${model}`);
} else {
  const googleKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!googleKey) {
    console.error('❌ Error: GOOGLE_API_KEY not set');
    console.log('   Add to .env file or get your key from: https://aistudio.google.com/app/apikey');
    console.log(`   Required for model: ${model}`);
    process.exit(1);
  }
  envConfig.GOOGLE_API_KEY = googleKey;
  console.log(`📦 Using Google model: ${model}`);
}
configureSdk({ env: envConfig });

async function testSingleAction() {
  console.log('=== Testing performAction() with Locator Verification ===\n');

  // Launch browser using BrowserManager
  console.log('1. Launching browser...');
  const browserManager = new BrowserManager({ headless: false });
  const browserInstance = await browserManager.launchBrowser();
  const context = browserInstance.context;
  const page = await context.newPage();
  console.log('   ✓ Browser launched\n');

  try {
    // Create agent
    const variableStore = new VariableStore();
    const agentContext = createAgentContext({
      model,
      variableStore,
      testDataDir: '/tmp',
    });
    const agent = new WebAgent(agentContext);
    agent.agentServices.setupPageTracking(context);
    console.log(`2. Created WebAgent with model: ${model}\n`);

    // Navigate to a test page with known elements
    console.log('3. Navigating to example.com...');
    await page.goto('https://example.com');
    await page.waitForLoadState('load');
    console.log('   ✓ Navigation complete\n');

    // Test 1: Click on "More information..." link using performAction (single action)
    console.log('4. Testing performAction: "click on More information link"...');
    console.log('   Expected: Should generate a locator for the link element\n');

    const result = await agent.performAction(page, 'click on More information link');

    console.log('5. Task result:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Actions count: ${result.actions?.length || 0}`);

    if (result.actions && result.actions.length > 0) {
      console.log('\n   Action details:');
      const action = result.actions[0];

      console.log(`   - Action: ${action.action_data?.action_name || 'unknown'}`);
      console.log(`   - Description: ${action.action_description || 'none'}`);
      console.log(`   - Locator: ${action.locator || 'none'}`);
      console.log(`   - XPath: ${action.xpath || 'none'}`);
      console.log(`   - Element index: ${action.element_index}`);

      // Verify locator format and xpath
      console.log('\n6. Verifying locator...');

      // Check if locator is Playwright API format (e.g., "getByRole('link', { name: 'Learn more' })")
      const isPlaywrightApi = action.locator?.startsWith('getBy') || action.locator?.startsWith('locator(');
      console.log(`   Locator format: ${isPlaywrightApi ? 'Playwright API' : 'CSS/XPath selector'}`);

      if (action.xpath) {
        console.log('\n7. Verifying xpath...');
        try {
          const element = page.locator(`xpath=${action.xpath}`);
          const count = await element.count();
          console.log(`   ✓ XPath is valid: "${action.xpath}"`);
          console.log(`   ✓ Found ${count} matching element(s)`);

          // Get element details
          if (count > 0) {
            const tagName = await element.first().evaluate(el => el.tagName.toLowerCase());
            const text = await element.first().textContent();
            const href = await element.first().evaluate(el => (el as HTMLAnchorElement).href || '');

            console.log(`   ✓ Element: <${tagName}>`);
            console.log(`   ✓ Text: "${text?.trim() || ''}"`);
            if (href) {
              console.log(`   ✓ Href: "${href}"`);
            }

            // Test if pickBestLocator function would generate similar locator
            console.log('\n8. Comparing with pickBestLocator function...');
            const generatedLocator = await pickBestLocator(page, action.xpath);
            console.log(`   Generated by LLM:     "${action.locator}"`);
            console.log(`   Generated by function: "${generatedLocator || 'null'}"`);

            if (generatedLocator && action.locator === generatedLocator) {
              console.log('   ✓ Locators match perfectly!');
            } else {
              console.log('   ⚠️  Locators differ (both may be valid)');
            }
          }
        } catch (error) {
          console.error(`   ❌ XPath verification failed: ${error}`);
        }
      } else {
        console.log('\n   ⚠️  No XPath generated!');
      }

      // Show raw action data
      console.log('\n9. Raw action data:');
      console.log(JSON.stringify(action, null, 2));
    } else {
      console.log('   ⚠️  No actions returned!');
    }

    console.log(`\n   Details: ${result.details || 'none'}`);

    // Wait to see the result
    console.log('\n10. Waiting 5 seconds to view result...');
    await new Promise(resolve => setTimeout(resolve, 5000));

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  } finally {
    console.log('\n11. Closing browser...');
    await browserManager.terminateBrowser(browserInstance);
    console.log('   ✓ Browser closed\n');
    console.log('=== Test complete ===');
  }
}

testSingleAction();
