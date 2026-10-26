import { describe, expect, it } from 'vitest';
import {
  buildCategoryPriceBandCandidates,
  buildProductSupportLinks,
} from './build-commercial-support-links';

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
