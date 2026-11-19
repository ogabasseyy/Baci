import { describe, expect, it } from 'vitest';
import {
  buildProductSemanticCompareSupport,
  MAX_PRODUCT_SUPPORT_LINKS,
} from './build-product-semantic-compare-support';
import {
  makeCandidate,
  makeInput,
} from './build-product-semantic-compare-support.test-helpers';

describe('buildProductSemanticCompareSupport hub links and priority', () => {
  it('exports MAX_PRODUCT_SUPPORT_LINKS as 5', () => {
    expect(MAX_PRODUCT_SUPPORT_LINKS).toBe(5);
  });

  it('matches brand aliases correctly (iPhone -> apple, Redmi -> xiaomi, MacBook -> apple)', () => {
    // 1. iPhone alias in smartphones
    const iphoneProduct = makeCandidate({
      slug: 'iphone-15-pro',
      name: 'iPhone 15 Pro',
      brand: 'iPhone', // alias
      price: 1_100_000,
    });
    const appleHubInventory = [
      'iPhone 15 Pro Max',
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

    const iphoneSupport = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct: iphoneProduct,
        inventory: [iphoneProduct],
        hubEligibilityInventory: appleHubInventory,
      })
    );
    expect(iphoneSupport.supportLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: 'https://ogabassey.com/smartphones/brands/apple',
        }),
      ])
    );

    // 2. Redmi alias in smartphones
    const redmiProduct = makeCandidate({
      slug: 'redmi-note-13',
      name: 'Redmi Note 13',
      brand: 'Redmi', // alias for Xiaomi
      price: 250_000,
    });
    const xiaomiHubInventory = [
      'Redmi Note 13 Pro',
      'Redmi Note 13',
      'Redmi 13C',
      'Xiaomi 14',
      'Xiaomi 13T',
    ].map((name, i) => ({
      slug: `xiaomi-${i}`,
      name,
      brand: 'Xiaomi',
      price: 250_000,
      availability: 'InStock' as const,
      stock: 5,
      category_slug: 'smartphones',
    }));

    const redmiSupport = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct: redmiProduct,
        inventory: [redmiProduct],
        hubEligibilityInventory: xiaomiHubInventory,
      })
    );
    expect(redmiSupport.supportLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: 'https://ogabassey.com/smartphones/brands/xiaomi',
        }),
      ])
    );

    // 3. MacBook alias in laptops
    const macbookProduct = makeCandidate({
      slug: 'macbook-pro-14',
      name: 'MacBook Pro 14',
      brand: 'MacBook', // alias for Apple in laptops
      category_slug: 'laptops',
      price: 2_500_000,
    });
    const macbookHubInventory = [
      'MacBook Pro 14',
      'MacBook Pro 16',
      'MacBook Air 13',
      'MacBook Air 15',
      'MacBook Pro 13',
    ].map((name, i) => ({
      slug: `macbook-${i}`,
      name,
      brand: 'Apple',
      price: 2_000_000,
      availability: 'InStock' as const,
      stock: 5,
      category_slug: 'laptops',
    }));

    const macbookSupport = buildProductSemanticCompareSupport(
      makeInput({
        categorySlug: 'laptops',
        categoryName: 'Laptops',
        currentProduct: macbookProduct,
        inventory: [macbookProduct],
        hubEligibilityInventory: macbookHubInventory,
      })
    );
    expect(macbookSupport.supportLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: 'https://ogabassey.com/laptops/brands/apple',
        }),
      ])
    );
  });

  it('does not truncate >150-item hubEligibilityInventory via compare discovery limit', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-15-pro',
      name: 'iPhone 15 Pro',
      brand: 'Apple',
      price: 1_100_000,
    });

    // 160 items: 157 iPhone 13s + 3 iPhone 15s at the very end (index 157, 158, 159)
    const largeInventory = [
      ...Array.from({ length: 157 }, (_, i) => ({
        slug: `iphone-13-${i}`,
        name: `iPhone 13 Model ${i}`,
        brand: 'Apple',
        price: 800_000,
        availability: 'InStock' as const,
        stock: 5,
        category_slug: 'smartphones',
      })),
      {
        slug: 'iphone-15-pro',
        name: 'iPhone 15 Pro',
        brand: 'Apple',
        price: 1_100_000,
        availability: 'InStock' as const,
        stock: 5,
        category_slug: 'smartphones',
      },
      {
        slug: 'iphone-15-plus',
        name: 'iPhone 15 Plus',
        brand: 'Apple',
        price: 950_000,
        availability: 'InStock' as const,
        stock: 5,
        category_slug: 'smartphones',
      },
      {
        slug: 'iphone-15-base',
        name: 'iPhone 15',
        brand: 'Apple',
        price: 900_000,
        availability: 'InStock' as const,
        stock: 5,
        category_slug: 'smartphones',
      },
    ];

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [currentProduct],
        hubEligibilityInventory: largeInventory,
      })
    );

    // If hubEligibilityInventory were truncated to 150 items, the 3 iPhone 15 items at the end would be lost!
    expect(
      support.supportLinks.some((l) => l.href.includes('/families/iphone-15'))
    ).toBe(true);
  });

  it('enforces deterministic priority order and caps supportLinks at MAX_PRODUCT_SUPPORT_LINKS (5)', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-15-pro-max',
      name: 'iPhone 15 Pro Max',
      brand: 'Apple',
      price: 495_000,
      product_key_specs: { chipset: 'A17 Pro', ram_gb: 8, storage_gb: 256 },
    });
    // Create inventory with multiple compare partners and containing price band
    const inventory = [
      currentProduct,
      makeCandidate({
        slug: 'samsung-s24-ultra',
        name: 'Samsung Galaxy S24 Ultra',
        brand: 'Samsung',
        price: 490_000,
        product_key_specs: {
          chipset: 'Snapdragon 8 Gen 3',
          ram_gb: 12,
          storage_gb: 256,
        },
      }),
      makeCandidate({
        slug: 'pixel-8-pro',
        name: 'Google Pixel 8 Pro',
        brand: 'Google',
        price: 480_000,
        product_key_specs: {
          chipset: 'Tensor G3',
          ram_gb: 12,
          storage_gb: 256,
        },
      }),
      makeCandidate({
        slug: 'xiaomi-14-ultra',
        name: 'Xiaomi 14 Ultra',
        brand: 'Xiaomi',
        price: 485_000,
        product_key_specs: {
          chipset: 'Snapdragon 8 Gen 3',
          ram_gb: 16,
          storage_gb: 512,
        },
      }),
    ];
    const hubEligibilityInventory = [
      'iPhone 15 Pro Max',
      'iPhone 15 Pro',
      'iPhone 15',
      'iPhone 14',
      'iPhone 13',
    ].map((name, i) => ({
      slug: `iphone-${i}`,
      name,
      brand: 'Apple',
      price: 495_000,
      availability: 'InStock' as const,
      stock: 5,
      category_slug: 'smartphones',
    }));

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory,
        hubEligibilityInventory,
      })
    );

    expect(support.supportLinks.length).toBeLessThanOrEqual(
      MAX_PRODUCT_SUPPORT_LINKS
    );
    // Priority order:
    // 1. Category Hub
    expect(support.supportLinks[0]?.href).toBe(
      'https://ogabassey.com/smartphones'
    );
    // 2. Brand Hub
    expect(support.supportLinks[1]?.href).toBe(
      'https://ogabassey.com/smartphones/brands/apple'
    );
    // 3. Model-Family Hub
    expect(support.supportLinks[2]?.href).toBe(
      'https://ogabassey.com/smartphones/brands/apple/families/iphone-15'
    );
    // 4. Compare link / Price-band
    expect(support.supportLinks[3]?.href).toMatch(/\/compare\/|\/best-under\//);
  });
});
