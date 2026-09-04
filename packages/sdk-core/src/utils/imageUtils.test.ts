import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { pngToRawPixels, generateGrayscaleFromPng, sliceScreenshot } from './imageUtils';

function assertVersionAtLeast(actual: string, minimum: [number, number, number]): void {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(actual);
  assert.notEqual(match, null, `expected a semantic version, received ${actual}`);
  const parts = match.slice(1).map(Number);

  for (let index = 0; index < minimum.length; index += 1) {
    if (parts[index] > minimum[index]) {
      return;
    }
    if (parts[index] < minimum[index]) {
      assert.fail(`${actual} is older than ${minimum.join('.')}`);
    }
  }
}

test('patched Sharp runtime supports the SDK screenshot operations', async () => {
  assertVersionAtLeast(sharp.versions.sharp, [0, 35, 0]);
  assertVersionAtLeast(sharp.versions.vips, [8, 18, 3]);

  const screenshot = await sharp({
    create: {
      width: 8,
      height: 4,
      channels: 4,
      background: { r: 32, g: 96, b: 160, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const slices = await sliceScreenshot(screenshot, { resize: true });
  assert.equal(slices.length, 3);
  for (const slice of slices) {
    const metadata = await sharp(slice).metadata();
    assert.equal(metadata.width, 768);
    assert.equal(metadata.height, 768);
    assert.equal(metadata.format, 'png');
    const firstPixel = await sharp(slice).ensureAlpha().raw().toBuffer();
    assert.deepEqual([...firstPixel.subarray(0, 4)], [32, 96, 160, 255]);
  }

  const raw = await pngToRawPixels(screenshot);
  assert.equal(raw.width, 8);
  assert.equal(raw.height, 4);
  assert.equal(raw.data.length, 8 * 4 * 4);

  const grayscale = await generateGrayscaleFromPng(screenshot);
  assert.equal(grayscale.width, 8);
  assert.equal(grayscale.height, 4);
  assert.equal(grayscale.pixels.length, 4);
  assert.ok(grayscale.pixels.every((row) => row.length === 8));
  assert.ok(grayscale.pixels.every((row) => row.every((pixel) => pixel === 94)));
});
