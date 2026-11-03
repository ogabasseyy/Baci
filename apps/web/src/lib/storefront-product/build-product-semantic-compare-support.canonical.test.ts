import { describe, expect, it } from 'vitest';
import { buildProductSemanticCompareSupport } from './build-product-semantic-compare-support';
import {
  makeCandidate,
  makeInput,
} from './build-product-semantic-compare-support.test-helpers';

describe('buildProductSemanticCompareSupport canonical category scoping', () => {
  it('excludes child-category products with different canonical_category_slug from compare approvals', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-17-pro-max',
      name: 'iPhone 17 Pro Max',
      brand: 'Apple',
      category_slug: 'smartphones',
      canonical_category_slug: 'smartphones',
      price: 495_000,
    });

    const childProduct = makeCandidate({
      slug: 'galaxy-s24-ultra',
      name: 'Galaxy S24 Ultra',
      brand: 'Samsung',
      // category_slug may be parent 'smartphones' due to normalization or parent route scoping,
      // but canonical_category_slug is the true child category 'android-phones'
      category_slug: 'smartphones',
      canonical_category_slug: 'android-phones',
      price: 480_000,
    });

    const matchingProduct = makeCandidate({
      slug: 'iphone-16-pro',
      name: 'iPhone 16 Pro',
      brand: 'Apple',
      category_slug: 'smartphones',
      canonical_category_slug: 'smartphones',
      price: 450_000,
    });

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [currentProduct, childProduct, matchingProduct],
        categorySlug: 'smartphones',
      })
    );

    // Only matchingProduct should be approved in smartphones compare link graph,
    // childProduct must NOT be approved because its canonical category is android-phones
    expect(
      support.approvedCompareSlugs.has('iphone-17-pro-max-vs-galaxy-s24-ultra')
    ).toBe(false);
    expect(
      support.approvedCompareSlugs.has('galaxy-s24-ultra-vs-iphone-17-pro-max')
    ).toBe(false);
  });
});
