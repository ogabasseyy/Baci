import { describe, expect, it } from 'vitest';
import { getCartHandoffUrl, getVariantSelectionUrl } from './cart-handoff-result';

describe('getCartHandoffUrl', () => {
  it('accepts a successful Ogabassey cart handoff', () => {
    expect(getCartHandoffUrl({
      structuredContent: {
        success: true,
        cart_url: 'https://ogabassey.com/cart?item_id=phone-1&qty=1',
      },
    }, 'phone-1')).toBe('https://ogabassey.com/cart?item_id=phone-1&qty=1');
  });

  it('rejects failures and off-site URLs', () => {
    expect(getCartHandoffUrl({ structuredContent: { success: false } }, 'phone-1')).toBeNull();
    expect(getCartHandoffUrl({
      structuredContent: { success: true, cart_url: 'https://example.com/cart' },
    }, 'phone-1')).toBeNull();
    expect(getCartHandoffUrl({
      structuredContent: { success: true, cart_url: 'https://ogabassey.com/cart?item_id=phone-2' },
    }, 'phone-1')).toBeNull();
    expect(getCartHandoffUrl(undefined, 'phone-1')).toBeNull();
  });
});

describe('getVariantSelectionUrl', () => {
  it('accepts the exact Ogabassey product page for the requested variant product', () => {
    expect(getVariantSelectionUrl({ structuredContent: {
      requires_variant_selection: true,
      product_id: 'phone-1',
      product_url: 'https://ogabassey.com/products/phone-one',
    } }, 'phone-1', 'phone-one')).toBe('https://ogabassey.com/products/phone-one');
  });

  it('rejects mismatched products and off-site pages', () => {
    for (const productUrl of [
      'https://example.com/products/phone-one',
      'https://ogabassey.com/products/another-phone',
      'https://ogabassey.com/products/phone-one?redirect=example.com',
    ]) {
      expect(getVariantSelectionUrl({ structuredContent: {
        requires_variant_selection: true,
        product_id: 'phone-1',
        product_url: productUrl,
      } }, 'phone-1', 'phone-one')).toBeNull();
    }
  });
});
