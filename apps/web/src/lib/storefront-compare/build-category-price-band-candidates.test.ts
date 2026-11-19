import { describe, expect, it } from 'vitest';
import { buildCategoryPriceBandCandidates } from './build-category-price-band-candidates';

const product = (slug: string, brand: string, price: number) => ({
  slug,
  name: slug,
  brand,
  price,
});

describe('buildCategoryPriceBandCandidates', () => {
  it('builds one candidate per curated band with band-scoped products', () => {
    const candidates = buildCategoryPriceBandCandidates('smartphones', [
      product('a1', 'Apple', 400_000),
      product('a2', 'Apple', 450_000),
      product('s1', 'Samsung', 480_000),
      product('x1', 'Xiaomi', 300_000),
      product('t1', 'Tecno', 200_000),
      product('i1', 'Infinix', 150_000),
      product('flagship', 'Apple', 1_500_000),
    ]);

    expect(candidates.map((candidate) => candidate.band.slug)).toEqual([
      'under-500k',
      'under-1m',
    ]);
    const under500k = candidates[0];
    expect(under500k?.activeProductCount).toBe(6);
    expect(under500k?.products.map((entry) => entry.slug)).not.toContain(
      'flagship'
    );
    expect(under500k?.isIndexable).toBe(true);
  });

  it('returns no candidates for an uncurated category', () => {
    expect(buildCategoryPriceBandCandidates('furniture', [])).toEqual([]);
  });

  it('builds candidates for NGN-gated categories when currency is NGN and fails closed otherwise', () => {
    const gamingProducts = [
      product('asus-1', 'ASUS', 900_000),
      product('asus-2', 'ASUS', 950_000),
      product('hp-1', 'HP', 800_000),
      product('dell-1', 'Dell', 850_000),
      product('lenovo-1', 'Lenovo', 700_000),
    ];

    const ngnCandidates = buildCategoryPriceBandCandidates(
      'gaming-laptops',
      gamingProducts,
      { merchantCurrency: 'NGN' }
    );
    expect(ngnCandidates.length).toBeGreaterThan(0);
    expect(ngnCandidates[0]?.band.slug).toBe('under-1-5m');

    expect(
      buildCategoryPriceBandCandidates('gaming-laptops', gamingProducts)
    ).toEqual([]);
    expect(
      buildCategoryPriceBandCandidates('gaming-laptops', gamingProducts, {
        merchantCurrency: 'USD',
      })
    ).toEqual([]);
  });

  it('excludes managed out-of-stock products without condition offers from candidates', () => {
    const products = [
      ...Array.from({ length: 6 }, (_, i) => ({
        slug: `apple-${i}`,
        name: `Apple ${i}`,
        brand: 'Apple',
        price: 400_000,
        manage_stock: true,
        stock: 0,
        has_condition_offers: false,
      })),
    ];

    const candidates = buildCategoryPriceBandCandidates(
      'smartphones',
      products
    );
    expect(candidates[0]?.activeProductCount).toBe(0);
    expect(candidates[0]?.isIndexable).toBe(false);
  });

  it('retains managed out-of-stock products when has_condition_offers is true', () => {
    const products = [
      ...Array.from({ length: 6 }, (_, i) => ({
        slug: `device-${i}`,
        name: `Device ${i}`,
        brand: `Brand-${i % 3}`,
        price: 400_000,
        manage_stock: true,
        stock: 0,
        has_condition_offers: true,
      })),
    ];

    const candidates = buildCategoryPriceBandCandidates(
      'smartphones',
      products
    );
    expect(candidates[0]?.activeProductCount).toBe(6);
    expect(candidates[0]?.isIndexable).toBe(true);
  });
});
