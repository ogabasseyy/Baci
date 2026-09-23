import { describe, expect, it } from 'vitest';
import { IMMUTABLE_NEXT_STATIC_ASSET_HEADERS } from './next-static-asset-headers';

describe('IMMUTABLE_NEXT_STATIC_ASSET_HEADERS', () => {
  it('targets hashed Next static assets with an immutable year cache', () => {
    expect(IMMUTABLE_NEXT_STATIC_ASSET_HEADERS).toEqual({
      source: '/_next/static/:path*',
      headers: [
        {
          key: 'Cache-Control',
          value: 'public, max-age=31536000, immutable',
        },
      ],
    });
  });
});
