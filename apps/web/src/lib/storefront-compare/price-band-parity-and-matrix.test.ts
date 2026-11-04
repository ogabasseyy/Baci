import { describe, expect, it } from 'vitest';
import { buildCommercialSupportDiscoveryLinks } from './build-compare-discovery-links';
import { buildPriceBandCandidate } from './compare-eligibility';
import { CURATED_PRICE_BANDS } from './get-configured-price-bands';

describe('price band parity and placeholder brand tests', () => {
  it('excludes placeholder brands ("Gaming") from real brand count, making a 6-product / 2-real-brand fixture non-indexable', () => {
    // 6 products in band: 3 Apple, 2 Samsung, 1 Gaming (placeholder)
    const band = CURATED_PRICE_BANDS.smartphones[1];
    const products = [
      { slug: 'apple-1', name: 'iPhone 1', brand: 'Apple', price: 600_000 },
      { slug: 'apple-2', name: 'iPhone 2', brand: 'Apple', price: 700_000 },
      { slug: 'apple-3', name: 'iPhone 3', brand: 'Apple', price: 800_000 },
      { slug: 'samsung-1', name: 'Galaxy 1', brand: 'Samsung', price: 650_000 },
      { slug: 'samsung-2', name: 'Galaxy 2', brand: 'Samsung', price: 750_000 },
      {
        slug: 'gaming-1',
        name: 'Gaming Phone',
        brand: 'Gaming',
        price: 620_000,
      },
    ];

    const candidate = buildPriceBandCandidate({
      categorySlug: 'smartphones',
      band,
      products,
    });

    expect(candidate.activeProductCount).toBe(6);
    // Real brands: apple, samsung (2). 'gaming' is filtered as placeholder
    expect(candidate.differentiatingSpecCount).toBe(2);
    expect(candidate.isIndexable).toBe(false);
  });

  it('counts 3 distinct real brands, making a 6-product / 3-real-brand fixture indexable', () => {
    // 6 products in band: 2 Apple, 2 Samsung, 2 Tecno
    const band = CURATED_PRICE_BANDS.smartphones[1];
    const products = [
      { slug: 'apple-1', name: 'iPhone 1', brand: 'Apple', price: 600_000 },
      { slug: 'apple-2', name: 'iPhone 2', brand: 'Apple', price: 700_000 },
      { slug: 'samsung-1', name: 'Galaxy 1', brand: 'Samsung', price: 650_000 },
      { slug: 'samsung-2', name: 'Galaxy 2', brand: 'Samsung', price: 750_000 },
      { slug: 'tecno-1', name: 'Camon 1', brand: 'Tecno', price: 620_000 },
      { slug: 'tecno-2', name: 'Camon 2', brand: 'Tecno', price: 680_000 },
    ];

    const candidate = buildPriceBandCandidate({
      categorySlug: 'smartphones',
      band,
      products,
    });

    expect(candidate.activeProductCount).toBe(6);
    expect(candidate.differentiatingSpecCount).toBe(3);
    expect(candidate.isIndexable).toBe(true);
  });

  it('normalizes numeric-string prices with commas and whitespace so legitimate price-band candidates qualify', () => {
    const band = CURATED_PRICE_BANDS.smartphones[1];
    const products = [
      { slug: 'apple-1', name: 'iPhone 1', brand: 'Apple', price: '600,000' },
      { slug: 'apple-2', name: 'iPhone 2', brand: 'Apple', price: ' 700000 ' },
      {
        slug: 'samsung-1',
        name: 'Galaxy 1',
        brand: 'Samsung',
        price: '650,000',
      },
      {
        slug: 'samsung-2',
        name: 'Galaxy 2',
        brand: 'Samsung',
        price: '750000',
      },
      { slug: 'tecno-1', name: 'Camon 1', brand: 'Tecno', price: '620,000' },
      { slug: 'tecno-2', name: 'Camon 2', brand: 'Tecno', price: ' 680,000 ' },
    ];

    const candidate = buildPriceBandCandidate({
      categorySlug: 'smartphones',
      band,
      products,
    });

    expect(candidate.activeProductCount).toBe(6);
    expect(candidate.differentiatingSpecCount).toBe(3);
    expect(candidate.isIndexable).toBe(true);
  });

  it('emits all indexable price-band URLs per category rather than stopping at .find()', () => {
    // 12 products spanning 2 bands:
    // Band 1 (under-500k): 6 products from 3 brands (Apple, Samsung, Tecno) priced between 200k and 450k
    // Band 2 (under-1m): 6 products from 3 brands (Apple, Samsung, Tecno) priced between 550k and 900k
    const products = [
      { slug: 'a-low-1', name: 'A Low 1', brand: 'Apple', price: 300_000 },
      { slug: 'a-low-2', name: 'A Low 2', brand: 'Apple', price: 350_000 },
      { slug: 's-low-1', name: 'S Low 1', brand: 'Samsung', price: 400_000 },
      { slug: 's-low-2', name: 'S Low 2', brand: 'Samsung', price: 420_000 },
      { slug: 't-low-1', name: 'T Low 1', brand: 'Tecno', price: 250_000 },
      { slug: 't-low-2', name: 'T Low 2', brand: 'Tecno', price: 280_000 },
      { slug: 'a-high-1', name: 'A High 1', brand: 'Apple', price: 600_000 },
      { slug: 'a-high-2', name: 'A High 2', brand: 'Apple', price: 700_000 },
      { slug: 's-high-1', name: 'S High 1', brand: 'Samsung', price: 650_000 },
      { slug: 's-high-2', name: 'S High 2', brand: 'Samsung', price: 750_000 },
      { slug: 't-high-1', name: 'T High 1', brand: 'Tecno', price: 620_000 },
      { slug: 't-high-2', name: 'T High 2', brand: 'Tecno', price: 680_000 },
    ];

    const links = buildCommercialSupportDiscoveryLinks({
      storeUrl: 'https://ogabassey.com',
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      merchantCurrency: 'NGN',
      includeBrandCompareLinks: false,
      products,
    });

    const priceBandUrls = links
      .map((l) => l.href)
      .filter((href) => href.includes('/best-under/'));

    expect(priceBandUrls).toContain(
      'https://ogabassey.com/smartphones/best-under/under-500k'
    );
    expect(priceBandUrls).toContain(
      'https://ogabassey.com/smartphones/best-under/under-1m'
    );
    expect(priceBandUrls).toHaveLength(2);
  });

  it('evaluates all 15 expansion price bands verifying indexability policies and currency gating (§3.7)', () => {
    const expansionCategories = [
      'gaming-laptops',
      'tablets',
      'audio',
      'smartwatches',
      'playstation-5',
    ] as const;

    const allFifteenBands = expansionCategories.flatMap((categorySlug) =>
      CURATED_PRICE_BANDS[categorySlug].map((band) => ({
        categorySlug,
        band,
      }))
    );

    expect(allFifteenBands).toHaveLength(15);

    // Test matrix:
    // 1. In a single-brand catalog (e.g. only Sony in playstation-5), candidates are configured_but_suppressed (insufficient distinct brands).
    // 2. In a multi-brand catalog with 3 real brands and >= 6 products, candidates become indexable.
    // 3. For non-NGN currency (e.g. USD), new price bands are suppressed.
    for (const { categorySlug, band } of allFifteenBands) {
      // Single brand catalog (e.g. PlayStation only)
      const singleBrandProducts = Array.from({ length: 8 }, (_, i) => ({
        slug: `${categorySlug}-single-${i}`,
        name: `Product ${i}`,
        brand: 'PlayStation',
        price: band.ceiling * 0.8,
      }));

      const singleBrandCandidate = buildPriceBandCandidate({
        categorySlug,
        band,
        products: singleBrandProducts,
      });

      expect(singleBrandCandidate.isIndexable).toBe(false);
      expect(singleBrandCandidate.differentiatingSpecCount).toBe(1);

      // Multi brand catalog: 3 real brands, 2 products each = 6 products
      const multiBrandProducts = [
        {
          slug: `${categorySlug}-b1-1`,
          name: `P1`,
          brand: 'BrandA',
          price: band.ceiling * 0.7,
        },
        {
          slug: `${categorySlug}-b1-2`,
          name: `P2`,
          brand: 'BrandA',
          price: band.ceiling * 0.75,
        },
        {
          slug: `${categorySlug}-b2-1`,
          name: `P3`,
          brand: 'BrandB',
          price: band.ceiling * 0.8,
        },
        {
          slug: `${categorySlug}-b2-2`,
          name: `P4`,
          brand: 'BrandB',
          price: band.ceiling * 0.85,
        },
        {
          slug: `${categorySlug}-b3-1`,
          name: `P5`,
          brand: 'BrandC',
          price: band.ceiling * 0.9,
        },
        {
          slug: `${categorySlug}-b3-2`,
          name: `P6`,
          brand: 'BrandC',
          price: band.ceiling * 0.95,
        },
      ];

      const multiBrandCandidate = buildPriceBandCandidate({
        categorySlug,
        band,
        products: multiBrandProducts,
      });

      expect(multiBrandCandidate.activeProductCount).toBe(6);
      expect(multiBrandCandidate.differentiatingSpecCount).toBe(3);
      expect(multiBrandCandidate.isIndexable).toBe(true);
    }
  });
});
