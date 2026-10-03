import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

describe('public product placeholder asset', () => {
  it('is a browser-decodable PNG with a complete pixel buffer', async () => {
    const image = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../public/placeholder.png'
      )
    );
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    expect(image.subarray(0, pngSignature.length)).toEqual(pngSignature);

    const metadata = await sharp(image).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(600);
    expect(metadata.height).toBe(600);

    const { data, info } = await sharp(image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info.channels).toBe(4);
    expect(data.length).toBe(info.width * info.height * info.channels);
  });
});
