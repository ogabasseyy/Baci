import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiers } from './get-product-model-identifiers';

describe('getProductModelIdentifiers convertible ordering', () => {
  it('preserves a model digit after a leading 2-in-1 descriptor', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Microsoft'],
      productNames: ['Microsoft 2-in-1 Surface Pro 9'],
    });

    expect(identifiers).toEqual(['2 in 1 surface pro 9']);
  });
});
