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

  it('preserves band eligibility when the 48-product semantic inventory has 5 qualifying items and position 49 supplies the 6th', () => {
    const qualifyingCurrentProduct = makeCandidate({
      slug: 'phone-49',
      name: 'Phone 49',
      brand: 'Apple',
      price: 240_000,
      category_slug: 'smartphones',
    });

    const fiveQualifyingProducts = [
      makeCandidate({
        slug: 'phone-1',
        name: 'Phone 1',
        brand: 'Apple',
        price: 220_000,
        category_slug: 'smartphones',
      }),
      makeCandidate({
        slug: 'phone-2',
        name: 'Phone 2',
        brand: 'Samsung',
        price: 230_000,
        category_slug: 'smartphones',
      }),
      makeCandidate({
        slug: 'phone-3',
        name: 'Phone 3',
        brand: 'Samsung',
        price: 250_000,
        category_slug: 'smartphones',
      }),
      makeCandidate({
        slug: 'phone-4',
        name: 'Phone 4',
        brand: 'Xiaomi',
        price: 260_000,
        category_slug: 'smartphones',
      }),
      makeCandidate({
        slug: 'phone-5',
        name: 'Phone 5',
        brand: 'Xiaomi',
        price: 270_000,
        category_slug: 'smartphones',
      }),
    ];

    const nonQualifyingNewestProducts = Array.from({ length: 43 }, (_, index) =>
      makeCandidate({
        slug: `flagship-${index + 1}`,
        name: `Flagship ${index + 1}`,
        brand: 'Apple',
        price: 1_500_000 + index * 1_000,
        category_slug: 'smartphones',
      })
    );

    const cappedSemanticInventory = [
      ...fiveQualifyingProducts,
      ...nonQualifyingNewestProducts,
    ];
    const canonicalDestinationWindow = [
      ...cappedSemanticInventory,
      qualifyingCurrentProduct,
    ];

    const withExplicitDestinationPool = buildProductSemanticCompareSupport(
      makeInput({
        categorySlug: 'smartphones',
        categoryName: 'Smartphones',
        currentProduct: qualifyingCurrentProduct,
        inventory: cappedSemanticInventory,
        priceBandInventory: canonicalDestinationWindow,
      })
    );
    expect(
      withExplicitDestinationPool.supportLinks.find((link) =>
        link.href.includes('best-under')
      )
    ).toBeDefined();

    const withDefaultFallbackWindow = buildProductSemanticCompareSupport(
      makeInput({
        categorySlug: 'smartphones',
        categoryName: 'Smartphones',
        currentProduct: qualifyingCurrentProduct,
        inventory: cappedSemanticInventory,
      })
    );
    expect(
      withDefaultFallbackWindow.supportLinks.find((link) =>
        link.href.includes('best-under')
      )
    ).toBeDefined();
  });
});
