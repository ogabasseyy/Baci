import { describe, expect, it } from 'vitest';
import { createCatalogImageUrlResolver } from './catalog-image-url';

describe('createCatalogImageUrlResolver', () => {
  const resolve = createCatalogImageUrlResolver('https://mcp.ogabassey.com');

  it('normalizes legacy product paths and keeps cache-busting queries', () => {
    expect(resolve('https://cdn.ogabassey.com/products/phone.webp?v=2')).toBe(
      'https://mcp.ogabassey.com/images/core-assets/products/phone.webp?v=2'
    );
  });

  it('rejects external and non-product images', () => {
    expect(resolve('https://other.example/products/phone.webp')).toBeUndefined();
    expect(resolve('https://cdn.ogabassey.com/core-assets/banners/banner.webp')).toBeUndefined();
  });
});
