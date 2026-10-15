import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { pngDimensions } from './merchant-image-pilot-settings-png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GENERATOR_FIXTURES = join(
  here,
  '..',
  '..',
  '..',
  '..',
  'infra',
  'cdn-transformer',
  'pilot',
  'fixtures'
);

function fixturePng() {
  return readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));
}

describe('merchant-image-pilot-settings-png', () => {
  it('reads PNG dimensions from a fully validated file', async () => {
    expect(pngDimensions(await fixturePng())).toEqual({
      height: 48,
      width: 48,
    });
    expect(() => pngDimensions(Buffer.alloc(33, 0))).toThrow('not a PNG');
  });

  it('rejects truncated, corrupted, and padded screenshots', async () => {
    const full = await fixturePng();
    expect(() => pngDimensions(full.subarray(0, 24))).toThrow(
      'PNG is truncated'
    );
    expect(() => pngDimensions(full.subarray(0, full.length - 10))).toThrow(
      'PNG is truncated'
    );
    const corrupted = Buffer.from(full);
    corrupted[corrupted.length - 20] ^= 0xff;
    expect(() => pngDimensions(corrupted)).toThrow(/failed its CRC check/);
    expect(() =>
      pngDimensions(Buffer.concat([full, Buffer.from([0])]))
    ).toThrow('trailing bytes after IEND');
  });

  it('rejects pixel-less and zero-dimension PNGs with valid CRCs', () => {
    const chunk = (type, data) => {
      const body = Buffer.concat([
        Buffer.from(type, 'latin1'),
        Buffer.from(data),
      ]);
      const head = Buffer.alloc(4);
      head.writeUInt32BE(data.length, 0);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body) >>> 0, 0);
      return Buffer.concat([head, body, crc]);
    };
    const signature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const ihdr = (width, height) => {
      const data = Buffer.alloc(13);
      data.writeUInt32BE(width, 0);
      data.writeUInt32BE(height, 4);
      data[8] = 8;
      data[9] = 2;
      return chunk('IHDR', data);
    };
    const iend = chunk('IEND', []);
    expect(() =>
      pngDimensions(Buffer.concat([signature, ihdr(48, 48), iend]))
    ).toThrow('no image data (IDAT)');
    expect(() =>
      pngDimensions(Buffer.concat([signature, ihdr(0, 48), iend]))
    ).toThrow('dimensions must be positive');
    expect(() =>
      pngDimensions(Buffer.concat([signature, ihdr(48, 0), iend]))
    ).toThrow('dimensions must be positive');
  });
});
