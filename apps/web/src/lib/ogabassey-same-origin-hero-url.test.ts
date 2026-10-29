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
});
