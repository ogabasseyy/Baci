// @vitest-environment node

import sharp from 'sharp';
import { expect, it } from 'vitest';
import { normalizeDesignAsset } from './asset-service';

it('rejects remote/SVG/invalid image bytes and keeps reference media out of offline maps', async () => {
  await expect(
    normalizeDesignAsset({
      mime: 'image/svg+xml',
      bytes: Buffer.from('<svg/>'),
      alt: 'x',
    })
  ).rejects.toThrow('INVALID_REQUEST');
  await expect(
    normalizeDesignAsset({
      mime: 'image/png',
      bytes: Buffer.from('bad'),
      alt: 'x',
    })
  ).rejects.toThrow('INVALID_REQUEST');
});
it('bounds immutable focal metadata and strips image metadata before retaining bytes', async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#335577' },
  })
    .png()
    .withMetadata()
    .toBuffer();
  const result = await normalizeDesignAsset({
    mime: 'image/png',
    bytes: png,
    alt: 'Synthetic',
    focalPoint: { x: 0.2, y: 0.8 },
  });
  expect(result.focalPoint).toEqual({ x: 0.2, y: 0.8 });
  expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
  await expect(
    normalizeDesignAsset({
      mime: 'image/png',
      bytes: png,
      alt: 'Synthetic',
      focalPoint: { x: 2, y: 0.5 },
    })
  ).rejects.toThrow('INVALID_REQUEST');
});
