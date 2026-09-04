#!/usr/bin/env tsx
/**
 * Test script for switch_tab action
 *
 * Tests that:
 * 1. go_to_url with new_tab=true opens a new tab
 * 2. switch_tab switches to the correct tab
 * 3. Tab operations work correctly with WebAgent
 *
 * Prerequisites:
 * - Set GOOGLE_API_KEY or ANTHROPIC_API_KEY in .env file (based on MODEL)
 * - Set MODEL in .env file (default: gemini-2.5-pro)
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get the directory of this file (ESM equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from the same directory as this script
config({ path: resolve(__dirname, '.env') });

// Dynamic import to ensure env vars are loaded first
const { WebAgent, createAgentContext, BrowserManager, VariableStore, configureSdk } = await import('sdk-core');

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

async function testSwitchTab() {
  console.log('=== Testing Switch Tab ===\n');

  // Launch browser using BrowserManager (required for tab management)
  console.log('1. Launching browser...');
  const browserManager = new BrowserManager({ headless: false });
  const browserInstance = await browserManager.launchBrowser();
  const context = browserInstance.context;
  const page = await context.newPage();
  console.log('   ✓ Browser launched\n');

  try {
    // Create agent context
    const variableStore = new VariableStore();
    const agentContext = createAgentContext({
      model,
      variableStore,
      testDataDir: '/tmp',
    });

    const agent = new WebAgent(agentContext);
    // Initialize tab management
    agent.agentServices.setupPageTracking(context);
    console.log(`2. Created WebAgent with model: ${model}\n`);

    // Step 1: Navigate to first page
    console.log('3. Navigating to example.com (Tab 0)...');
    await page.goto('https://example.com');
    await page.waitForLoadState('load');
    console.log(`   ✓ Tab 0 URL: ${page.url()}\n`);

    // Step 2: Open new tab with go_to_url
    console.log('4. Using agent to open github.com in new tab...');
    const result1 = await agent.execute(page, 'open https://github.com in a new tab');

    console.log(`   Result: ${result1.success ? '✓ Success' : '✗ Failed'}`);
    if (result1.actions && result1.actions.length > 0) {
      const action = result1.actions[0];
      console.log(`   Action: ${action.action_data?.action_name}`);
      console.log(`   Params: ${JSON.stringify(action.action_data?.kwargs)}`);
    }

    // Verify tabs
    let pages = context.pages();
    console.log(`   Total tabs: ${pages.length}`);
    pages.forEach((p, i) => {
      console.log(`      Tab ${i}: ${p.url()}`);
    });
    console.log('');

    // Get the current page from TabManager
    const currentPageAfterNewTab = agent.agentServices.getCurrentPage();
    console.log(`   Current page (from TabManager): ${currentPageAfterNewTab?.url()}\n`);

    // Step 3: Switch back to tab 0
    console.log('5. Using agent to switch to tab 0...');
    const result2 = await agent.execute(currentPageAfterNewTab!, 'switch to tab 0');

    console.log(`   Result: ${result2.success ? '✓ Success' : '✗ Failed'}`);
    if (result2.actions && result2.actions.length > 0) {
      const action = result2.actions[0];
      console.log(`   Action: ${action.action_data?.action_name}`);
      console.log(`   Params: ${JSON.stringify(action.action_data?.kwargs)}`);
    }

    // Verify current page after switch
    const currentPageAfterSwitch0 = agent.agentServices.getCurrentPage();
    console.log(`   Current page (from TabManager): ${currentPageAfterSwitch0?.url()}`);

    const isOnExample = currentPageAfterSwitch0?.url().includes('example.com');
    if (isOnExample) {
      console.log('   ✓ Correctly on example.com (Tab 0)\n');
    } else {
      console.log(`   ✗ Expected example.com, but on: ${currentPageAfterSwitch0?.url()}\n`);
    }

    // Step 4: Switch to tab 1 (github)
    console.log('6. Using agent to switch to tab 1...');
    const result3 = await agent.execute(currentPageAfterSwitch0!, 'switch to tab 1');

    console.log(`   Result: ${result3.success ? '✓ Success' : '✗ Failed'}`);
    if (result3.actions && result3.actions.length > 0) {
      const action = result3.actions[0];
      console.log(`   Action: ${action.action_data?.action_name}`);
      console.log(`   Params: ${JSON.stringify(action.action_data?.kwargs)}`);
    }

    // Verify current page after switch
    const currentPageAfterSwitch1 = agent.agentServices.getCurrentPage();
    console.log(`   Current page (from TabManager): ${currentPageAfterSwitch1?.url()}`);

    const isOnGithub = currentPageAfterSwitch1?.url().includes('github.com');
    if (isOnGithub) {
      console.log('   ✓ Correctly on github.com (Tab 1)\n');
    } else {
      console.log(`   ✗ Expected github.com, but on: ${currentPageAfterSwitch1?.url()}\n`);
    }

    // Summary
    console.log('=== Test Summary ===');
    console.log(`   Tab 0 (example.com): ${isOnExample ? '✓' : '✗'}`);
    console.log(`   Tab 1 (github.com): ${isOnGithub ? '✓' : '✗'}`);

    // Wait to see result
    console.log('\n7. Waiting 3 seconds...');
    await new Promise(resolve => setTimeout(resolve, 3000));

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  } finally {
    console.log('\n8. Closing browser...');
    await browserManager.terminateBrowser(browserInstance);
    console.log('   ✓ Browser closed\n');
    console.log('=== Test complete ===');
  }
}

testSwitchTab();
