import { describe, expect, it } from 'vitest';
import { buildCategorySupportLinks } from './build-commercial-support-links';
import { resolveCanonicalBrandKey } from './resolve-canonical-brand-key';

describe('buildCategorySupportLinks', () => {
  it('omits brand compare links when article inferred brands do not match category canonical top pair', () => {
    // Inventory top 2 brands are Apple (4 products) and Samsung (4 products)
    const products = [
      {
        slug: 'iphone-1',
        name: 'iPhone 15 Pro',
        brand: 'Apple',
        price: 800_000,
        category_slug: 'smartphones',
      },
      {
        slug: 'iphone-2',
        name: 'iPhone 15',
        brand: 'Apple',
        price: 700_000,
        category_slug: 'smartphones',
      },
      {
        slug: 'iphone-3',
        name: 'iPhone 14',
        brand: 'Apple',
        price: 600_000,
        category_slug: 'smartphones',
      },
      {
        slug: 'iphone-4',
        name: 'iPhone 13',
        brand: 'Apple',
        price: 500_000,
        category_slug: 'smartphones',
      },
      {
        slug: 'samsung-1',
        name: 'Galaxy S24',
        brand: 'Samsung',
        price: 750_000,
        category_slug: 'smartphones',
      },
      {
        slug: 'samsung-2',
        name: 'Galaxy S23',
        brand: 'Samsung',
        price: 650_000,
        category_slug: 'smartphones',
      },
      {
        slug: 'samsung-3',
        name: 'Galaxy A55',
        brand: 'Samsung',
        price: 350_000,
        category_slug: 'smartphones',
      },
      {
        slug: 'samsung-4',
        name: 'Galaxy A35',
        brand: 'Samsung',
        price: 300_000,
        category_slug: 'smartphones',
      },
      {
        slug: 'google-1',
        name: 'Pixel 8 Pro',
        brand: 'Google',
        price: 700_000,
        category_slug: 'smartphones',
      },
      {
        slug: 'google-2',
        name: 'Pixel 8',
        brand: 'Google',
        price: 600_000,
        category_slug: 'smartphones',
      },
    ];

    // Article is about Apple vs Google, but category top pair is Apple vs Samsung
    // Destination loader loadBrandCompare only resolves the single canonical pair (Apple vs Samsung)
    // Therefore, an apple-vs-google brand link must NOT be emitted
    const links = buildCategorySupportLinks({
      storeUrl: 'https://ogabassey.com',
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      products,
      inferredBrands: ['apple', 'google'],
    });

    const compareLinks = links.map((l) => l.href);
    expect(compareLinks).not.toContain(
      'https://ogabassey.com/smartphones/compare/apple-vs-google'
    );
    expect(compareLinks).not.toContain(
      'https://ogabassey.com/smartphones/compare/apple-vs-samsung'
    );
  });

  it('rejects brand comparisons when both sides map to the same canonical key (e.g. Redmi vs Xiaomi)', () => {
    // Inventory where top 2 brand names are Xiaomi and Redmi
    const products = [
      {
        slug: 'xiaomi-1',
        name: 'Xiaomi 14T',
        brand: 'Xiaomi',
        price: 600_000,
        category_slug: 'smartphones',
      },
      {
        slug: 'xiaomi-2',
        name: 'Xiaomi 13T',
        brand: 'Xiaomi',
        price: 500_000,
        category_slug: 'smartphones',
      },
      {
        slug: 'xiaomi-3',
        name: 'Xiaomi 12T',
        brand: 'Xiaomi',
        price: 400_000,
        category_slug: 'smartphones',
      },
      {
        slug: 'redmi-1',
        name: 'Redmi Note 13',
        brand: 'Redmi',
        price: 200_000,
        category_slug: 'smartphones',
      },
      {
        slug: 'redmi-2',
        name: 'Redmi Note 12',
        brand: 'Redmi',
        price: 180_000,
        category_slug: 'smartphones',
      },
      {
        slug: 'redmi-3',
        name: 'Redmi 13C',
        brand: 'Redmi',
        price: 150_000,
        category_slug: 'smartphones',
      },
    ];

    const links = buildCategorySupportLinks({
      storeUrl: 'https://ogabassey.com',
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      products,
    });

    // Should NOT emit xiaomi-vs-redmi or redmi-vs-xiaomi because leftKey === rightKey === 'xiaomi'
    expect(resolveCanonicalBrandKey('smartphones', 'Redmi')).toBe('xiaomi');
    expect(resolveCanonicalBrandKey('smartphones', 'Xiaomi')).toBe('xiaomi');
    const brandCompareHrefs = links
      .map((l) => l.href)
      .filter(
        (href) =>
          href.includes('/compare/xiaomi-vs-') ||
          href.includes('/compare/redmi-vs-')
      );
    expect(brandCompareHrefs).toEqual([]);
  });
});

describe('buildCategorySupportLinks brand relevance', () => {
  const samsungProducts = Array.from({ length: 6 }, (_, index) => ({
    slug: `galaxy-${index}`,
    name: `Galaxy Phone ${index}`,
    brand: 'Samsung',
    price: 300_000 + index * 10_000,
    category_slug: 'smartphones',
    product_key_specs: { chipset: 'Snapdragon', ram_gb: 12, storage_gb: 256 },
  }));

  it('emits no compare or price-band links for a no-brand article when relevance is required', () => {
    const links = buildCategorySupportLinks({
      storeUrl: 'https://store.test',
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      products: samsungProducts,
      inferredBrands: [],
      requireInferredBrandRelevance: true,
    });
    expect(links.filter((link) => link.href.includes('/compare/'))).toEqual([]);
    expect(links.filter((link) => link.href.includes('/best-under/'))).toEqual(
      []
    );
  });

  it('emits no price-band link when the band only contains other-brand products', () => {
    const links = buildCategorySupportLinks({
      storeUrl: 'https://store.test',
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      products: samsungProducts,
      inferredBrands: ['apple'],
      requireInferredBrandRelevance: true,
    });
    expect(links.filter((link) => link.href.includes('/best-under/'))).toEqual(
      []
    );
  });
});

describe('buildCategorySupportLinks price-band relevance', () => {
  it('still emits a band link for a single-brand article when the destination band is indexable and contains that brand', () => {
    const products = [
      ...Array.from({ length: 3 }, (_, index) => ({
        slug: `iphone-band-${index}`,
        name: `iPhone Band ${index}`,
        brand: 'Apple',
        price: 300_000 + index * 10_000,
        category_slug: 'smartphones',
        product_key_specs: { chipset: 'A', ram_gb: 8, storage_gb: 128 },
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        slug: `galaxy-band-${index}`,
        name: `Galaxy Band ${index}`,
        brand: 'Samsung',
        price: 320_000 + index * 10_000,
        category_slug: 'smartphones',
        product_key_specs: { chipset: 'S', ram_gb: 12, storage_gb: 256 },
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        slug: `tecno-band-${index}`,
        name: `Tecno Band ${index}`,
        brand: 'Tecno',
        price: 340_000 + index * 10_000,
        category_slug: 'smartphones',
        product_key_specs: { chipset: 'T', ram_gb: 8, storage_gb: 128 },
      })),
    ];
    const links = buildCategorySupportLinks({
      storeUrl: 'https://store.test',
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      products,
      inferredBrands: ['apple'],
      requireInferredBrandRelevance: true,
    });
    expect(links.some((link) => link.href.includes('/best-under/'))).toBe(true);
  });
});
