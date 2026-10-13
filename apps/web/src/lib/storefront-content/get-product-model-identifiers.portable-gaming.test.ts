import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiers } from './get-product-model-identifiers';

describe('getProductModelIdentifiers portable gaming', () => {
  it('retains a proven single-letter handheld model suffix', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'portable-gaming',
      brands: ['ASUS'],
      productNames: ['ASUS ROG Ally X'],
    });

    expect(identifiers).toEqual(['rog ally x']);
  });
});
