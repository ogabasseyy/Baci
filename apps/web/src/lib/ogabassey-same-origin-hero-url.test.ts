import { describe, expect, it } from 'vitest';
import {
  OGABASSEY_SAME_ORIGIN_IMAGE_TRANSFORM_PREFIX,
  toOgabasseySameOriginSrcSet,
  toOgabasseySameOriginTransformUrl,
} from './ogabassey-same-origin-hero-url';

describe('ogabassey-same-origin-hero-url', () => {
  it('rewrites cdn.ogabassey.com/image/ URLs to /cdn-image/', () => {
    expect(OGABASSEY_SAME_ORIGIN_IMAGE_TRANSFORM_PREFIX).toBe('/cdn-image/');
    expect(
      toOgabasseySameOriginTransformUrl(
        'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/tecno.avif'
      )
    ).toBe(
      '/cdn-image/width=384,quality=70,format=avif/core-assets/products/tecno.avif'
    );
  });

  it('leaves non-transform URLs unchanged and rewrites every candidate in a srcset', () => {
    expect(
      toOgabasseySameOriginTransformUrl('https://example.com/hero.jpg')
    ).toBe('https://example.com/hero.jpg');
    expect(
      toOgabasseySameOriginSrcSet(
        'https://cdn.ogabassey.com/image/width=256,quality=70,format=avif/core-assets/products/tecno.avif 256w, https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/tecno.avif 384w'
      )
    ).toBe(
      '/cdn-image/width=256,quality=70,format=avif/core-assets/products/tecno.avif 256w, /cdn-image/width=384,quality=70,format=avif/core-assets/products/tecno.avif 384w'
    );
  });
});
