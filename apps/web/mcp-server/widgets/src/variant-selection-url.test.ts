import { describe, expect, it } from 'vitest';
import { getVariantSelectionUrl } from './variant-selection-url';

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
