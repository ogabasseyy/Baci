import { describe, expect, it } from 'vitest';
import {
  buildCategoryPriceBandCandidates,
  buildCategorySupportLinks,
  buildProductSupportLinks,
} from './build-commercial-support-links';
import { resolveCanonicalBrandKey } from './resolve-canonical-brand-key';

describe('buildCategorySupportLinks', () => {
  it('returns product-compare, brand-compare, and price-band links for eligible categories', () => {
    expect(
      buildCategorySupportLinks({
        storeUrl: 'https://ogabassey.com',
        categorySlug: 'smartphones',
        categoryName: 'Smartphones',
        products: [
          {
            slug: 'samsung-galaxy-z-trifold',
            name: 'Samsung Galaxy Z TriFold',
            brand: 'Samsung',
            price: 480_000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'Snapdragon 8 Elite',
              ram_gb: 16,
              storage_gb: 512,
            },
          },
          {
            slug: 'iphone-17-pro-max',
            name: 'iPhone 17 Pro Max',
            brand: 'Apple',
            price: 495_000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'A19 Pro',
              ram_gb: 8,
              storage_gb: 256,
            },
          },
          {
            slug: 'galaxy-a56',
            name: 'Galaxy A56',
            brand: 'Samsung',
            price: 410_000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'Exynos',
              ram_gb: 8,
              storage_gb: 128,
            },
          },
          {
            slug: 'galaxy-a36',
            name: 'Galaxy A36',
            brand: 'Samsung',
            price: 360_000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'Snapdragon 7 Gen',
              ram_gb: 8,
              storage_gb: 128,
            },
          },
          {
            slug: 'iphone-16e',
            name: 'iPhone 16e',
            brand: 'Apple',
            price: 450_000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'A18',
              ram_gb: 8,
              storage_gb: 128,
            },
          },
          {
            slug: 'iphone-15',
            name: 'iPhone 15',
            brand: 'Apple',
            price: 430_000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'A17',
              ram_gb: 8,
              storage_gb: 128,
            },
          },
          {
            slug: 'tecno-camon-40',
            name: 'Tecno Camon 40',
            brand: 'Tecno',
            price: 420_000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'MediaTek Dimensity',
              ram_gb: 8,
              storage_gb: 256,
            },
          },
        ],
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
        expect.objectContaining({
          href: 'https://ogabassey.com/smartphones/compare/apple-vs-samsung',
        }),
        expect.objectContaining({
          href: 'https://ogabassey.com/smartphones/best-under/under-500k',
        }),
      ])
    );
  });

  it('publishes the first eligible product compare link even when the first pair is not indexable', () => {
    const links = buildCategorySupportLinks({
      storeUrl: 'https://ogabassey.com',
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      products: [
        {
          slug: 'iphone-17-air',
          name: 'iPhone 17 Air',
          brand: 'Apple',
          price: 520_000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'A19',
            ram_gb: 8,
            storage_gb: 128,
          },
        },
        {
          slug: 'iphone-17-plus',
          name: 'iPhone 17 Plus',
          brand: 'Apple',
          price: 540_000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'A19',
            ram_gb: 8,
            storage_gb: 128,
          },
        },
        {
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          brand: 'Apple',
          price: 495_000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'A19 Pro',
            ram_gb: 8,
            storage_gb: 256,
          },
        },
        {
          slug: 'samsung-galaxy-z-trifold',
          name: 'Samsung Galaxy Z TriFold',
          brand: 'Samsung',
          price: 480_000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'Snapdragon 8 Elite',
            ram_gb: 16,
            storage_gb: 512,
          },
        },
      ],
    });

    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: expect.stringMatching(
            /^https:\/\/ogabassey\.com\/smartphones\/compare\/.+-vs-.+$/
          ),
        }),
      ])
    );
    expect(links.map((link) => link.href)).not.toContain(
      'https://ogabassey.com/smartphones/compare/iphone-17-air-vs-iphone-17-plus'
    );
  });

  it('can omit brand compare links for sampled category inventories', () => {
    const links = buildCategorySupportLinks({
      storeUrl: 'https://ogabassey.com',
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      includeBrandCompareLink: false,
      products: [
        {
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          brand: 'Apple',
          price: 495_000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'A19 Pro',
            ram_gb: 8,
            storage_gb: 256,
          },
        },
        {
          slug: 'samsung-galaxy-z-trifold',
          name: 'Samsung Galaxy Z TriFold',
          brand: 'Samsung',
          price: 480_000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'Snapdragon 8 Elite',
            ram_gb: 16,
            storage_gb: 512,
          },
        },
        {
          slug: 'iphone-16e',
          name: 'iPhone 16e',
          brand: 'Apple',
          price: 450_000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'A18',
            ram_gb: 8,
            storage_gb: 128,
          },
        },
        {
          slug: 'galaxy-a56',
          name: 'Galaxy A56',
          brand: 'Samsung',
          price: 410_000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'Exynos',
            ram_gb: 8,
            storage_gb: 128,
          },
        },
      ],
    });

    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      ])
    );
    expect(links.map((link) => link.href)).not.toContain(
      'https://ogabassey.com/smartphones/compare/apple-vs-samsung'
    );
  });

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

