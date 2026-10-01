import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiers } from './get-product-model-identifiers';

describe('getProductModelIdentifiers phone display suffixes', () => {
  it('keeps iPhone 15 instead of a sub-10-inch display suffix', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productNames: ['Apple iPhone 15 6.1-inch'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['15']);
  });

  it('removes terminal unitless storage after a Samsung model code', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Samsung'],
      productNames: ['Samsung Galaxy S25 256'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['s25']);
  });
});
