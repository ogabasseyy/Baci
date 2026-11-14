import { describe, expect, it } from 'vitest';
import { buildCategoryHubModel } from './build-category-hub-model';
import { buildCategoryHubBrandCards } from './category-hub-brand-cards';
import type { CategoryHubProduct } from './category-hub-types';

function makeProduct(
  id: string,
  brand: string,
  price: number,
  specs = { ram_gb: '8GB', storage_gb: '128GB', screen_size: '6.1' }
): CategoryHubProduct {
  return {
    id,
    slug: id,
    name: `${brand} Product ${id}`,
    brand,
    price,
    stock: 5,
    manage_stock: true,
    product_key_specs: specs,
  };
}

const appleSpecs = { ram_gb: '8GB', storage_gb: '128GB', screen_size: '6.1' };
const samsungSpecs = {
  ram_gb: '12GB',
  storage_gb: '256GB',
  screen_size: '6.7',
};
const googleSpecs = { ram_gb: '16GB', storage_gb: '512GB', screen_size: '6.3' };

describe('category-hub-brand-cards compare pool separation', () => {
  it('derives secondary brand compare links from compareProducts instead of bounded hub pool', () => {
    // 150 hub products: 10 Apple, 10 Samsung, 130 Google
    const hubProducts: CategoryHubProduct[] = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeProduct(`apple-${i}`, 'Apple', 100_000, appleSpecs)
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeProduct(`samsung-${i}`, 'Samsung', 100_000, samsungSpecs)
      ),
      ...Array.from({ length: 130 }, (_, i) =>
        makeProduct(`google-${i}`, 'Google', 100_000, googleSpecs)
      ),
    ];

    // Destination compare inventory (600 products): 150 Apple, 150 Samsung, 130 Google
    const destinationCompareProducts: CategoryHubProduct[] = [
      ...Array.from({ length: 150 }, (_, i) =>
        makeProduct(`apple-comp-${i}`, 'Apple', 100_000, appleSpecs)
      ),
      ...Array.from({ length: 150 }, (_, i) =>
        makeProduct(`samsung-comp-${i}`, 'Samsung', 100_000, samsungSpecs)
      ),
      ...Array.from({ length: 130 }, (_, i) =>
        makeProduct(`google-comp-${i}`, 'Google', 100_000, googleSpecs)
      ),
    ];

    const cards = buildCategoryHubBrandCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products: hubProducts,
      compareProducts: destinationCompareProducts,
    });

    const appleCard = cards.find((c) =>
      c.title.toLowerCase().includes('apple')
    );
    expect(appleCard?.secondaryHref).toBe(
      'https://ogabassey.com/smartphones/compare/apple-vs-samsung'
    );
    expect(appleCard?.secondaryLabel).toBe('Compare Apple vs Samsung');
  });

  it('buildCategoryHubModel passes compareProducts to support links and brand cards', () => {
    const hubProducts: CategoryHubProduct[] = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeProduct(`apple-${i}`, 'Apple', 100_000, appleSpecs)
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeProduct(`samsung-${i}`, 'Samsung', 100_000, samsungSpecs)
      ),
      ...Array.from({ length: 130 }, (_, i) =>
        makeProduct(`google-${i}`, 'Google', 100_000, googleSpecs)
      ),
    ];

    const destinationCompareProducts: CategoryHubProduct[] = [
      ...Array.from({ length: 150 }, (_, i) =>
        makeProduct(`apple-comp-${i}`, 'Apple', 100_000, appleSpecs)
      ),
      ...Array.from({ length: 150 }, (_, i) =>
        makeProduct(`samsung-comp-${i}`, 'Samsung', 100_000, samsungSpecs)
      ),
      ...Array.from({ length: 130 }, (_, i) =>
        makeProduct(`google-comp-${i}`, 'Google', 100_000, googleSpecs)
      ),
    ];

    const model = buildCategoryHubModel({
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      merchantBusinessName: 'Ogabassey',
      merchantCurrency: 'NGN',
      storeUrl: 'https://ogabassey.com',
      products: hubProducts,
      compareProducts: destinationCompareProducts,
    });

    const brandCompareLink = model.comparisonLinks.find(
      (l) => l.href.includes('/compare/') && !l.href.includes('/best-under/')
    );
    expect(brandCompareLink?.href).toBe(
      'https://ogabassey.com/smartphones/compare/apple-vs-samsung'
    );
  });
});
