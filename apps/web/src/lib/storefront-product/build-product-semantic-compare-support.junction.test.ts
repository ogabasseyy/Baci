import { describe, expect, it } from 'vitest';
import { buildProductSemanticCompareSupport } from './build-product-semantic-compare-support';
import {
  makeCandidate,
  makeInput,
} from './build-product-semantic-compare-support.test-helpers';

describe('buildProductSemanticCompareSupport junction parity', () => {
  it('excludes direct-only products lacking junction membership when evaluating price bands', () => {
    const currentProduct = makeCandidate({
      slug: 'phone-1',
      name: 'Phone 1',
      brand: 'Apple',
      price: 250_000,
      category_slug: 'smartphones',
      category_slugs: ['smartphones'],
    });

    const junctionMatchedProducts = [
      currentProduct,
      makeCandidate({
        slug: 'phone-2',
        name: 'Phone 2',
        brand: 'Samsung',
        price: 280_000,
        category_slug: 'smartphones',
        category_slugs: ['smartphones'],
      }),
    ];

    const directOnlyProducts = [
      makeCandidate({
        slug: 'direct-only-1',
        name: 'Direct Only 1',
        brand: 'Google',
        price: 220_000,
        category_slug: 'smartphones',
        category_slugs: null,
      }),
      makeCandidate({
        slug: 'direct-only-2',
        name: 'Direct Only 2',
        brand: 'Xiaomi',
        price: 230_000,
        category_slug: 'smartphones',
        category_slugs: null,
      }),
    ];

    const support = buildProductSemanticCompareSupport(
      makeInput({
        categorySlug: 'smartphones',
        categoryName: 'Smartphones',
        currentProduct,
        inventory: [...directOnlyProducts, ...junctionMatchedProducts],
      })
    );

    // With 2 junction products across 2 brands, under-300k band requires >= 3 brands / 6 items,
    // so it does not falsely qualify based on direct-only products that lack junction membership.
    const priceBandLink = support.supportLinks.find((link) =>
      link.href.includes('best-under')
    );
    expect(priceBandLink).toBeUndefined();
  });
});
