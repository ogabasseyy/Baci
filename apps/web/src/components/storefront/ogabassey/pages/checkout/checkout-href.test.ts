import { describe, expect, it } from 'vitest';
import { checkoutHref } from './checkout-href';

describe('checkoutHref', () => {
  it('preserves absolute URLs and prefixes storefront paths', () => {
    expect(checkoutHref('/store', 'https://example.com')).toBe('https://example.com');
    expect(checkoutHref('/store', '/cart')).toBe('/store/cart');
    expect(checkoutHref('/store', '/')).toBe('/store');
    expect(checkoutHref(undefined, '/cart')).toBe('/cart');
  });
});
