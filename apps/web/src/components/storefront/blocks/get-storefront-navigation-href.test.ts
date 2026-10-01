import { describe, expect, it } from 'vitest';
import { getStorefrontNavigationHref } from './get-storefront-navigation-href';

describe('getStorefrontNavigationHref', () => {
  it('keeps uppercase HTTPS navigation URLs external', () => {
    expect(
      getStorefrontNavigationHref('HTTPS://example.test/shop', '/demo-store')
    ).toBe('HTTPS://example.test/shop');
  });

  it('prefixes root-relative storefront navigation URLs', () => {
    expect(getStorefrontNavigationHref('/shop', '/demo-store')).toBe(
      '/demo-store/shop'
    );
  });

  it('keeps anchors local and avoids prefixing an already-scoped route twice', () => {
    expect(getStorefrontNavigationHref('#sale', '/demo-store')).toBe('#sale');
    expect(getStorefrontNavigationHref('/demo-store/shop', '/demo-store')).toBe(
      '/demo-store/shop'
    );
  });

  it('keeps already-scoped query and fragment routes intact', () => {
    expect(getStorefrontNavigationHref('/demo-store#sale', '/demo-store')).toBe(
      '/demo-store#sale'
    );
    expect(
      getStorefrontNavigationHref('/demo-store?campaign=x', '/demo-store')
    ).toBe('/demo-store?campaign=x');
  });
});
