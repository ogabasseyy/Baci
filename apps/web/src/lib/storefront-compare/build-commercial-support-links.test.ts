import { describe, expect, it } from 'vitest';
import { buildCategorySupportLinks } from './build-commercial-support-links';

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
});
