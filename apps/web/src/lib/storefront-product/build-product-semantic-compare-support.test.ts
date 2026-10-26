import { describe, expect, it } from 'vitest';
import { PRODUCT_SCOPED_COMPARE_DISCOVERY_PRODUCT_LIMIT } from '@/lib/storefront-compare/build-compare-discovery-links';
import { parseCompareSlug } from '@/lib/storefront-compare/compare-slugs';
import {
  buildProductSemanticCompareSupport,
  isApprovedSupportLink,
  MAX_PRODUCT_SUPPORT_LINKS,
} from './build-product-semantic-compare-support';
import type {
  BuildProductSemanticModelInput,
  ProductSemanticCandidate,
} from './product-semantic-types';

function makeCandidate(
  overrides: Partial<ProductSemanticCandidate> &
    Pick<ProductSemanticCandidate, 'slug' | 'name' | 'price'>
): ProductSemanticCandidate {
  return {
    brand: 'Brand',
    category_slug: 'smartphones',
    condition: 'new',
    product_key_specs: {
      chipset: 'Chip',
      ram_gb: 8,
      storage_gb: 128,
    },
    stock: 5,
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<BuildProductSemanticModelInput> &
    Pick<BuildProductSemanticModelInput, 'currentProduct' | 'inventory'>
): BuildProductSemanticModelInput {
  return {
    storeUrl: 'https://ogabassey.com',
    merchantBusinessName: 'Ogabassey',
    categorySlug: 'smartphones',
    categoryName: 'Smartphones',
    ...overrides,
  };
}

describe('buildProductSemanticCompareSupport', () => {
  it('does not approve a compare participant with a product-slug prefix only', () => {
    expect(
      isApprovedSupportLink({
        approvedCompareSlugs: new Set(['current-phone-vs-other-phone']),
        categorySlug: 'smartphones',
        href: 'https://ogabassey.com/smartphones/compare/current-phone-plus-vs-other-phone',
      })
    ).toBe(false);
  });

  it('keeps only the category hub when inventory is empty', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-17-pro-max',
      name: 'iPhone 17 Pro Max',
      brand: 'Apple',
      price: 495_000,
    });
    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [],
      })
    );

    expect(support.approvedCompareSlugs.size).toBe(0);
    expect(support.supportLinks).toEqual([
      {
        href: 'https://ogabassey.com/smartphones',
        label: 'Shop more Smartphones',
      },
    ]);
  });

  it('normalizes trailing store URLs before building support links', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-17-pro-max',
      name: 'iPhone 17 Pro Max',
      price: 495_000,
    });
    const support = buildProductSemanticCompareSupport(
      makeInput({
        storeUrl: 'https://ogabassey.com/',
        currentProduct,
        inventory: [],
      })
    );

    expect(support.supportLinks[0]).toEqual({
      href: 'https://ogabassey.com/smartphones',
      label: 'Shop more Smartphones',
    });
    expect(
      support.supportLinks.some((link) => link.href.includes('.com//'))
    ).toBe(false);
  });

  it('keeps category support when inventory has no matching category products', () => {
    const currentProduct = makeCandidate({
      slug: 'laptop-pro',
      name: 'Laptop Pro',
      category_slug: 'laptops',
      price: 900_000,
    });
    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [
          currentProduct,
          makeCandidate({
            slug: 'laptop-air',
            name: 'Laptop Air',
            category_slug: 'laptops',
            price: 850_000,
          }),
        ],
      })
    );

    expect(support.approvedCompareSlugs.size).toBe(0);
    expect(support.supportLinks).toEqual([
      {
        href: 'https://ogabassey.com/smartphones',
        label: 'Shop more Smartphones',
      },
    ]);
  });

  it('reserves an older current PDP in the bounded compare approval window', () => {
    const inventory = Array.from(
      { length: PRODUCT_SCOPED_COMPARE_DISCOVERY_PRODUCT_LIMIT + 1 },
      (_, index) =>
        makeCandidate({
          slug: `phone-${index}`,
          name: `Phone ${index}`,
          brand: `Brand ${index % 5}`,
          price: 300_000 + index,
          product_key_specs: {
            chipset: `Chip ${index}`,
            ram_gb: 8 + index,
            storage_gb: 128 + index,
          },
        })
    );
    const currentProduct = inventory.at(-1);

    if (!currentProduct) {
      throw new Error('Expected generated current product');
    }

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory,
      })
    );

    const compareLinks = support.supportLinks.filter((link) =>
      link.href.includes('/compare/')
    );
    expect(compareLinks.length).toBeGreaterThan(0);
    expect(
      compareLinks.every((link) => {
        const slug = link.href.split('/compare/')[1]?.split(/[?#]/)[0];
        const parsed = slug ? parseCompareSlug(slug) : null;
        return Boolean(
          parsed &&
            [parsed.leftKey, parsed.rightKey].includes(currentProduct.slug)
        );
      })
    ).toBe(true);
    expect(
      Array.from(support.approvedCompareSlugs).some((slug) =>
        slug.split('-vs-').includes(currentProduct.slug)
      )
    ).toBe(true);
    expect(support.supportLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: 'https://ogabassey.com/smartphones/best-under/under-500k',
        }),
      ])
    );
  });

  it('deduplicates inventory slugs before applying the discovery limit', () => {
    const currentProduct = makeCandidate({
      slug: 'current-phone',
      name: 'Current Phone',
      brand: 'Current Brand',
      price: 500_000,
    });
    const repeatedProduct = makeCandidate({
      slug: 'repeated-phone',
      name: 'Unrelated Budget Device',
      brand: 'Other Brand',
      price: 10_000,
    });
    const finalUniqueProduct = makeCandidate({
      slug: 'final-unique-phone',
      name: 'Current Phone Plus',
      brand: 'Current Brand',
      price: 499_999,
      product_key_specs: {
        chipset: 'Other Chip',
        ram_gb: 16,
        storage_gb: 256,
      },
    });
    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [
          ...Array.from(
            { length: PRODUCT_SCOPED_COMPARE_DISCOVERY_PRODUCT_LIMIT },
            () => repeatedProduct
          ),
          finalUniqueProduct,
        ],
      })
    );

    expect(
      Array.from(support.approvedCompareSlugs).some((slug) =>
        slug.split('-vs-').includes(finalUniqueProduct.slug)
      )
    ).toBe(true);
  });

  it('normalizes missing category slugs before building support links', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-17-pro-max',
      name: 'iPhone 17 Pro Max',
      brand: 'Apple',
      category_slug: undefined,
      price: 495_000,
      product_key_specs: {
        chipset: 'A19 Pro',
        ram_gb: 8,
        storage_gb: 256,
      },
    });
    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [
          currentProduct,
          makeCandidate({
            slug: 'samsung-galaxy-z-trifold',
            name: 'Samsung Galaxy Z TriFold',
            brand: 'Samsung',
            category_slug: undefined,
            price: 480_000,
            product_key_specs: {
              chipset: 'Snapdragon 8 Elite',
              ram_gb: 16,
              storage_gb: 512,
            },
          }),
        ],
      })
    );

    expect(support.input.currentProduct.category_slug).toBe('smartphones');
    expect(
      support.input.inventory.every((product) => product.category_slug)
    ).toBe(true);
    expect(support.supportLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      ])
    );
  });

  it('fails closed for malformed compare support links', () => {
    const approvedCompareSlugs = new Set(['iphone-vs-samsung']);

    expect(
      isApprovedSupportLink({
        approvedCompareSlugs,
        categorySlug: 'smartphones',
        href: 'https://ogabassey.com/smartphones/best-under/under-500k',
      })
    ).toBe(true);
    expect(
      isApprovedSupportLink({
        approvedCompareSlugs,
        categorySlug: 'smartphones',
        href: 'https://ogabassey.com/smartphones/compare/samsung-vs-iphone',
      })
    ).toBe(true);
    expect(
      isApprovedSupportLink({
        approvedCompareSlugs,
        categorySlug: 'smartphones',
        href: 'https://ogabassey.com/smartphones/compare/not-a-pair',
      })
    ).toBe(false);
    expect(
      isApprovedSupportLink({
        approvedCompareSlugs,
        categorySlug: 'smartphones',
        href: 'https://ogabassey.com/smartphones/compare/apple-vs-pixel',
      })
    ).toBe(false);
  });

  it('exports MAX_PRODUCT_SUPPORT_LINKS as 5', () => {
    expect(MAX_PRODUCT_SUPPORT_LINKS).toBe(5);
  });

  it('defaults omitted hubEligibilityInventory to empty array and emits no brand/family links', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-15-pro-max',
      name: 'iPhone 15 Pro Max',
      brand: 'Apple',
      price: 1_200_000,
    });
    // inventory has >= 5 Apple products
    const inventory = [
      currentProduct,
      makeCandidate({
        slug: 'iphone-15-pro',
        name: 'iPhone 15 Pro',
        brand: 'Apple',
        price: 1_100_000,
      }),
      makeCandidate({
        slug: 'iphone-15',
        name: 'iPhone 15',
        brand: 'Apple',
        price: 900_000,
      }),
      makeCandidate({
        slug: 'iphone-14',
        name: 'iPhone 14',
        brand: 'Apple',
        price: 800_000,
      }),
      makeCandidate({
        slug: 'iphone-13',
        name: 'iPhone 13',
        brand: 'Apple',
        price: 700_000,
      }),
    ];

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory,
        // hubEligibilityInventory omitted
      })
    );

    expect(support.supportLinks.some((l) => l.href.includes('/brands/'))).toBe(
      false
    );
    expect(
      support.supportLinks.some((l) => l.href.includes('/families/'))
    ).toBe(false);
  });

  it('emits no brand/family links on explicit hubEligibilityInventory: [] while preserving category and compare links', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-15-pro-max',
      name: 'iPhone 15 Pro Max',
      brand: 'Apple',
      price: 1_200_000,
      product_key_specs: { chipset: 'A17 Pro', ram_gb: 8, storage_gb: 256 },
    });
    const comparePartner = makeCandidate({
      slug: 'samsung-s24-ultra',
      name: 'Samsung Galaxy S24 Ultra',
      brand: 'Samsung',
      price: 1_150_000,
      product_key_specs: {
        chipset: 'Snapdragon 8 Gen 3',
        ram_gb: 12,
        storage_gb: 512,
      },
    });

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [currentProduct, comparePartner],
        hubEligibilityInventory: [],
      })
    );

    expect(support.supportLinks[0]).toEqual({
      href: 'https://ogabassey.com/smartphones',
      label: 'Shop more Smartphones',
    });
    expect(support.supportLinks.some((l) => l.href.includes('/brands/'))).toBe(
      false
    );
    expect(support.supportLinks.some((l) => l.href.includes('/compare/'))).toBe(
      true
    );
  });

  it('emits canonical brand and model-family hub links when hubEligibilityInventory meets thresholds', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-15-pro-max',
      name: 'iPhone 15 Pro Max',
      brand: 'Apple',
      price: 1_200_000,
    });
    const hubEligibilityInventory = [
      {
        slug: 'iphone-15-pro-max',
        name: 'iPhone 15 Pro Max',
        brand: 'Apple',
        price: 1_200_000,
        availability: 'InStock' as const,
        stock: 5,
        category_slug: 'smartphones',
      },
      {
        slug: 'iphone-15-pro',
        name: 'iPhone 15 Pro',
        brand: 'Apple',
        price: 1_100_000,
        availability: 'InStock' as const,
        stock: 3,
        category_slug: 'smartphones',
      },
      {
        slug: 'iphone-15',
        name: 'iPhone 15',
        brand: 'Apple',
        price: 900_000,
        availability: 'InStock' as const,
        stock: 0,
        category_slug: 'smartphones',
      }, // unmanaged zero-stock
      {
        slug: 'iphone-14',
        name: 'iPhone 14',
        brand: 'Apple',
        price: 800_000,
        availability: 'InStock' as const,
        stock: 2,
        category_slug: 'smartphones',
      },
      {
        slug: 'iphone-13',
        name: 'iPhone 13',
        brand: 'Apple',
        price: 700_000,
        availability: 'InStock' as const,
        stock: 4,
        category_slug: 'smartphones',
      },
    ];

    const support = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [currentProduct],
        hubEligibilityInventory,
      })
    );

    expect(support.supportLinks).toEqual(
      expect.arrayContaining([
        {
          href: 'https://ogabassey.com/smartphones/brands/apple',
          label: 'Explore Apple iPhone',
        },
        {
          href: 'https://ogabassey.com/smartphones/brands/apple/families/iphone-15',
          label: 'Explore iPhone 15 Series',
        },
      ])
    );
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

  it('respects threshold boundaries: 4 brand products yields no hubs, 5 brand products with 2 family products yields only brand hub', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-15-pro',
      name: 'iPhone 15 Pro',
      brand: 'Apple',
      price: 1_100_000,
    });

    // 4 brand products (< 5 minimumProducts)
    const fourProductsInventory = [
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

    const underBrandThreshold = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [currentProduct],
        hubEligibilityInventory: fourProductsInventory,
      })
    );
    expect(
      underBrandThreshold.supportLinks.some((l) => l.href.includes('/brands/'))
    ).toBe(false);
    expect(
      underBrandThreshold.supportLinks.some((l) =>
        l.href.includes('/families/')
      )
    ).toBe(false);

    // 5 brand products, but only 2 iPhone 15s (< 3 family minimumProducts)
    const twoFamilyProductsInventory = [
      'iPhone 15 Pro',
      'iPhone 15',
      'iPhone 14',
      'iPhone 13',
      'iPhone 12',
    ].map((name, i) => ({
      slug: `iphone-${i}`,
      name,
      brand: 'Apple',
      price: 1_000_000,
      availability: 'InStock' as const,
      stock: 5,
      category_slug: 'smartphones',
    }));

    const underFamilyThreshold = buildProductSemanticCompareSupport(
      makeInput({
        currentProduct,
        inventory: [currentProduct],
        hubEligibilityInventory: twoFamilyProductsInventory,
      })
    );
    expect(
      underFamilyThreshold.supportLinks.some(
        (l) => l.href === 'https://ogabassey.com/smartphones/brands/apple'
      )
    ).toBe(true);
    expect(
      underFamilyThreshold.supportLinks.some((l) =>
        l.href.includes('/families/')
      )
    ).toBe(false);
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
