/**
 * End-to-end test for tap_element action
 * Demonstrates the full flow: extract elements -> set context -> tap by index
 *
 * Run with: npx tsx scripts/test-tap-element.ts
 */

import { AndroidDevice } from '../src/devices/android/device';
import { AndroidElementService } from '../src/elements/AndroidElementService';
import { ActionExecutor } from '../src/ai/actionExecutor';
import { MobileActionType } from '../src/ai/types';

async function main() {
  const deviceId = process.env.ANDROID_DEVICE || 'emulator-5554';
  console.log(`Connecting to device: ${deviceId}`);

  const device = new AndroidDevice(deviceId);
  await device.connect();
  console.log('Connected!\n');

  // Create services
  const elementService = new AndroidElementService(device);
  const actionExecutor = new ActionExecutor(device);

  try {
    // Step 1: Go to home screen to have a known state
    console.log('=== Step 1: Go to home screen ===');
    await device.home();
    await sleep(1000);

    // Step 2: Extract elements
    console.log('\n=== Step 2: Extract elements ===');
    const result = await elementService.getElements();

    console.log(`Total nodes: ${result.totalNodes}`);
    console.log(`Interactive elements: ${result.interactiveCount}`);
    console.log(`\nElement tree:\n${result.elementTreeString}`);

    // Step 3: Set element context on executor
    console.log('\n=== Step 3: Set element context ===');
    actionExecutor.setElementContext(result.elements);
    console.log(`Context set with ${result.elements.length} elements`);

    // Step 4: Find Chrome element and tap it
    console.log('\n=== Step 4: Find and tap Chrome ===');
    const chromeElement = result.elements.find(e =>
      e.text.toLowerCase().includes('chrome') ||
      e.contentDesc.toLowerCase().includes('chrome')
    );

    if (chromeElement) {
      console.log(`Found Chrome at index [${chromeElement.index}]`);
      console.log(`Text: "${chromeElement.text}", ContentDesc: "${chromeElement.contentDesc}"`);
      console.log(`Bounds: [${chromeElement.bounds.left},${chromeElement.bounds.top}][${chromeElement.bounds.right},${chromeElement.bounds.bottom}]`);

      // Create tap_element action
      const tapAction = {
        type: MobileActionType.TAP_ELEMENT,
        parameters: { element_index: chromeElement.index },
      };

      console.log(`\nExecuting: ${JSON.stringify(tapAction)}`);
      const actionResult = await actionExecutor.execute(tapAction);

      console.log(`\nResult: ${actionResult.success ? 'SUCCESS' : 'FAILED'}`);
      console.log(`Message: ${actionResult.message}`);
      console.log(`Duration: ${actionResult.duration}ms`);

      // Wait for Chrome to open
      await sleep(2000);

      // Step 5: Extract elements again to verify screen changed
      console.log('\n=== Step 5: Verify screen changed ===');
      const newResult = await elementService.getElements();
      console.log(`New element tree:\n${newResult.elementTreeString}`);

      // Check if we're now in Chrome
      const chromeIndicators = newResult.elements.filter(e =>
        e.packageName?.includes('chrome') ||
        e.resourceId?.includes('chrome') ||
        e.text?.includes('Search or type') ||
        e.contentDesc?.includes('Search')
      );

      if (chromeIndicators.length > 0) {
        console.log(`\n✅ Successfully opened Chrome! Found ${chromeIndicators.length} Chrome-related elements.`);
      } else {
        console.log('\n⚠️ Could not verify Chrome opened (element detection may vary)');
      }

    } else {
      console.log('Chrome element not found on home screen.');
      console.log('Available elements with text:', result.elements.filter(e => e.text).map(e => e.text));
    }

    // Step 6: Go back to home
    console.log('\n=== Step 6: Return to home ===');
    await device.home();

  } catch (error) {
    console.error('Error:', error);
  }

  await device.destroy();
  console.log('\nDevice disconnected');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
