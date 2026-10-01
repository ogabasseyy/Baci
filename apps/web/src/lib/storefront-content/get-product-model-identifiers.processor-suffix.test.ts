import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiers } from './get-product-model-identifiers';

describe('getProductModelIdentifiers laptop processor suffixes', () => {
  it('removes a complete Intel Core Ultra tier after the catalog model', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Dell'],
      productNames: ['Dell XPS 13 9340 Intel Core Ultra 7 32GB'],
    });

    expect(identifiers).toEqual(['xps 9340']);
  });
});
