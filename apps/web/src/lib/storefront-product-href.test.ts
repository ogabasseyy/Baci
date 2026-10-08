import { describe, expect, it } from 'vitest';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';

describe('getStorefrontProductHref', () => {
  it('omits the base path when it is root', () => {
    expect(
      getStorefrontProductHref(
        {
          id: 'p1',
          name: 'iPhone 15 Pro Max',
          slug: 'iphone-15-pro-max',
          categories: { slug: 'smartphones' },
        },
        '/'
      )
    ).toBe('/smartphones/iphone-15-pro-max');
  });

  it('builds a category canonical href when slug data is available', () => {
    expect(
      getStorefrontProductHref(
        {
          id: 'p1',
          name: 'iPhone 15 Pro Max',
          slug: 'iphone-15-pro-max',
          categories: { slug: 'smartphones' },
        },
        '/ogabassey'
      )
    ).toBe('/ogabassey/smartphones/iphone-15-pro-max');
  });

  it('preserves the stored category slug verbatim (no alias remap)', () => {
    // Regression: previously the canonical path builder remapped legacy
    // aliases such as `samsung` -> `smartphones`. That caused a permanent
    // self-redirect loop because the product route compares the raw DB
    // `category_slug` to the URL segment and redirects on mismatch
    // (apps/web/src/app/(storefront)/[slug]/(catalog)/[category]/[productSlug]/page.tsx).
    // The canonical URL must therefore match the DB slug exactly.
    expect(
      getStorefrontProductHref(
        {
          id: 'p1',
          name: 'Samsung Galaxy S25 Ultra',
          slug: 'samsung-galaxy-s25-ultra-12gb-512gb',
          categories: { slug: 'samsung' },
        },
        '/ogabassey'
      )
    ).toBe('/ogabassey/samsung/samsung-galaxy-s25-ultra-12gb-512gb');
  });

  it('falls back to the products route when category data is unavailable', () => {
    expect(
      getStorefrontProductHref(
        {
          id: 'p1',
          name: 'Test Product',
        },
        '/ogabassey'
      )
    ).toBe('/ogabassey/products/test-product');
  });

  it('prefers canonical_url over legacy category path fields', () => {
    expect(
      getStorefrontProductHref(
        {
          id: 'p1',
          name: 'Nintendo Switch OLED',
          slug: 'nintendo-switch-oled-8gb-512gb',
          categories: { slug: 'nintendo-switch' },
          canonical_url:
            'https://usebaci.com/ogabassey/gaming/nintendo-switch-oled',
        },
        '/ogabassey'
      )
    ).toBe('/ogabassey/gaming/nintendo-switch-oled');
  });

  it('preserves the canonical_url category segment without alias remapping', () => {
    // Regression: merchant-authored canonical URLs with legacy slugs must be
    // returned verbatim so they match the stored `category_slug`. Remapping
    // `samsung` -> `smartphones` here would cause a self-redirect loop.
    expect(
      getStorefrontProductHref(
        {
          id: 'p1',
          name: 'Samsung Galaxy S25 Ultra',
          slug: 'samsung-galaxy-s25-ultra-12gb-1tb',
          canonical_url: '/samsung/samsung-galaxy-s25-ultra',
        },
        '/'
      )
    ).toBe('/samsung/samsung-galaxy-s25-ultra');
  });

  it('falls back to category/slug resolution when canonical_url is malformed', () => {
    expect(
      getStorefrontProductHref(
        {
          id: 'p1',
          name: 'Nintendo Switch OLED',
          slug: 'nintendo-switch-oled',
          categories: { slug: 'gaming' },
          canonical_url: 'http://%',
        },
        '/ogabassey'
      )
    ).toBe('/ogabassey/gaming/nintendo-switch-oled');
  });

  it('falls back to the products route when canonical_url is blank', () => {
    expect(
      getStorefrontProductHref(
        {
          id: 'p1',
          name: 'Test Product',
          slug: 'test-product',
          canonical_url: '   ',
        },
        '/ogabassey'
      )
    ).toBe('/ogabassey/products/test-product');
  });

  it('appends a query suffix verbatim (lab arm pinning)', () => {
    expect(
      getStorefrontProductHref(
        {
          id: 'p1',
          name: 'Test Product',
        },
        '/ogabassey',
        '?arm=control'
      )
    ).toBe('/ogabassey/products/test-product?arm=control');
  });

  it('rejects suffixes outside the lab arm pins', () => {
    for (const suffix of [
      '?arm=pilot&x=1',
      '?arm=control#frag',
      '?arm=other',
      '/evil',
    ]) {
      expect(() =>
        getStorefrontProductHref(
          { id: 'p1', name: 'Test Product' },
          '/shop',
          suffix
        )
      ).toThrow(/lab arm pin/);
    }
  });

  it('trims trailing slashes from the base path', () => {
    expect(
      getStorefrontProductHref(
        {
          id: 'p1',
          name: 'Test Product',
        },
        '/ogabassey/'
      )
    ).toBe('/ogabassey/products/test-product');
  });
});
