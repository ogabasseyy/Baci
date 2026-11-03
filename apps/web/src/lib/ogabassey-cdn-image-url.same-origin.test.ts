import { describe, expect, it } from 'vitest';
import { rewriteOgabasseyTransformUrlFormat } from './ogabassey-cdn-image-url';

describe('rewriteOgabasseyTransformUrlFormat for same-origin /cdn-image/ URLs', () => {
  it('rewrites only the format token of a proxy-backed transform URL', () => {
    expect(
      rewriteOgabasseyTransformUrlFormat(
        '/cdn-image/width=384,quality=70,format=jpeg/core-assets/products/phone.jpg',
        'avif'
      )
    ).toBe(
      '/cdn-image/width=384,quality=70,format=avif/core-assets/products/phone.jpg'
    );
  });

  it('preserves the ?v= version query on a proxy-backed transform URL', () => {
    expect(
      rewriteOgabasseyTransformUrlFormat(
        '/cdn-image/width=750,quality=70,format=png/core-assets/products/phone.png?v=abc123',
        'avif'
      )
    ).toBe(
      '/cdn-image/width=750,quality=70,format=avif/core-assets/products/phone.png?v=abc123'
    );
  });

  it('refuses format=auto, which the same-origin proxy does not accept', () => {
    expect(
      rewriteOgabasseyTransformUrlFormat(
        '/cdn-image/width=384,quality=70,format=jpeg/core-assets/products/phone.jpg',
        'auto'
      )
    ).toBeNull();
  });

  it('returns null for a proxy URL without an options segment or format token', () => {
    expect(
      rewriteOgabasseyTransformUrlFormat(
        '/cdn-image/core-assets/products/phone.jpg',
        'avif'
      )
    ).toBeNull();
    expect(
      rewriteOgabasseyTransformUrlFormat(
        '/cdn-image/width=384,quality=70/core-assets/products/phone.jpg',
        'avif'
      )
    ).toBeNull();
  });

  it('still returns null for other relative URLs', () => {
    expect(
      rewriteOgabasseyTransformUrlFormat('/images/placeholder.png', 'avif')
    ).toBeNull();
  });
});
