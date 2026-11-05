// @vitest-environment node
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { createVisualEvidence } from './visual-evidence';

it('keeps bounded native image bytes and hashes, not a URL-only result', async () => {
  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#335577' },
  })
    .png()
    .toBuffer();
  const result = await createVisualEvidence(png, {
    build: 'b',
    assets: 'a',
    catalog: 'c',
    path: '/',
  });
  expect(result.mime).toBe('image/png');
  expect(result.bytes.length).toBeLessThan(2097152);
  expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
  await expect(
    createVisualEvidence(Buffer.from('invalid'), {
      build: 'b',
      assets: 'a',
      catalog: 'c',
      path: '/',
    })
  ).rejects.toThrow();
});