describe('buildProductSupportLinks', () => {
  it('omits product comparisons when the approved set is empty', () => {
    const links = buildProductSupportLinks({
      approvedCompareSlugs: new Set(),
      storeUrl: 'https://ogabassey.com',
      categorySlug: 'smartphones',
      currentProductSlug: 'current-phone',
      currentProductPrice: 500_000,
      includeBrandCompareLink: false,
      products: [
        {
          slug: 'current-phone',
          name: 'Current Phone',
          price: 500_000,
          category_slug: 'smartphones',
          product_key_specs: { chipset: 'A', ram_gb: 8, storage_gb: 128 },
        },
        {
          slug: 'alternate-phone',
          name: 'Alternate Phone',
          price: 480_000,
          category_slug: 'smartphones',
          product_key_specs: { chipset: 'B', ram_gb: 12, storage_gb: 256 },
        },
      ],
    });

    expect(links.some((link) => link.href.includes('/compare/'))).toBe(false);
  });

  it('selects the first approved comparison instead of dropping PDP comparison support', () => {
    const links = buildProductSupportLinks({
      approvedCompareSlugs: new Set(['approved-phone-vs-current-phone']),
      storeUrl: 'https://ogabassey.com',
      categorySlug: 'smartphones',
      currentProductSlug: 'current-phone',
      currentProductPrice: 500_000,
      includeBrandCompareLink: false,
      products: [
        {
          slug: 'current-phone',
          name: 'Current Phone',
          brand: 'Current',
          price: 500_000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'Current Chip',
            ram_gb: 8,
            storage_gb: 128,
          },
        },
        {
          slug: 'uncurated-phone',
          name: 'Uncurated Phone',
          brand: 'Other',
          price: 490_000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'Other Chip',
            ram_gb: 12,
            storage_gb: 256,
          },
        },
        {
          slug: 'approved-phone',
          name: 'Approved Phone',
          brand: 'Approved',
          price: 480_000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'Approved Chip',
            ram_gb: 16,
            storage_gb: 512,
          },
        },
      ],
    });

    expect(links).toEqual(
      expect.arrayContaining([
        {
          href: 'https://ogabassey.com/smartphones/compare/approved-phone-vs-current-phone',
          label: 'Compare with Approved Phone',
        },
      ])
    );
    expect(links.some((link) => link.href.includes('uncurated-phone'))).toBe(
      false
    );
  });

  it('returns compare and price-band links for the current product context', () => {
    expect(
      buildProductSupportLinks({
        storeUrl: 'https://ogabassey.com',
        categorySlug: 'smartphones',
        currentProductSlug: 'iphone-17-pro-max',
        currentProductPrice: 495_000,
        products: [
          {
            slug: 'iphone-17-pro-max',
            name: 'iPhone 17 Pro Max',
            brand: 'Apple',
            price: 495_000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'A19 Pro',
              ram_gb: 8,
              storage_gb: 256,
            },
          },
          {
            slug: 'samsung-galaxy-z-trifold',
            name: 'Samsung Galaxy Z TriFold',
            brand: 'Samsung',
            price: 480_000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'Snapdragon 8 Elite',
              ram_gb: 16,
              storage_gb: 512,
            },
          },
          {
            slug: 'iphone-16e',
            name: 'iPhone 16e',
            brand: 'Apple',
            price: 450_000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'A18',
              ram_gb: 8,
              storage_gb: 128,
            },
          },
          {
            slug: 'iphone-15',
            name: 'iPhone 15',
            brand: 'Apple',
            price: 430_000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'A17',
              ram_gb: 8,
              storage_gb: 128,
            },
          },
          {
            slug: 'galaxy-a56',
            name: 'Galaxy A56',
            brand: 'Samsung',
            price: 410_000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'Exynos',
              ram_gb: 8,
              storage_gb: 128,
            },
          },
          {
            slug: 'galaxy-a36',
            name: 'Galaxy A36',
            brand: 'Samsung',
            price: 360_000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'Snapdragon 7 Gen',
              ram_gb: 8,
              storage_gb: 128,
            },
          },
          {
            slug: 'tecno-camon-40',
            name: 'Tecno Camon 40',
            brand: 'Tecno',
            price: 420_000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'MediaTek Dimensity',
              ram_gb: 8,
              storage_gb: 256,
            },
          },
        ],
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
        expect.objectContaining({
          href: 'https://ogabassey.com/smartphones/compare/apple-vs-samsung',
        }),
        expect.objectContaining({
          href: 'https://ogabassey.com/smartphones/best-under/under-500k',
        }),
      ])
    );
  });

  it('yields identical links whether priceBandCandidates is precomputed or self-computed', () => {
    const products = [
      {
        slug: 'iphone-17-pro-max',
        name: 'iPhone 17 Pro Max',
        brand: 'Apple',
        price: 495_000,
        category_slug: 'smartphones',
        product_key_specs: { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 },
      },
      {
        slug: 'samsung-galaxy-z-trifold',
        name: 'Samsung Galaxy Z TriFold',
        brand: 'Samsung',
        price: 480_000,
        category_slug: 'smartphones',
        product_key_specs: {
          chipset: 'Snapdragon 8 Elite',
          ram_gb: 16,
          storage_gb: 512,
        },
      },
      {
        slug: 'iphone-16e',
        name: 'iPhone 16e',
        brand: 'Apple',
        price: 450_000,
        category_slug: 'smartphones',
        product_key_specs: { chipset: 'A18', ram_gb: 8, storage_gb: 128 },
      },
    ];
    const base = {
      storeUrl: 'https://ogabassey.com',
      categorySlug: 'smartphones',
      currentProductSlug: 'iphone-17-pro-max',
      currentProductPrice: 495_000,
      products,
    };

    // The hoisted, product-invariant candidate list must produce byte-identical
    // links to letting buildProductSupportLinks compute them itself — this is
    // what makes the discovery fan-out's compute-once optimization safe.
    const precomputed = buildProductSupportLinks({
      ...base,
      priceBandCandidates: buildCategoryPriceBandCandidates(
        'smartphones',
        products
      ),
    });
    const selfComputed = buildProductSupportLinks(base);

    expect(precomputed).toEqual(selfComputed);
  });
});
