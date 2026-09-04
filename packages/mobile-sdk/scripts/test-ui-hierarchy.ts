/**
 * Test script for UI hierarchy extraction
 * Run with: npx tsx scripts/test-ui-hierarchy.ts
 */

import { AndroidDevice } from '../src/devices/android/device';

async function main() {
  const deviceId = process.env.ANDROID_DEVICE || 'emulator-5554';
  console.log(`Connecting to device: ${deviceId}`);

  const device = new AndroidDevice(deviceId);
  await device.connect();
  console.log('Connected!\n');

  // Test getting UI hierarchy using the new method
  console.log('Dumping UI hierarchy...');
  const startTime = Date.now();

  try {
    const xml = await device.getUiHierarchy();
    const elapsed = Date.now() - startTime;

    console.log(`Done in ${elapsed}ms`);
    console.log(`XML length: ${xml.length} characters\n`);

    // Print first 2000 chars to see structure
    console.log('=== XML Preview (first 2000 chars) ===');
    console.log(xml.substring(0, 2000));
    console.log('\n=== End Preview ===');

    // Count nodes
    const nodeCount = (xml.match(/<node /g) || []).length;
    console.log(`\nTotal nodes: ${nodeCount}`);

    // Count clickable nodes
    const clickableCount = (xml.match(/clickable="true"/g) || []).length;
    console.log(`Clickable nodes: ${clickableCount}`);

  } catch (error) {
    console.error('Failed to get UI hierarchy:', error);
  }

  await device.destroy();
  console.log('\nDevice disconnected');
}

main().catch(console.error);
