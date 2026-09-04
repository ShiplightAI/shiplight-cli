/**
 * Runner for basic-usage examples
 *
 * Usage:
 *   tsx src/actions/examples/run-examples.ts <example-name>
 *   tsx src/actions/examples/run-examples.ts --list
 *
 * Examples:
 *   tsx src/actions/examples/run-examples.ts example1_NavigationAndClick
 *   tsx src/actions/examples/run-examples.ts example2_FormFilling
 *   tsx src/actions/examples/run-examples.ts example6_Transpile
 */

import {
  example1_Navigation,
  example2_FormFilling,
  example3_KeyboardInput,
  example4_MouseInteractions,
  example5_TabManagement,
  example6_ScrollActions,
  example7_Transpile,
} from './basicUsage';

import {
  example1_FileOperations,
  example2_TabManagement,
  example3_CustomJavaScript,
  example4_DragAndDrop,
  example5_AdvancedMouse,
  example6_ErrorHandling,
  example7_ComplexWorkflow,
} from './advancedUsage';

import {
  example1_Generate2faCode,
  example2_MultipleActions,
  example3_LiveBrowserTest,
  example4_ClickAndFill,
  example5_ScrollActions,
  example6_TabManagement as example6_TabManagementTranspile,
  example7_CompleteUserFlow,
} from './transpileAndExecute';

// Map of example names to functions
const examples: Record<string, () => Promise<void>> = {
  // Basic usage examples
  example1_Navigation,
  example2_FormFilling,
  example3_KeyboardInput,
  example4_MouseInteractions,
  example5_TabManagement,
  example6_ScrollActions,
  example7_Transpile,

  // Advanced usage examples
  example1_FileOperations,
  example2_TabManagement,
  example3_CustomJavaScript,
  example4_DragAndDrop,
  example5_AdvancedMouse,
  example6_ErrorHandling,
  example7_ComplexWorkflow,

  // Transpile and Execute examples
  transpile1_Generate2faCode: example1_Generate2faCode,
  transpile2_MultipleActions: example2_MultipleActions,
  transpile3_LiveBrowserTest: example3_LiveBrowserTest,
  transpile4_ClickAndFill: example4_ClickAndFill,
  transpile5_ScrollActions: example5_ScrollActions,
  transpile6_TabManagement: example6_TabManagementTranspile,
  transpile7_CompleteUserFlow: example7_CompleteUserFlow,
};

function showUsage() {
  console.log('Usage: tsx src/actions/examples/run-examples.ts <example-name>');
  console.log('\nAvailable examples:');
  console.log('\nBasic Usage:');
  console.log('  example1_Navigation          - Navigation actions (go_to_url, go_back, reload, wait, done)');
  console.log('  example2_FormFilling         - Form filling with dropdown selection');
  console.log('  example3_KeyboardInput       - Keyboard and input actions (fill, clear, press, etc.)');
  console.log('  example4_MouseInteractions   - Mouse actions (hover, click, right-click, move)');
  console.log('  example5_TabManagement       - Tab operations (open, switch, close)');
  console.log('  example6_ScrollActions       - Scroll actions (scroll_down, scroll_up, scroll_to_text, etc.)');
  console.log('  example7_Transpile           - Transpile actions to Playwright code');
  console.log('\nAdvanced Usage:');
  console.log('  example1_FileOperations      - File upload and download');
  console.log('  example2_TabManagement       - Multi-tab management');
  console.log('  example3_CustomJavaScript    - Custom JavaScript execution');
  console.log('  example4_DragAndDrop         - Drag and drop operations');
  console.log('  example5_AdvancedMouse       - Advanced mouse actions');
  console.log('  example6_ErrorHandling       - Error handling and recovery');
  console.log('  example7_ComplexWorkflow     - Complete e-commerce checkout flow');
  console.log('\nTranspile and Execute:');
  console.log('  transpile1_Generate2faCode   - Transpile and execute 2FA code generation');
  console.log('  transpile2_MultipleActions   - Transpile and execute action sequence');
  console.log('  transpile3_LiveBrowserTest   - Transpile and execute in live browser');
  console.log('  transpile4_ClickAndFill      - Transpile and execute form interactions');
  console.log('  transpile5_ScrollActions     - Transpile and execute scroll operations');
  console.log('  transpile6_TabManagement     - Transpile and execute tab management');
  console.log('  transpile7_CompleteUserFlow  - Transpile and execute complete workflow');
  console.log('\nOptions:');
  console.log('  --list                       - List all available examples');
  console.log('  --help                       - Show this help message');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    showUsage();
    return;
  }

  if (args[0] === '--list') {
    console.log('Available examples:\n');
    Object.keys(examples).forEach((name) => {
      console.log(`  ${name}`);
    });
    return;
  }

  const exampleName = args[0];
  const exampleFn = examples[exampleName];

  if (!exampleFn) {
    console.error(`Error: Unknown example '${exampleName}'`);
    console.error('\nRun with --list to see available examples');
    process.exit(1);
  }

  console.log(`=== Running ${exampleName} ===\n`);

  try {
    await exampleFn();
    console.log(`\n✓ ${exampleName} completed successfully`);
  } catch (error) {
    console.error(`✗ ${exampleName} failed:`, error);
    process.exit(1);
  }
}

main();
