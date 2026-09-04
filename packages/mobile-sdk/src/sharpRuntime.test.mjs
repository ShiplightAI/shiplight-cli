import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

test('mobile image annotation supports SVG composition and JPEG output', async () => {
  const image = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 4,
      background: { r: 32, g: 96, b: 160, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const overlay = Buffer.from(
    '<svg width="8" height="8"><rect x="2" y="2" width="4" height="4" fill="#ff0000"/></svg>',
  );

  const annotated = await sharp(image)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg()
    .toBuffer();
  const metadata = await sharp(annotated).metadata();

  assert.equal(metadata.width, 8);
  assert.equal(metadata.height, 8);
  assert.equal(metadata.format, 'jpeg');
});
