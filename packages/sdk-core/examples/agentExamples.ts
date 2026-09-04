/**
 * Agent Examples
 *
 * Demonstrates using the WebAgent for browser automation:
 * - performAction() - Execute a single action (calls executeStep directly)
 * - run() - Execute a multi-step task until goal achieved
 * - assert() / evaluate() - Verify page conditions
 * - extract() - Extract data from page elements
 * - step() - Self-healing wrapper for Playwright code
 *
 * Requires GOOGLE_API_KEY to be set in .env file or environment
 *
 * Usage:
 *   pnpm tsx examples/agentExamples.ts <example>
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get the directory of this file (ESM equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env BEFORE importing other modules (ESM hoists imports, so use dynamic import)
config({ path: resolve(__dirname, '.env') });

// Dynamic imports to ensure env vars are loaded first
const { BrowserContext, Page } = await import('playwright');
const {
  WebAgent,
  createAgentContext,
  BrowserManager,
  BrowserInstance,
  ActionEntity,
  configureSdk
} = await import('sdk-core');
const { VariableStore } = await import('shiplight-types');

/**
 * Ensure environment variables are set and configure SDK
 */
function ensureEnvironment() {
  const model = process.env.MODEL;
  if (!model) {
    console.error('❌ Error: MODEL not set');
    console.log('   Add to .env file. Supported models:');
    console.log('   - Anthropic: claude-sonnet-4-6, claude-haiku-4-5, claude-opus-4-6');
    console.log('   - Google: gemini-2.5-pro, gemini-2.5-flash');
    process.exit(1);
  }
  const isAnthropicModel = model.startsWith('claude-');

  // Build env config based on model type
  const envConfig: Record<string, string> = {};

  if (isAnthropicModel) {
    // Check for Anthropic API key
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
    // Check for Google API key (accept both GOOGLE_API_KEY and GOOGLE_GENERATIVE_AI_API_KEY)
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

  // Configure SDK with API key
  configureSdk({ env: envConfig });

  if (!process.env.ORGANIZATION_ID) {
    console.log('⚠️  ORGANIZATION_ID not set, defaulting to example-test');
    process.env.ORGANIZATION_ID = 'example-test';
  }

  if (!process.env.PLAYWRIGHT_DEBUG_PORT) {
    console.log('⚠️  PLAYWRIGHT_DEBUG_PORT not set, defaulting to 9222');
    process.env.PLAYWRIGHT_DEBUG_PORT = '9222';
  }
}

/**
 * Create a basic agent for testing
 */
function createTestAgent(): WebAgent {
  const model = process.env.MODEL!;
  const variableStore = new VariableStore();
  const context = createAgentContext({
    model,
    variableStore,
    testDataDir: '/tmp',
    organizationId: process.env.ORGANIZATION_ID,
  });
  console.log(`🤖 Agent created with model: ${model}`);
  return new WebAgent(context);
}

/**
 * Set up browser, context, page, and agent
 */
async function setupBrowser(): Promise<{ browserManager: BrowserManager; browserInstance: BrowserInstance; context: BrowserContext; page: Page; agent: WebAgent }> {
  ensureEnvironment();

  const debugPort = parseInt(process.env.PLAYWRIGHT_DEBUG_PORT || '9222', 10);
  const browserManager = new BrowserManager({ headless: false });
  const browserInstance = await browserManager.launchBrowser({ debugPort });

  const context = browserInstance.context;
  const page = await context.newPage();
  const agent = createTestAgent();

  return { browserManager, browserInstance, context, page, agent };
}

/**
 * Clean up browser resources
 */
async function cleanup(browserManager: BrowserManager, browserInstance: BrowserInstance) {
  await browserManager.terminateBrowser(browserInstance);
}

/**
 * Example 1: Multiple single actions in sequence using performAction
 */
async function example1_MultipleActions() {
  console.log('=== Example 1: Multiple Single Actions (performAction) ===\n');

  const { browserManager, browserInstance, page, agent } = await setupBrowser();
  let passed = true;

  try {
    await page.goto('https://www.wikipedia.org');
    console.log('📄 Loaded Wikipedia homepage');
    await page.waitForTimeout(2000);

    // Action 1: Search for something using performAction (single action)
    console.log('🤖 Step 1: Type "Playwright" into the search box...');
    const result = await agent.performAction(page, 'Type "Playwright" into the search box');
    console.log(`   Result: ${result.success ? '✅' : '❌'} ${result.details || ''}`);
    if (!result.success) passed = false;
    await page.waitForTimeout(1000);

    // Action 2: Submit the search using performAction (single action)
    console.log('🤖 Step 2: Press Enter to search...');
    const result2 = await agent.performAction(page, 'Press Enter to search');
    console.log(`   Result: ${result2.success ? '✅' : '❌'} ${result2.details || ''}`);
    if (!result2.success) passed = false;
    await page.waitForTimeout(2000);

    // Verification: Check URL contains "Playwright"
    const currentUrl = page.url();
    const urlContainsPlaywright = currentUrl.toLowerCase().includes('playwright');
    console.log(`\n📋 Verification:`);
    console.log(`   ${urlContainsPlaywright ? '✅' : '❌'} URL contains "Playwright": ${currentUrl}`);
    if (!urlContainsPlaywright) passed = false;

    console.log(`\n${passed ? '✅ PASSED' : '❌ FAILED'}: Example 1 - Multiple Single Actions`);

  } catch (error: any) {
    console.error('❌ Example failed:', error.message);
    passed = false;
  } finally {
    await cleanup(browserManager, browserInstance);
  }

  return passed;
}

/**
 * Example 2: Using assertions
 */
async function example2_Assertions() {
  console.log('\n=== Example 2: AI Assertions ===\n');

  const { browserManager, browserInstance, page, agent } = await setupBrowser();
  let passed = true;

  try {
    await page.goto('https://www.wikipedia.org');
    console.log('📄 Loaded Wikipedia homepage');
    await page.waitForTimeout(2000);

    // Make an assertion
    console.log('🤖 Asking AI to verify page content...');
    const result = await agent.assert(page, 'The page contains a search box');
    console.log(`   Result: ${result ? '✅' : '❌'} Search box assertion: ${result}`);
    if (!result) passed = false;

    // Make another assertion
    console.log('🤖 Checking if Wikipedia logo is visible...');
    const result2 = await agent.assert(page, 'The Wikipedia logo is visible on the page');
    console.log(`   Result: ${result2 ? '✅' : '❌'} Wikipedia logo assertion: ${result2}`);
    if (!result2) passed = false;

    console.log(`\n${passed ? '✅ PASSED' : '❌ FAILED'}: Example 2 - AI Assertions`);

  } catch (error: any) {
    console.error('❌ Example failed:', error.message);
    passed = false;
  } finally {
    await cleanup(browserManager, browserInstance);
  }

  return passed;
}

/**
 * Example 3: Using evaluate (condition checking without throwing)
 */
async function example3_Evaluate() {
  console.log('\n=== Example 3: AI Evaluate ===\n');

  const { browserManager, browserInstance, page, agent } = await setupBrowser();
  let passed = true;

  try {
    await page.goto('https://www.wikipedia.org');
    console.log('📄 Loaded Wikipedia homepage');
    await page.waitForTimeout(2000);

    // Evaluate conditions without throwing errors
    console.log('🤖 Checking various conditions...');

    const hasSearch = await agent.evaluate(page, 'There is a search box on the page');
    console.log(`   ${hasSearch ? '✅' : '❌'} Has search box: ${hasSearch}`);
    if (!hasSearch) passed = false;

    const hasLoginButton = await agent.evaluate(page, 'There is a login button visible');
    console.log(`   ℹ️  Has login button: ${hasLoginButton}`);  // May or may not be visible

    const isDarkMode = await agent.evaluate(page, 'The page is in dark mode');
    console.log(`   ℹ️  Is dark mode: ${isDarkMode}`);  // Expected to be false

    console.log(`\n${passed ? '✅ PASSED' : '❌ FAILED'}: Example 3 - AI Evaluate`);

  } catch (error: any) {
    console.error('❌ Example failed:', error.message);
    passed = false;
  } finally {
    await cleanup(browserManager, browserInstance);
  }

  return passed;
}

/**
 * Example 4: Using run (multi-step task)
 *
 * run() is for complex tasks that require multiple actions.
 * Use performAction() for single discrete actions.
 */
async function example4_Run() {
  console.log('\n=== Example 4: Multi-Step Task (run) ===\n');

  const { browserManager, browserInstance, page, agent } = await setupBrowser();
  let passed = true;

  try {
    await page.goto('https://www.wikipedia.org');
    console.log('📄 Loaded Wikipedia homepage');
    await page.waitForTimeout(2000);

    // Run a multi-step task - the agent will take multiple actions to complete
    console.log('🤖 Running multi-step task: "Search for Artificial Intelligence and click on the first result"...');
    const result = await agent.run(
      page,
      'Search for "Artificial Intelligence" and click on the first result'
    );

    console.log(`   Success: ${result.success ? '✅' : '❌'}`);
    console.log(`   Details: ${result.details}`);
    console.log(`   Actions executed: ${result.actions?.length || 0}`);
    if (!result.success) passed = false;

    if (result.actions && result.actions.length > 0) {
      console.log('\n   Actions taken:');
      result.actions.forEach((action, i) => {
        console.log(`     ${i + 1}. ${action.action_data?.action_name}: ${action.action_description || ''}`);
      });
    }

    // Verification: Check URL contains "Artificial" or "intelligence"
    const currentUrl = page.url().toLowerCase();
    const urlContainsAI = currentUrl.includes('artificial') || currentUrl.includes('intelligence');
    console.log(`\n📋 Verification:`);
    console.log(`   ${urlContainsAI ? '✅' : '❌'} URL contains AI topic: ${page.url()}`);
    if (!urlContainsAI) passed = false;

    console.log(`\n${passed ? '✅ PASSED' : '❌ FAILED'}: Example 4 - Multi-Step Task`);

  } catch (error: any) {
    console.error('❌ Example failed:', error.message);
    passed = false;
  } finally {
    await cleanup(browserManager, browserInstance);
  }

  return passed;
}

/**
 * Example 5: Using extract (AI-powered data extraction)
 */
async function example5_Extract() {
  console.log('\n=== Example 5: AI Extract (Data Extraction) ===\n');

  const { browserManager, browserInstance, page, agent } = await setupBrowser();
  let passed = true;

  try {
    await page.goto('https://www.wikipedia.org');
    console.log('📄 Loaded Wikipedia homepage');
    await page.waitForTimeout(2000);

    // Extract the page title
    console.log('🤖 Asking AI to extract the main heading...');
    await agent.extract(page, 'the main heading text', 'pageHeading');

    // Read the extracted value using variableStore
    const extractedHeading = agent._getContext().variableStore.get('pageHeading');
    const hasHeading = !!extractedHeading && extractedHeading.length > 0;
    console.log(`   ${hasHeading ? '✅' : '❌'} Extracted heading: "${extractedHeading}"`);
    if (!hasHeading) passed = false;

    // Extract another element
    console.log('🤖 Asking AI to extract the tagline...');
    await agent.extract(page, 'the tagline or subtitle below the logo', 'tagline');

    // Read the extracted value
    const extractedTagline = agent._getContext().variableStore.get('tagline');
    const hasTagline = !!extractedTagline && extractedTagline.length > 0;
    console.log(`   ${hasTagline ? '✅' : '❌'} Extracted tagline: "${extractedTagline}"`);
    if (!hasTagline) passed = false;

    console.log(`\n${passed ? '✅ PASSED' : '❌ FAILED'}: Example 5 - AI Extract`);

  } catch (error: any) {
    console.error('❌ Example failed:', error.message);
    passed = false;
  } finally {
    await cleanup(browserManager, browserInstance);
  }

  return passed;
}

/**
 * Example 6: Self-Healing Strategies
 *
 * Demonstrates self-healing with different maxSteps values:
 * - canSelfHeal=false: Disables self-healing (errors propagate immediately)
 * - maxSteps=1: Single-shot action generation (faster)
 * - maxSteps=5: Multi-step recovery (better recovery)
 *
 * Self-healing triggers when a cached/pre-defined action fails.
 * The agent.step() method wraps action execution and attempts recovery.
 *
 * Verification:
 * - canSelfHeal=false: No AI calls made (aiActionDetails empty), error thrown immediately
 * - maxSteps=1/5: AI calls made (aiActionDetails populated), may recover
 */
async function example6_SelfHealingStrategies() {
  console.log('\n=== Example 6: Self-Healing Strategies ===\n');

  const { browserManager, browserInstance, context } = await setupBrowserOnly();
  let allPassed = true;

  try {
    // --- Self-healing disabled (canSelfHeal=false) ---
    console.log('--- canSelfHeal=false (self-healing disabled) ---\n');
    {
      const page = await context.newPage();
      const agent = createTestAgent();

      await page.goto('https://www.wikipedia.org');
      console.log('📄 Loaded Wikipedia homepage');
      await page.waitForTimeout(1000);

      const aiActionsBefore = agent._getContext().aiActionDetails?.length ?? 0;

      // Use step() with canSelfHeal=false, any failure should propagate immediately
      let errorThrown = false;
      try {
        await agent.step(
          page,
          async () => {
            // This will fail - trying to click a non-existent element
            await page.click('#non-existent-button-12345', { timeout: 2000 });
          },
          'Click the search button',
          'step-none-1',
          undefined,
          false // canSelfHeal=false
        );
      } catch (error: any) {
        errorThrown = true;
        console.log(`   Error thrown: ${error.message.substring(0, 60)}...`);
      }

      const aiActionsAfter = agent._getContext().aiActionDetails?.length ?? 0;
      const aiCallsMade = aiActionsAfter - aiActionsBefore;

      // Verification: error should be thrown AND no AI calls should be made
      const nonePassedError = errorThrown;
      const nonePassedNoAI = aiCallsMade === 0;

      console.log(`\n   Verification:`);
      console.log(`   ${nonePassedError ? '✅' : '❌'} Error propagated immediately: ${errorThrown}`);
      console.log(`   ${nonePassedNoAI ? '✅' : '❌'} No AI calls made: ${aiCallsMade === 0} (calls: ${aiCallsMade})`);

      if (!nonePassedError || !nonePassedNoAI) allPassed = false;

      await page.close();
    }

    // --- maxSteps=1 (single-shot) ---
    console.log('\n--- maxSteps=1 (single-shot self-healing) ---\n');
    {
      const page = await context.newPage();
      const agent = createTestAgent();

      await page.goto('https://www.wikipedia.org');
      console.log('📄 Loaded Wikipedia homepage');
      await page.waitForTimeout(1000);

      const aiActionsBefore = agent._getContext().aiActionDetails?.length ?? 0;

      // With maxSteps=1, the agent will attempt one AI-generated action to recover
      let healingSucceeded = false;
      let resultActions: ActionEntity[] = [];
      try {
        const result = await agent.step(
          page,
          async () => {
            // This will fail - element doesn't exist
            await page.click('#non-existent-search-btn', { timeout: 2000 });
          },
          'Click the search input field',
          'step-single-1',
          undefined,
          true, // canSelfHeal=true
          1     // maxSteps=1
        );
        healingSucceeded = true;
        resultActions = result?.actions ?? [];
        console.log(`   Self-healing succeeded with ${resultActions.length} action(s)`);
      } catch (error: any) {
        console.log(`   Self-healing failed: ${error.message.substring(0, 60)}...`);
      }

      const aiActionsAfter = agent._getContext().aiActionDetails?.length ?? 0;
      const aiCallsMade = aiActionsAfter - aiActionsBefore;

      // Verification: AI calls SHOULD be made (self-healing attempted)
      const singlePassedAI = aiCallsMade > 0;

      console.log(`\n   Verification:`);
      console.log(`   ${singlePassedAI ? '✅' : '❌'} AI calls made (healing attempted): ${aiCallsMade > 0} (calls: ${aiCallsMade})`);
      console.log(`   ${healingSucceeded ? '✅' : '⚠️'} Self-healing result: ${healingSucceeded ? 'succeeded' : 'failed (expected for some cases)'}`);

      if (!singlePassedAI) allPassed = false;

      await page.close();
    }

    // --- maxSteps=5 (multi-step recovery) ---
    console.log('\n--- maxSteps=5 (multi-step self-healing) ---\n');
    {
      const page = await context.newPage();
      const agent = createTestAgent();

      await page.goto('https://www.wikipedia.org');
      console.log('📄 Loaded Wikipedia homepage');
      await page.waitForTimeout(1000);

      const aiActionsBefore = agent._getContext().aiActionDetails?.length ?? 0;

      // With maxSteps=5, the agent will attempt multi-step recovery
      // Use a complex task that requires MULTIPLE actions to complete
      let healingSucceeded = false;
      let resultActions: ActionEntity[] = [];
      try {
        const result = await agent.step(
          page,
          async () => {
            // This will fail - element doesn't exist
            await page.click('#complex-non-existent-element', { timeout: 2000 });
          },
          // Complex task requiring multiple steps: type + press enter
          'Type "Playwright" in the search box and press Enter to search',
          'step-multi-1',
          undefined,
          true, // canSelfHeal=true
          5     // maxSteps=5
        );
        healingSucceeded = true;
        resultActions = result?.actions ?? [];
        console.log(`   Self-healing succeeded with ${resultActions.length} action(s)`);
        if (resultActions.length > 0) {
          console.log(`   Actions performed:`);
          resultActions.forEach((action, i) => {
            console.log(`     ${i + 1}. ${action.action_data?.action_name}: ${action.action_description || ''}`);
          });
        }
      } catch (error: any) {
        console.log(`   Self-healing failed: ${error.message.substring(0, 60)}...`);
      }

      const aiActionsAfter = agent._getContext().aiActionDetails?.length ?? 0;
      const aiCallsMade = aiActionsAfter - aiActionsBefore;

      // Verification: AI calls SHOULD be made (self-healing attempted)
      // For multi-step, we expect potentially more than 1 action
      const multiPassedAI = aiCallsMade > 0;
      const multiUsedMultipleActions = resultActions.length > 1;

      console.log(`\n   Verification:`);
      console.log(`   ${multiPassedAI ? '✅' : '❌'} AI calls made (healing attempted): ${aiCallsMade > 0} (calls: ${aiCallsMade})`);
      console.log(`   ${multiUsedMultipleActions ? '✅' : '⚠️'} Multiple actions generated: ${resultActions.length > 1} (actions: ${resultActions.length})`);
      console.log(`   ${healingSucceeded ? '✅' : '⚠️'} Self-healing result: ${healingSucceeded ? 'succeeded' : 'failed (expected for some cases)'}`);

      if (!multiPassedAI) allPassed = false;

      await page.close();
    }

    console.log('\n' + '='.repeat(50));
    console.log(`${allPassed ? '✅ ALL VERIFICATIONS PASSED' : '❌ SOME VERIFICATIONS FAILED'}`);
    console.log('='.repeat(50));

    console.log('\n📝 Summary:');
    console.log('   canSelfHeal=false - No self-healing, errors propagate immediately (for debugging)');
    console.log('   maxSteps=1        - One-shot AI action generation (faster)');
    console.log('   maxSteps=3+       - Multi-step recovery (better recovery, default: 3)');

  } catch (error: any) {
    console.error('❌ Example failed:', error.message);
    allPassed = false;
  } finally {
    await cleanupBrowserOnly(browserManager, browserInstance);
  }

  return allPassed;
}

/**
 * Set up browser without creating agent (for examples that create multiple agents)
 */
async function setupBrowserOnly(): Promise<{ browserManager: BrowserManager; browserInstance: BrowserInstance; context: BrowserContext }> {
  ensureEnvironment();

  const debugPort = parseInt(process.env.PLAYWRIGHT_DEBUG_PORT || '9222', 10);
  const browserManager = new BrowserManager({ headless: false });
  const browserInstance = await browserManager.launchBrowser({ debugPort });

  return { browserManager, browserInstance, context: browserInstance.context };
}

/**
 * Clean up browser resources (without agent)
 */
async function cleanupBrowserOnly(browserManager: BrowserManager, browserInstance: BrowserInstance) {
  await browserManager.terminateBrowser(browserInstance);
}

// Main function to run examples
async function main() {
  const example = process.argv[2];

  switch (example) {
    case '1':
    case 'multiple':
      await example1_MultipleActions();
      break;
    case '2':
    case 'assert':
      await example2_Assertions();
      break;
    case '3':
    case 'evaluate':
      await example3_Evaluate();
      break;
    case '4':
    case 'run':
      await example4_Run();
      break;
    case '5':
    case 'extract':
      await example5_Extract();
      break;
    case '6':
    case 'selfhealing':
    case 'self-healing':
      await example6_SelfHealingStrategies();
      break;
    case 'all':
      const results: boolean[] = [];
      results.push(await example1_MultipleActions());
      results.push(await example2_Assertions());
      results.push(await example3_Evaluate());
      results.push(await example4_Run());
      results.push(await example5_Extract());
      results.push(await example6_SelfHealingStrategies());
      const allPassed = results.every(r => r);
      console.log('\n' + '='.repeat(50));
      console.log(`${allPassed ? '✅ ALL EXAMPLES PASSED' : '❌ SOME EXAMPLES FAILED'}`);
      console.log('='.repeat(50));
      break;
    default:
      console.log('Usage: pnpm tsx examples/agentExamples.ts <example>');
      console.log('\nAvailable examples:');
      console.log('  1 or multiple    - Execute multiple single actions using performAction()');
      console.log('  2 or assert      - Use assertions to verify page state');
      console.log('  3 or evaluate    - Evaluate conditions without throwing errors');
      console.log('  4 or run         - Run a multi-step task using run()');
      console.log('  5 or extract     - Extract data from page elements and save to variables');
      console.log('  6 or selfhealing - Demonstrate self-healing strategies (none/single/multi)');
      console.log('  all              - Run all examples');
      console.log('\nKey methods:');
      console.log('  performAction()  - Single action (calls executeStep directly)');
      console.log('  run()            - Multi-step task (runs until goal achieved)');
      console.log('\nEnvironment variables (.env file):');
      console.log('  MODEL                 - Model to use (default: gemini-2.5-pro)');
      console.log('                          Anthropic: claude-sonnet-4-6, claude-haiku-4-5, claude-opus-4-6');
      console.log('                          Google: gemini-2.5-pro, gemini-2.5-flash');
      console.log('  GOOGLE_API_KEY        - Google API key (for gemini-* models)');
      console.log('  ANTHROPIC_API_KEY     - Anthropic API key (for claude-* models)');
      console.log('  PLAYWRIGHT_DEBUG_PORT - CDP debug port (default: 9222)');
      console.log('\nExample:');
      console.log('  pnpm tsx examples/agentExamples.ts 1');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
