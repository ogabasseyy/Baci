import { describe, expect, it } from 'vitest';
import { buildCategoryHubCards } from './category-hub-cards';
import type { CategoryHubProduct } from './category-hub-types';

describe('buildCategoryHubCards orchestrator', () => {
  const storeUrl = 'https://ogabassey.com';

  function makeProduct(
    id: string,
    brand: string,
    price: number,
    specs: Record<string, unknown> = {},
    stock = 5,
    category = 'gaming-laptops'
  ): CategoryHubProduct {
    return {
      id,
      slug: id,
      name: `Device ${id}`,
      brand,
      condition: 'New',
      price,
      stock,
      manage_stock: true,
      category_slug: category,
      product_key_specs: specs,
    };
  }

  it('orchestrates and returns bestForCards, brandCards, and priceBandCards', () => {
    const products: CategoryHubProduct[] = [
      makeProduct('laptop-1', 'ASUS', 1_200_000, { ram_gb: 16 }),
      makeProduct('laptop-2', 'MSI', 1_300_000, { ram_gb: 32 }),
      makeProduct('laptop-3', 'Dell', 1_400_000, { ram_gb: 16 }),
    ];

    const result = buildCategoryHubCards({
      categorySlug: 'gaming-laptops',
      storeUrl,
      products,
      merchantCurrency: 'NGN',
    });

    expect(result).toHaveProperty('bestForCards');
    expect(result).toHaveProperty('brandCards');
    expect(result).toHaveProperty('priceBandCards');
    expect(Array.isArray(result.bestForCards)).toBe(true);
    expect(Array.isArray(result.brandCards)).toBe(true);
    expect(Array.isArray(result.priceBandCards)).toBe(true);
  });

  it('forwards merchantCurrency to price-band and best-for builders (NGN permits, USD gates)', () => {
    // 6 eligible products across 3+ brands satisfy MIN_PRICE_BAND_PRODUCTS and MIN_DIFFERENTIATING_SPECS
    const products: CategoryHubProduct[] = [
      makeProduct('laptop-1', 'ASUS', 1_200_000, { ram_gb: 16 }),
      makeProduct('laptop-2', 'MSI', 1_300_000, { ram_gb: 32 }),
      makeProduct('laptop-3', 'Dell', 1_400_000, { ram_gb: 16 }),
      makeProduct('laptop-4', 'Razer', 1_100_000, { ram_gb: 16 }),
      makeProduct('laptop-5', 'Lenovo', 1_000_000, { ram_gb: 32 }),
      makeProduct('laptop-6', 'ASUS', 950_000, { ram_gb: 16 }),
    ];

    const ngnResult = buildCategoryHubCards({
      categorySlug: 'gaming-laptops',
      storeUrl,
      products,
      merchantCurrency: 'NGN',
    });

    const usdResult = buildCategoryHubCards({
      categorySlug: 'gaming-laptops',
      storeUrl,
      products,
      merchantCurrency: 'USD',
    });

    // In NGN, price-band cards and price-based best-for cards are emitted
    expect(ngnResult.priceBandCards.length).toBeGreaterThan(0);
    expect(
      ngnResult.bestForCards.some((c) => c.title.includes('2,000,000'))
    ).toBe(true);

    // In USD, price-band cards and price-based best-for cards are gated
    expect(usdResult.priceBandCards).toEqual([]);
    expect(
      usdResult.bestForCards.some((c) => c.title.includes('2,000,000'))
    ).toBe(false);
  });

  it('forwards brandAuthorityEntries and preserves explicitly empty results', () => {
    const products: CategoryHubProduct[] = [
      makeProduct('tab-1', 'Apple', 200_000, {}, 5, 'tablets'),
      makeProduct('tab-2', 'Apple', 220_000, {}, 5, 'tablets'),
      makeProduct('tab-3', 'Apple', 250_000, {}, 5, 'tablets'),
      makeProduct('tab-4', 'Apple', 280_000, {}, 5, 'tablets'),
      makeProduct('tab-5', 'Apple', 300_000, {}, 5, 'tablets'),
    ];

    // Explicitly empty brandAuthorityEntries simulates verified lack of in-stock authority
    const resultWithEmpty = buildCategoryHubCards({
      categorySlug: 'tablets',
      storeUrl,
      products,
      merchantCurrency: 'NGN',
      brandAuthorityEntries: [],
    });

    // Must NOT link to /tablets/brands/apple; must fall back to representative product link
    expect(resultWithEmpty.brandCards).toHaveLength(1);
    expect(resultWithEmpty.brandCards[0]?.href).toBe(
      `${storeUrl}/tablets/tab-1`
    );

    // When provided with verified authority entries, links to the brand hub
    const resultWithAuthority = buildCategoryHubCards({
      categorySlug: 'tablets',
      storeUrl,
      products,
      merchantCurrency: 'NGN',
      brandAuthorityEntries: [
        {
          categorySlug: 'tablets',
          brandKey: 'apple',
          displayName: 'Apple',
          brandSlug: 'apple',
          brandQueryValue: 'Apple',
          minimumProducts: 5,
          productCount: 5,
        },
      ],
    });

    expect(resultWithAuthority.brandCards).toHaveLength(1);
    expect(resultWithAuthority.brandCards[0]?.href).toBe(
      `${storeUrl}/tablets/brands/apple`
    );
  });
});
