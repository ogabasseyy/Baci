import { describe, expect, it } from 'vitest';
import { CATEGORY_HUB_DEFAULTS } from '@/config/category-hub-defaults';
import { buildPriceBandCards } from '@/lib/storefront-category/category-hub-price-band-cards';
import type {
  CategoryHubDefaults,
  CategoryHubProduct,
} from '@/lib/storefront-category/category-hub-types';
import type { PriceBandDefinition } from '@/lib/storefront-compare/compare-types';
import { CURATED_PRICE_BANDS } from '@/lib/storefront-compare/get-configured-price-bands';

const curatedBandsMap = CURATED_PRICE_BANDS as Record<
  string,
  PriceBandDefinition[]
>;
const categoryDefaultsMap = CATEGORY_HUB_DEFAULTS as Record<
  string,
  CategoryHubDefaults
>;

function makeTestDefaults(slugs: string[]): CategoryHubDefaults {
  return {
    intro: { heading: 'Test', description: 'Test desc' },
    trustFeatures: [],
    faqItems: [],
    bestFor: {},
    brandHighlights: { heading: 'Brands', description: 'Brands desc' },
    priceBands: slugs.map((slug) => ({
      slug,
      title: `Title ${slug}`,
      description: `Desc ${slug}`,
    })),
  };
}

describe('buildPriceBandCards config validation fallback', () => {
  it('returns [] instead of throwing when config validation fails', () => {
    const testCategory = 'mismatched-config-test-category';
    curatedBandsMap[testCategory] = [
      { slug: 'under-100k', label: 'Under 100k', ceiling: 100_000 },
    ];
    categoryDefaultsMap[testCategory] = makeTestDefaults(['mismatched-slug']);

    try {
      expect(
        buildPriceBandCards({
          categorySlug: testCategory,
          storeUrl: 'https://example.com',
          products: [],
          merchantCurrency: 'NGN',
        })
      ).toEqual([]);
    } finally {
      delete curatedBandsMap[testCategory];
      delete categoryDefaultsMap[testCategory];
    }
  });
});

describe('buildPriceBandCards availability and price filtering', () => {
  function makeProduct(
    id: string,
    brand: string,
    price: number,
    stock = 5,
    manageStock = true
  ): CategoryHubProduct {
    return {
      id,
      slug: id,
      name: `Device ${id}`,
      brand,
      condition: 'New',
      price,
      stock,
      manage_stock: manageStock,
      category_slug: 'gaming-laptops',
    };
  }

  it('does not emit price-band card if threshold is reached only through out-of-stock items', () => {
    const products: CategoryHubProduct[] = [
      makeProduct('p1', 'ASUS', 1_200_000, 5, true),
      makeProduct('p2', 'MSI', 1_300_000, 5, true),
      makeProduct('p3', 'Dell', 1_400_000, 5, true),
      makeProduct('p4', 'ASUS', 1_100_000, 5, true),
      makeProduct('p5', 'MSI', 1_000_000, 0, true),
      makeProduct('p6', 'Dell', 900_000, 0, true),
    ];

    const cards = buildPriceBandCards({
      categorySlug: 'gaming-laptops',
      storeUrl: 'https://ogabassey.com',
      products,
      merchantCurrency: 'NGN',
    });

    expect(cards).toEqual([]);
  });

  it('does not emit price-band card if zero or negative price items are present', () => {
    const products: CategoryHubProduct[] = [
      makeProduct('p1', 'ASUS', 1_200_000, 5, true),
      makeProduct('p2', 'MSI', 1_300_000, 5, true),
      makeProduct('p3', 'Dell', 1_400_000, 5, true),
      makeProduct('p4', 'ASUS', 1_100_000, 5, true),
      makeProduct('p5', 'MSI', 0, 5, true),
      makeProduct('p6', 'Dell', -50_000, 5, true),
    ];

    const cards = buildPriceBandCards({
      categorySlug: 'gaming-laptops',
      storeUrl: 'https://ogabassey.com',
      products,
      merchantCurrency: 'NGN',
    });

    expect(cards).toEqual([]);
  });

  it('returns [] for prototype keys like constructor without throwing', () => {
    const cards = buildPriceBandCards({
      categorySlug: 'constructor',
      storeUrl: 'https://ogabassey.com',
      products: [],
      merchantCurrency: 'NGN',
    });
    expect(cards).toEqual([]);
  });
});
