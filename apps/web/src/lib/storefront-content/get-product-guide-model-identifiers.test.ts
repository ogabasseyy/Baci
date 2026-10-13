import { describe, expect, it } from 'vitest';
import { getProductGuideModelIdentifiers } from './get-product-guide-model-identifiers';

describe('getProductGuideModelIdentifiers', () => {
  it('adds the numeric XPS family proven by the catalog product name', () => {
    const identifiers = getProductGuideModelIdentifiers({
      pageKind: 'product',
      categorySlug: 'laptops',
      brands: ['Dell'],
      productNames: ['Dell XPS 13 9340 Intel Core Ultra 7 32GB'],
    });

    expect(identifiers).toEqual(['xps 9340', 'xps 13 9340']);
  });

  it('does not invent a sibling numeric family absent from the catalog source', () => {
    const identifiers = getProductGuideModelIdentifiers({
      pageKind: 'product',
      categorySlug: 'laptops',
      brands: ['Dell'],
      productNames: ['Dell XPS 13 9340 Intel Core Ultra 7 32GB'],
    });

    expect(identifiers).not.toContain('xps 14 9340');
  });

  it('proves a numeric laptop family from an aligned product slug', () => {
    const identifiers = getProductGuideModelIdentifiers({
      pageKind: 'product',
      categorySlug: 'laptops',
      brands: ['Dell'],
      productNames: ['Dell XPS'],
      productSlugs: ['dell-xps-13-9340'],
    });

    expect(identifiers).toContain('xps 13 9340');
  });
});
