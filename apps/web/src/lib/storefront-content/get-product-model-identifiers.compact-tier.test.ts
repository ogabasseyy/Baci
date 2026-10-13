import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiers } from './get-product-model-identifiers';

describe('getProductModelIdentifiers compact model tiers', () => {
  it('matches spaced guide wording for compact catalog tiers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Samsung'],
      productNames: ['Samsung Galaxy S24FE'],
    });

    expect(identifiers).toEqual(['s24 fe']);
  });
});
