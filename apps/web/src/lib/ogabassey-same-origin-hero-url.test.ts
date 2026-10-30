import { describe, expect, it } from 'vitest';
import { toOgabasseySameOriginTransformUrl } from './ogabassey-same-origin-hero-url';

describe('toOgabasseySameOriginTransformUrl', () => {
  it('rewrites cdn.ogabassey.com transform URLs to /cdn-image/... while preserving non-CDN URLs', () => {
    expect(
      toOgabasseySameOriginTransformUrl(
        'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/tecno.avif'
      )
    ).toBe(
      '/cdn-image/width=384,quality=70,format=avif/core-assets/products/tecno.avif'
    );
    expect(
      toOgabasseySameOriginTransformUrl(
        '/cdn-image/width=384,quality=70,format=avif/core-assets/products/tecno.avif'
      )
    ).toBe(
      '/cdn-image/width=384,quality=70,format=avif/core-assets/products/tecno.avif'
    );
    expect(
      toOgabasseySameOriginTransformUrl('https://example.com/hero.jpg')
    ).toBe('https://example.com/hero.jpg');
  });

  it('returns the original URL when the decoded asset path or query string fails /cdn-image/ route validation', () => {
    const unsupportedBucket =
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/other-bucket/tecno.avif';
    expect(toOgabasseySameOriginTransformUrl(unsupportedBucket)).toBe(
      unsupportedBucket
    );

    const unsupportedQuery =
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/tecno.avif?token=secret';
    expect(toOgabasseySameOriginTransformUrl(unsupportedQuery)).toBe(
      unsupportedQuery
    );

    const duplicateVersionQuery =
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/tecno.avif?v=1&v=2';
    expect(toOgabasseySameOriginTransformUrl(duplicateVersionQuery)).toBe(
      duplicateVersionQuery
    );
  });
});
