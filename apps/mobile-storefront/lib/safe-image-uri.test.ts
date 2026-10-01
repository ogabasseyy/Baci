import { resolveSafeImageUri } from './safe-image-uri';

describe('resolveSafeImageUri', () => {
  it('uses an alpha-capable WebP transform for managed PNG product assets', () => {
    expect(
      resolveSafeImageUri(
        'https://cdn.ogabassey.com/core-assets/products/logo.png?version=2#alpha',
        { height: 48, width: 64 }
      )
    ).toBe(
      'https://cdn.ogabassey.com/image/width=64,height=48,quality=82,format=webp/core-assets/products/logo.png?version=2#alpha'
    );
  });

  it('flattens managed WebP product assets to a static JPEG fallback', () => {
    expect(
      resolveSafeImageUri(
        'https://cdn.ogabassey.com/core-assets/products/animated-product.webp',
        { height: 160, width: 160 }
      )
    ).toBe(
      'https://cdn.ogabassey.com/image/width=160,height=160,quality=82,format=jpeg/core-assets/products/animated-product.webp'
    );
  });

  it('normalizes legacy managed product paths without changing other hosts', () => {
    expect(
      resolveSafeImageUri('https://cdn.ogabassey.com/products/phone.avif', {
        width: 240,
      })
    ).toBe(
      'https://cdn.ogabassey.com/image/width=240,quality=82,format=webp/core-assets/products/phone.avif'
    );
    expect(
      resolveSafeImageUri('https://images.example.com/products/phone.avif', {
        width: 240,
      })
    ).toBe('https://images.example.com/products/phone.avif');
  });

  it('preserves cover semantics in managed CDN transforms', () => {
    expect(
      resolveSafeImageUri('https://cdn.ogabassey.com/products/phone.avif', {
        fit: 'cover',
        height: 120,
        width: 240,
      })
    ).toBe(
      'https://cdn.ogabassey.com/image/width=240,height=120,quality=82,format=webp,fit=cover/core-assets/products/phone.avif'
    );
  });
});
