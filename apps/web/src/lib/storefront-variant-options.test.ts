import { describe, expect, it } from 'vitest';
import { getStorefrontVariantOptions } from './storefront-variant-options';

describe('storefront-variant-options', () => {
  it('extracts public attributes and normalizes colour to color', () => {
    const options = getStorefrontVariantOptions({
      id: 'v1',
      attributes: {
        Colour: 'Space Gray',
        Storage: '256GB',
        gtin: '1234567890123',
        variant_id: 'internal-id',
      },
      condition: 'used_good',
    });

    expect(options).toEqual({
      color: 'Space Gray',
      storage: '256GB',
      condition: 'used_good',
    });
  });

  it('formats numeric values and handles empty attributes gracefully', () => {
    const options = getStorefrontVariantOptions({
      id: 'v2',
      attributes: {
        ram: 8,
        empty: '   ',
      },
    });

    expect(options).toEqual({
      ram: '8',
    });
  });
});
