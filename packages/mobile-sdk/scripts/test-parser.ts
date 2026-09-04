/**
 * Test script for UI hierarchy parser
 * Run with: npx tsx scripts/test-parser.ts
 */

import { AndroidDevice } from '../src/devices/android/device';
import { parseUiHierarchy } from '../src/elements/parseUiHierarchy';
import { getElementCenter } from '../src/elements/types';

async function main() {
  const deviceId = process.env.ANDROID_DEVICE || 'emulator-5554';
  console.log(`Connecting to device: ${deviceId}`);

  const device = new AndroidDevice(deviceId);
  await device.connect();
  console.log('Connected!\n');

  try {
    // Get UI hierarchy
    console.log('Getting UI hierarchy...');
    const startTime = Date.now();
    const xml = await device.getUiHierarchy();
    const xmlTime = Date.now() - startTime;

    // Parse the hierarchy
    const parseStart = Date.now();
    const result = parseUiHierarchy(xml);
    const parseTime = Date.now() - parseStart;

    console.log(`\n=== Extraction Results ===`);
    console.log(`XML fetch time: ${xmlTime}ms`);
    console.log(`Parse time: ${parseTime}ms`);
    console.log(`Total nodes in hierarchy: ${result.totalNodes}`);
    console.log(`Interactive elements: ${result.elements.length}`);

    console.log(`\n=== Interactive Elements ===`);
    for (const element of result.elements) {
      const center = getElementCenter(element.bounds);
      const label = element.text || element.contentDesc || element.resourceId || '(no label)';
      const boundsStr = `[${element.bounds.left},${element.bounds.top}][${element.bounds.right},${element.bounds.bottom}]`;

      console.log(
        `[${element.index}] ${element.displayType} ` +
        `text="${label}" ` +
        `bounds=${boundsStr} ` +
        `center=(${center.x},${center.y})` +
        (element.clickable ? ' (clickable)' : '') +
        (element.scrollable ? ' (scrollable)' : '')
      );
    }

    // Test: verify we can find elements by common patterns
    console.log(`\n=== Element Search Test ===`);

    const elementsWithText = result.elements.filter(e => e.text);
    console.log(`Elements with text: ${elementsWithText.length}`);

    const clickableElements = result.elements.filter(e => e.clickable);
    console.log(`Clickable elements: ${clickableElements.length}`);

    const scrollableElements = result.elements.filter(e => e.scrollable);
    console.log(`Scrollable elements: ${scrollableElements.length}`);

  } catch (error) {
    console.error('Error:', error);
  }

  await device.destroy();
  console.log('\nDevice disconnected');
}

main().catch(console.error);
