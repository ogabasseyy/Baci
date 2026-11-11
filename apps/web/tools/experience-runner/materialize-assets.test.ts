import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { materializeAssets } from './materialize-assets';

const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
async function png() {
  return sharp({
    create: { width: 32, height: 24, channels: 3, background: '#4466aa' },
  })
    .png()
    .toBuffer();
}
describe('offline immutable asset admission', () => {
  it('materializes decoded image and font bytes without URLs or read tickets', async () => {
    const image = await png();
    const font = readFileSync('public/fonts/inter-naira.61440e0f45d4.woff2');
    const refs = [
      {
        assetId: 'synthetic-image',
        digest: digest(image),
        mime: 'image/png' as const,
      },
      {
        assetId: 'synthetic-font',
        digest: digest(font),
        mime: 'font/woff2' as const,
      },
    ];
    const output = await materializeAssets(refs, async (id) =>
      id === 'synthetic-image' ? image : font
    );
    expect(output[0]).toMatchObject({
      width: 32,
      height: 24,
      digest: digest(image),
    });
    expect(output[1].bytesBase64).toBe(font.toString('base64'));
    expect(JSON.stringify(output)).not.toMatch(/https:|ticket|authorization/i);
  });
  it('rejects missing, changed, duplicate and source-selected URL assets', async () => {
    const image = await png();
    const ref = {
      assetId: 'image',
      digest: digest(image),
      mime: 'image/png' as const,
    };
    await expect(materializeAssets([ref], async () => null)).rejects.toThrow(
      'Missing'
    );
    await expect(
      materializeAssets([{ ...ref, digest: '0'.repeat(64) }], async () => image)
    ).rejects.toThrow('digest');
    await expect(
      materializeAssets([ref, ref], async () => image)
    ).rejects.toThrow('Duplicate');
    await expect(
      materializeAssets(
        [{ ...ref, assetId: 'https://private.invalid/image' }],
        async () => image
      )
    ).rejects.toThrow('identity');
  });
  it('rejects corrupt media, misleading MIME, decompression and byte budgets', async () => {
    const bytes = Buffer.from('<svg onload="fetch()"/>');
    await expect(
      materializeAssets(
        [{ assetId: 'x', digest: digest(bytes), mime: 'image/png' }],
        async () => bytes
      )
    ).rejects.toThrow();
    const large = await sharp({
      create: { width: 2100, height: 2100, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(
      materializeAssets(
        [{ assetId: 'x', digest: digest(large), mime: 'image/png' }],
        async () => large
      )
    ).rejects.toThrow();
    const huge = Buffer.alloc(2 * 1024 * 1024 + 1);
    await expect(
      materializeAssets(
        [{ assetId: 'x', digest: digest(huge), mime: 'image/png' }],
        async () => huge
      )
    ).rejects.toThrow('byte');
  });
});
