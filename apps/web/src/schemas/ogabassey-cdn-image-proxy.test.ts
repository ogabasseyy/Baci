import { describe, expect, it } from 'vitest';
import {
  ogabasseyCdnImageProxyPathSchema,
  ogabasseyCdnImageProxySearchParamsSchema,
} from './ogabassey-cdn-image-proxy';

describe('ogabasseyCdnImageProxyPathSchema', () => {
  it('accepts a valid transform segment followed by allowed asset path segments', () => {
    const result = ogabasseyCdnImageProxyPathSchema.safeParse([
      'width=384,quality=70,format=avif',
      'core-assets',
      'products',
      'tecno.avif',
    ]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        assetPath: 'core-assets/products/tecno.avif',
        options: {
          fit: 'inside',
          format: 'avif',
          quality: 70,
          width: 384,
        },
      });
    }
  });

  it('rejects paths with fewer than three segments, traversal tokens, or untrusted roots', () => {
    expect(
      ogabasseyCdnImageProxyPathSchema.safeParse([
        'width=384,quality=70,format=avif',
      ]).success
    ).toBe(false);
    expect(
      ogabasseyCdnImageProxyPathSchema.safeParse([
        'width=384,quality=70,format=avif',
        'core-assets',
        '..',
        'tecno.avif',
      ]).success
    ).toBe(false);
    expect(
      ogabasseyCdnImageProxyPathSchema.safeParse([
        'width=384,quality=70,format=avif',
        'other-bucket',
        'products',
        'tecno.avif',
      ]).success
    ).toBe(false);
  });

  it('allowlists only a bounded v query parameter', () => {
    expect(ogabasseyCdnImageProxySearchParamsSchema.safeParse({}).success).toBe(
      true
    );
    expect(
      ogabasseyCdnImageProxySearchParamsSchema.safeParse({ v: '20260927' })
        .success
    ).toBe(true);
    expect(
      ogabasseyCdnImageProxySearchParamsSchema.safeParse({ bust: '1' }).success
    ).toBe(false);
  });
});
