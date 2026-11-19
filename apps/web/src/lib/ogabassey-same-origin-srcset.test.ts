import { describe, expect, it } from 'vitest';
import { toOgabasseySameOriginSrcSet } from './ogabassey-same-origin-srcset';

describe('toOgabasseySameOriginSrcSet', () => {
  it('rewrites comma-separated srcset descriptors to /cdn-image/... while preserving width descriptors', () => {
    expect(
      toOgabasseySameOriginSrcSet(
        'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/tecno.avif 384w, https://cdn.ogabassey.com/image/width=750,quality=70,format=avif/core-assets/products/tecno.avif 750w'
      )
    ).toBe(
      '/cdn-image/width=384,quality=70,format=avif/core-assets/products/tecno.avif 384w, /cdn-image/width=750,quality=70,format=avif/core-assets/products/tecno.avif 750w'
    );
    expect(toOgabasseySameOriginSrcSet(null)).toBeNull();
    expect(toOgabasseySameOriginSrcSet(undefined)).toBeUndefined();
  });
});
