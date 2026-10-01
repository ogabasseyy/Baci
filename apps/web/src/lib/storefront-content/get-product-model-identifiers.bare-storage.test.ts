import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiers } from './get-product-model-identifiers';

describe('getProductModelIdentifiers bare storage', () => {
  it('keeps a numeric phone model while stripping terminal bare storage', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productNames: ['Apple iPhone 15 256'],
    });

    expect(identifiers).toEqual(['15']);
  });
});
