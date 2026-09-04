#!/usr/bin/env tsx
/**
 * Test script for multi-step task execution
 *
 * Tests agent.run() with a task that requires multiple actions.
 * run() continues executing until the goal is achieved.
 *
 * For single discrete actions, use performAction() instead.
 *
 * Example: "search for dining table on bing.com"
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

async function testMultiActions() {
  console.log('=== Testing Multi-Step Task (Multiple Actions) ===\n');

  // Launch browser using BrowserManager
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

    // Create WebAgent
    const agent = new WebAgent(agentContext);
    agent.agentServices.setupPageTracking(context);
    console.log(`2. Created WebAgent with model: ${model}\n`);

    // Navigate to bing.com
    console.log('3. Navigating to bing.com...');
    await page.goto('https://www.bing.com');
    await page.waitForLoadState('load');
    console.log('   ✓ Navigation complete\n');

    // Run task
    console.log('4. Running task: "search for dining table"...');
    console.log('   Expected: Multiple actions (fill search box, press Enter or click search)');
    console.log('   Starting execution...\n');

    const result = await agent.run(page, 'search for dining table');

    console.log('\n5. Task result:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Actions count: ${result.actions?.length || 0}`);

    if (result.actions && result.actions.length > 0) {
      console.log('\n   Actions executed:');
      result.actions.forEach((action: any, index: number) => {
        const actionName = action.action_data?.action_name || 'unknown';
        const description = action.action_description || '';
        console.log(`   ${index + 1}. ${actionName}: ${description}`);
      });
    } else {
      console.log('   ⚠️  No actions returned!');
    }

    console.log(`\n   Details: ${result.details || 'none'}`);
    console.log(`   Current URL: ${page.url()}`);

    // Wait to see the result
    console.log('\n6. Waiting 10 seconds to view result...');
    await new Promise(resolve => setTimeout(resolve, 10000));

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  } finally {
    console.log('\n7. Closing browser...');
    await browserManager.terminateBrowser(browserInstance);
    console.log('   ✓ Browser closed\n');
    console.log('=== Test complete ===');
  }
}

testMultiActions();
