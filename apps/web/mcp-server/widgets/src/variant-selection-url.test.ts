import { describe, expect, it } from 'vitest';
import { getVariantSelectionUrl } from './variant-selection-url';

describe('getVariantSelectionUrl', () => {
  it('accepts the exact Ogabassey product page for the requested variant product', () => {
    expect(getVariantSelectionUrl({ structuredContent: {
      requires_variant_selection: true,
      product_id: 'phone-1',
      product_url: 'https://ogabassey.com/products/phone-one',
    } }, 'phone-1')).toBe('https://ogabassey.com/products/phone-one');
  });

  it('accepts the server current slug when the widget has a stale product slug', () => {
    expect(getVariantSelectionUrl({ structuredContent: {
      requires_variant_selection: true,
      product_id: 'phone-1',
      product_url: 'https://ogabassey.com/products/renamed-phone',
    } }, 'phone-1')).toBe('https://ogabassey.com/products/renamed-phone');
  });

  it('rejects mismatched product identity and unsafe URLs', () => {
    expect(getVariantSelectionUrl({ structuredContent: {
      requires_variant_selection: true,
      product_id: 'another-phone',
      product_url: 'https://ogabassey.com/products/phone-one',
    } }, 'phone-1')).toBeNull();
    for (const productUrl of [
      'https://example.com/products/phone-one',
      'https://ogabassey.com/cart',
      'https://ogabassey.com/products/phone-one/extra',
      'https://ogabassey.com/products/phone-one?redirect=example.com',
      'https://ogabassey.com/products/phone-one#details',
      'https://user@ogabassey.com/products/phone-one',
    ]) {
      expect(getVariantSelectionUrl({ structuredContent: {
        requires_variant_selection: true,
        product_id: 'phone-1',
        product_url: productUrl,
      } }, 'phone-1')).toBeNull();
    }
  });
});
