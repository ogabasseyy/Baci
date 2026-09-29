import { vi } from 'vitest';

export const FAKE_BAKE_SOURCE_URL =
  'https://cdn.ogabassey.com/core-assets/products/dell.jpg';

export function makeFakeBakeFetch() {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    url: FAKE_BAKE_SOURCE_URL,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => Buffer.from('fake-source-bytes'),
  }));
}

// Faithful-enough sharp double: metadata reports the source width for
// buffers and parses the baked width back out of managed filenames.
export function makeFakeSharp({
  bakedWidth = null,
  calls = null,
  encodeTag = 'v1',
  orientation = undefined,
  sourceHeight = 1600,
  sourceWidth = 1600,
} = {}) {
  return (input) => {
    const chain = {
      _width: null,
      rotate() {
        calls?.push('rotate');
        return chain;
      },
      resize({ width }) {
        calls?.push('resize');
        chain._width = width;
        return chain;
      },
      avif() {
        return chain;
      },
      async toBuffer() {
        return Buffer.from(`fake-avif-${encodeTag}-${chain._width}`);
      },
      async metadata() {
        if (Buffer.isBuffer(input)) {
          return {
            width: sourceWidth,
            height: sourceHeight,
            format: 'jpeg',
            orientation,
          };
        }
        const match = String(input).match(/-(\d+)\.avif$/);
        return {
          width: bakedWidth ?? (match ? Number(match[1]) : 0),
          format: 'heif',
        };
      },
    };
    return chain;
  };
}
