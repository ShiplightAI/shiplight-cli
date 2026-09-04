/**
 * Test script for AndroidElementService
 * Run with: npx tsx scripts/test-element-service.ts
 */

import { AndroidDevice } from '../src/devices/android/device';
import { AndroidElementService } from '../src/elements/AndroidElementService';

async function main() {
  const deviceId = process.env.ANDROID_DEVICE || 'emulator-5554';
  console.log(`Connecting to device: ${deviceId}`);

  const device = new AndroidDevice(deviceId);
  await device.connect();
  console.log('Connected!\n');

  // Create element service
  const elementService = new AndroidElementService(device);

  try {
    // Extract elements
    console.log('Extracting elements...');
    const result = await elementService.getElements();

    console.log(`\n=== Extraction Results ===`);
    console.log(`Total nodes: ${result.totalNodes}`);
    console.log(`Interactive elements: ${result.interactiveCount}`);
    console.log(`Extraction time: ${result.extractionTimeMs}ms`);

    console.log(`\n=== Element Tree String (for LLM) ===`);
    console.log(result.elementTreeString);

    // Test coordinate lookup
    console.log(`\n=== Coordinate Lookup Test ===`);
    for (let i = 0; i < Math.min(3, result.elements.length); i++) {
      const coords = elementService.getElementCoordinates(i);
      const element = elementService.getElement(i);
      if (coords && element) {
        console.log(`Element [${i}] "${element.text || element.contentDesc || 'no label'}" -> center: (${coords.x}, ${coords.y})`);
      }
    }

    // Test stale check
    console.log(`\n=== Cache Status ===`);
    console.log(`Is stale (5s threshold): ${elementService.isStale(5000)}`);
    console.log(`Is stale (0s threshold): ${elementService.isStale(0)}`);

    // Simulate what agent would do
    console.log(`\n=== Simulated Agent Flow ===`);
    console.log('1. Agent receives screenshot + element tree string');
    console.log('2. Agent decides to tap element [5] (example)');

    const targetIndex = Math.min(5, result.elements.length - 1);
    const targetCoords = elementService.getElementCoordinates(targetIndex);
    const targetElement = elementService.getElement(targetIndex);

    if (targetCoords && targetElement) {
      console.log(`3. Resolved [${targetIndex}] "${targetElement.text || targetElement.contentDesc}" to (${targetCoords.x}, ${targetCoords.y})`);
      console.log(`4. Would call: device.tap(${targetCoords.x}, ${targetCoords.y})`);
    }

  } catch (error) {
    console.error('Error:', error);
  }

  await device.destroy();
  console.log('\nDevice disconnected');
}

main().catch(console.error);
