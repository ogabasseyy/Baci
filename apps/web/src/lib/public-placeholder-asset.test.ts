import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

describe('public product placeholder asset', () => {
  it('is a browser-decodable PNG with a complete pixel buffer', async () => {
    const image = readFileSync(
      resolve(process.cwd(), 'public/placeholder.png')
    );
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    expect(image.subarray(0, pngSignature.length)).toEqual(pngSignature);

    const metadata = await sharp(image).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);

    const { data, info } = await sharp(image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info.channels).toBe(4);
    expect(data.length).toBe(info.width * info.height * info.channels);
  });
});
