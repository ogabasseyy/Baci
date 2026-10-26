import { describe, expect, it } from 'vitest';
import { getRepairDeviceSuggestionLabel } from './repair-device-suggestion-label';

describe('getRepairDeviceSuggestionLabel', () => {
  it('formats a catalog device label', () => {
    expect(
      getRepairDeviceSuggestionLabel({
        id: 'device-1',
        brand: 'Apple',
        model: 'iPhone 15',
        slug: 'iphone-15',
        deviceType: 'Smartphone',
        imageUrl: null,
        productId: null,
      })
    ).toBe('Apple iPhone 15');
  });

  it('uses the product display name for storefront suggestions', () => {
    expect(
      getRepairDeviceSuggestionLabel({
        kind: 'store-product',
        productId: 'product-1',
        displayName: 'Apple iPhone 15',
        deviceType: 'Smartphone',
        imageUrl: null,
      })
    ).toBe('Apple iPhone 15');
  });
});
