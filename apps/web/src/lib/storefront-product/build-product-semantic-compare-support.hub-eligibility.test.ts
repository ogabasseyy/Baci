import { describe, expect, it } from 'vitest';
import { buildProductSemanticCompareSupport } from './build-product-semantic-compare-support';
import {
  makeCandidate,
  makeInput,
} from './build-product-semantic-compare-support.test-helpers';

describe('buildProductSemanticCompareSupport hub eligibility', () => {
  it('defaults omitted hubEligibilityInventory to empty array and emits no brand/family links', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-15-pro-max',
      name: 'iPhone 15 Pro Max',
      brand: 'Apple',
      price: 1_200_000,
    });
    // inventory has >= 5 Apple products
    const inventory = [
      currentProduct,
      makeCandidate({
        slug: 'iphone-15-pro',
        name: 'iPhone 15 Pro',
        brand: 'Apple',
        price: 1_100_000,
      }),
      makeCandidate({
        slug: 'iphone-15',
        name: 'iPhone 15',
        brand: 'Apple',
        price: 900_000,
      }),
      makeCandidate({
        slug: 'iphone-14',
        name: 'iPhone 14',
        brand: 'Apple',
        price: 800_000,
      }),
      makeCandidate({
        slug: 'iphone-13',
        name: 'iPhone 13',
        brand: 'Apple',
        price: 700_000,
      }),
    ];

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory,
        // hubEligibilityInventory omitted
      })
    );

    expect(support.supportLinks.some((l) => l.href.includes('/brands/'))).toBe(
      false
    );
    expect(
      support.supportLinks.some((l) => l.href.includes('/families/'))
    ).toBe(false);
  });

  it('emits no brand/family links on explicit hubEligibilityInventory: [] while preserving category and compare links', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-15-pro-max',
      name: 'iPhone 15 Pro Max',
      brand: 'Apple',
      price: 1_200_000,
      product_key_specs: { chipset: 'A17 Pro', ram_gb: 8, storage_gb: 256 },
    });
    const comparePartner = makeCandidate({
      slug: 'samsung-s24-ultra',
      name: 'Samsung Galaxy S24 Ultra',
      brand: 'Samsung',
      price: 1_150_000,
      product_key_specs: {
        chipset: 'Snapdragon 8 Gen 3',
        ram_gb: 12,
        storage_gb: 512,
      },
    });

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [currentProduct, comparePartner],
        hubEligibilityInventory: [],
      })
    );

    expect(support.supportLinks[0]).toEqual({
      href: 'https://ogabassey.com/smartphones',
      label: 'Shop more Smartphones',
    });
    expect(support.supportLinks.some((l) => l.href.includes('/brands/'))).toBe(
      false
    );
    expect(support.supportLinks.some((l) => l.href.includes('/compare/'))).toBe(
      true
    );
  });

  it('emits canonical brand and model-family hub links when hubEligibilityInventory meets thresholds', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-15-pro-max',
      name: 'iPhone 15 Pro Max',
      brand: 'Apple',
      price: 1_200_000,
    });
    const hubEligibilityInventory = [
      {
        slug: 'iphone-15-pro-max',
        name: 'iPhone 15 Pro Max',
        brand: 'Apple',
        price: 1_200_000,
        availability: 'InStock' as const,
        stock: 5,
        category_slug: 'smartphones',
      },
      {
        slug: 'iphone-15-pro',
        name: 'iPhone 15 Pro',
        brand: 'Apple',
        price: 1_100_000,
        availability: 'InStock' as const,
        stock: 3,
        category_slug: 'smartphones',
      },
      {
        slug: 'iphone-15',
        name: 'iPhone 15',
        brand: 'Apple',
        price: 900_000,
        availability: 'InStock' as const,
        stock: 0,
        category_slug: 'smartphones',
      }, // unmanaged zero-stock
      {
        slug: 'iphone-14',
        name: 'iPhone 14',
        brand: 'Apple',
        price: 800_000,
        availability: 'InStock' as const,
        stock: 2,
        category_slug: 'smartphones',
      },
      {
        slug: 'iphone-13',
        name: 'iPhone 13',
        brand: 'Apple',
        price: 700_000,
        availability: 'InStock' as const,
        stock: 4,
        category_slug: 'smartphones',
      },
    ];

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [currentProduct],
        hubEligibilityInventory,
      })
    );

    expect(support.supportLinks).toEqual(
      expect.arrayContaining([
        {
          href: 'https://ogabassey.com/smartphones/brands/apple',
          label: 'Explore Apple iPhone',
        },
        {
          href: 'https://ogabassey.com/smartphones/brands/apple/families/iphone-15',
          label: 'Explore iPhone 15 Series',
        },
      ])
    );
  });

  it('respects threshold boundaries: 4 brand products yields no hubs, 5 brand products with 2 family products yields only brand hub', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-15-pro',
      name: 'iPhone 15 Pro',
      brand: 'Apple',
      price: 1_100_000,
    });

    // 4 brand products (< 5 minimumProducts)
    const fourProductsInventory = [
      'iPhone 15 Pro',
      'iPhone 15',
      'iPhone 14',
      'iPhone 13',
    ].map((name, i) => ({
      slug: `iphone-${i}`,
      name,
      brand: 'Apple',
      price: 1_000_000,
      availability: 'InStock' as const,
      stock: 5,
      category_slug: 'smartphones',
    }));

    const underBrandThreshold = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [currentProduct],
        hubEligibilityInventory: fourProductsInventory,
      })
    );
    expect(
      underBrandThreshold.supportLinks.some((l) => l.href.includes('/brands/'))
    ).toBe(false);
    expect(
      underBrandThreshold.supportLinks.some((l) =>
        l.href.includes('/families/')
      )
    ).toBe(false);

    // 5 brand products, but only 2 iPhone 15s (< 3 family minimumProducts)
    const twoFamilyProductsInventory = [
      'iPhone 15 Pro',
      'iPhone 15',
      'iPhone 14',
      'iPhone 13',
      'iPhone 12',
    ].map((name, i) => ({
      slug: `iphone-${i}`,
      name,
      brand: 'Apple',
      price: 1_000_000,
      availability: 'InStock' as const,
      stock: 5,
      category_slug: 'smartphones',
    }));

    const underFamilyThreshold = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [currentProduct],
        hubEligibilityInventory: twoFamilyProductsInventory,
      })
    );
    expect(
      underFamilyThreshold.supportLinks.some(
        (l) => l.href === 'https://ogabassey.com/smartphones/brands/apple'
      )
    ).toBe(true);
    expect(
      underFamilyThreshold.supportLinks.some((l) =>
        l.href.includes('/families/')
      )
    ).toBe(false);
  });
});
