import { describe, expect, it } from 'vitest';
import { PRODUCT_SCOPED_COMPARE_DISCOVERY_PRODUCT_LIMIT } from '@/lib/storefront-compare/build-compare-discovery-links';
import { buildProductSemanticModel } from './build-product-semantic-model';
import {
  makeCandidate,
  makeInput,
  publishedGuidePosts,
} from './build-product-semantic-model.test-helpers';

describe('buildProductSemanticModel', () => {
  it('keeps the category hub link first and appends compare support links without duplicates', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-17-pro-max',
      name: 'iPhone 17 Pro Max',
      brand: 'Apple',
      price: 495_000,
      product_key_specs: { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 },
    });
    const inventory = [
      currentProduct,
      makeCandidate({
        slug: 'samsung-galaxy-z-trifold',
        name: 'Samsung Galaxy Z TriFold',
        brand: 'Samsung',
        price: 480_000,
        stock: 4,
        product_key_specs: {
          chipset: 'Snapdragon 8 Elite',
          ram_gb: 16,
          storage_gb: 512,
        },
      }),
      makeCandidate({
        slug: 'iphone-16e',
        name: 'iPhone 16e',
        brand: 'Apple',
        price: 450_000,
        stock: 12,
        product_key_specs: { chipset: 'A18', ram_gb: 8, storage_gb: 128 },
      }),
      makeCandidate({
        slug: 'iphone-15',
        name: 'iPhone 15',
        brand: 'Apple',
        price: 430_000,
        stock: 10,
        product_key_specs: { chipset: 'A17', ram_gb: 8, storage_gb: 128 },
      }),
      makeCandidate({
        slug: 'galaxy-a56',
        name: 'Galaxy A56',
        brand: 'Samsung',
        price: 410_000,
        stock: 9,
        product_key_specs: { chipset: 'Exynos', ram_gb: 8, storage_gb: 128 },
      }),
      makeCandidate({
        slug: 'galaxy-a36',
        name: 'Galaxy A36',
        brand: 'Samsung',
        price: 360_000,
        stock: 7,
        product_key_specs: {
          chipset: 'Snapdragon 7 Gen',
          ram_gb: 8,
          storage_gb: 128,
        },
      }),
      makeCandidate({
        slug: 'tecno-camon-40',
        name: 'Tecno Camon 40',
        brand: 'Tecno',
        price: 420_000,
        stock: 8,
        product_key_specs: {
          chipset: 'MediaTek Dimensity',
          ram_gb: 8,
          storage_gb: 256,
        },
      }),
    ];
    const model = buildProductSemanticModel(
      makeInput({
        currentProduct,
        inventory,
        guidePosts: [...publishedGuidePosts],
      })
    );

    expect(model.supportLinks[0]).toEqual({
      href: 'https://ogabassey.com/smartphones',
      label: 'Shop more Smartphones',
    });
    expect(new Set(model.supportLinks.map((link) => link.href)).size).toBe(
      model.supportLinks.length
    );
    expect(model.guideLinks).toEqual([
      {
        href: 'https://ogabassey.com/blog/apple-vs-samsung-buying-guide',
        title: 'Apple vs Samsung Buying Guide',
        description: 'Which ecosystem fits you.',
        kind: 'decision-support',
      },
      {
        href: 'https://ogabassey.com/blog/best-phones-in-nigeria',
        title: 'Best Phones in Nigeria',
        description: 'Budget and flagship phone picks.',
        kind: 'best-in-nigeria',
      },
    ]);
  });

  it('reserves the current PDP inside bounded compare discovery approval', () => {
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

    const model = buildProductSemanticModel(
      makeInput({
        currentProduct,
        inventory,
      })
    );

    expect(
      model.supportLinks.some((link) => link.href.includes('/compare/'))
    ).toBe(true);
    expect(model.supportLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: 'https://ogabassey.com/smartphones/best-under/under-500k',
        }),
      ])
    );
    expect(model.alternatives?.cards.length).toBeGreaterThan(0);
    expect(
      model.sameBrand?.cards.some((card) =>
        card.secondaryHref?.includes('/compare/')
      )
    ).toBe(true);
  });

  it('only emits semantic card compare CTAs for curated compare pairs', () => {
    const discoveryFirstProduct = makeCandidate({
      slug: 'nearby-challenger',
      name: 'Nearby Challenger',
      brand: 'OnePlus',
      condition: 'used',
      price: 510_000,
      stock: 1,
      product_key_specs: {
        chipset: 'Snapdragon 8 Gen 2',
        ram_gb: 8,
        storage_gb: 128,
      },
    });
    const currentProduct = makeCandidate({
      slug: 'target-phone',
      name: 'Target Phone',
      brand: 'Samsung',
      price: 500_000,
      stock: 5,
      product_key_specs: {
        chipset: 'Snapdragon 8 Gen 3',
        ram_gb: 12,
        storage_gb: 512,
      },
    });
    const semanticFirstProduct = makeCandidate({
      slug: 'premium-flagship',
      name: 'Premium Flagship',
      brand: 'Google',
      price: 1_500_000,
      stock: 12,
      product_key_specs: {
        chipset: 'Tensor G5',
        ram_gb: 16,
        storage_gb: 1024,
      },
    });

    const model = buildProductSemanticModel(
      makeInput({
        currentProduct,
        inventory: [
          discoveryFirstProduct,
          currentProduct,
          semanticFirstProduct,
          makeCandidate({
            slug: 'close-contender',
            name: 'Close Contender',
            brand: 'Xiaomi',
            condition: 'used',
            price: 520_000,
            stock: 8,
            product_key_specs: {
              chipset: 'Dimensity 9400',
              ram_gb: 10,
              storage_gb: 256,
            },
          }),
        ],
      })
    );
    const semanticFirstCard = model.alternatives?.cards.find(
      (card) => card.title === 'Premium Flagship'
    );
    const discoveryFirstCard = model.alternatives?.cards.find(
      (card) => card.title === 'Nearby Challenger'
    );
    const closeContenderCard = model.alternatives?.cards.find(
      (card) => card.title === 'Close Contender'
    );

    expect(model.alternatives?.cards[0]?.title).toBe('Premium Flagship');
    expect(semanticFirstCard?.secondaryHref).toBeUndefined();
    expect(closeContenderCard).toBeDefined();
    expect(closeContenderCard?.secondaryHref).toBe(
      'https://ogabassey.com/smartphones/compare/close-contender-vs-target-phone'
    );
    expect(discoveryFirstCard?.secondaryHref).toBe(
      'https://ogabassey.com/smartphones/compare/nearby-challenger-vs-target-phone'
    );
  });

  it('guarantees zero duplicate product hrefs across alternatives, sameBrand, and samePrice', () => {
    const currentProduct = makeCandidate({
      slug: 'galaxy-s25',
      name: 'Galaxy S25',
      brand: 'Samsung',
      price: 500_000,
    });
    const inventory = [
      currentProduct,
      makeCandidate({
        slug: 'galaxy-s24',
        name: 'Galaxy S24',
        brand: 'Samsung',
        price: 490_000,
      }),
      makeCandidate({
        slug: 'galaxy-s23',
        name: 'Galaxy S23',
        brand: 'Samsung',
        price: 480_000,
      }),
      makeCandidate({
        slug: 'iphone-16',
        name: 'iPhone 16',
        brand: 'Apple',
        price: 505_000,
      }),
      makeCandidate({
        slug: 'pixel-9',
        name: 'Pixel 9',
        brand: 'Google',
        price: 495_000,
      }),
      makeCandidate({
        slug: 'xiaomi-15',
        name: 'Xiaomi 15',
        brand: 'Xiaomi',
        price: 498_000,
      }),
    ];

    const model = buildProductSemanticModel(
      makeInput({ currentProduct, inventory })
    );

    const allHrefs = [
      ...(model.alternatives?.cards.map((c) => c.href) ?? []),
      ...(model.sameBrand?.cards.map((c) => c.href) ?? []),
      ...(model.samePrice?.cards.map((c) => c.href) ?? []),
    ];

    expect(allHrefs.length).toBeGreaterThan(0);
    expect(new Set(allHrefs).size).toBe(allHrefs.length);
    expect(allHrefs.some((href) => href.endsWith('/galaxy-s25'))).toBe(false);
  });

  it('preserves the missing-brand guard when currentProduct.brand is empty or undefined', () => {
    const currentProduct = makeCandidate({
      slug: 'generic-device',
      name: 'Generic Device',
      brand: '   ',
      price: 200_000,
    });
    const inventory = [
      currentProduct,
      makeCandidate({
        slug: 'other-device-1',
        name: 'Other Device 1',
        brand: 'Brand A',
        price: 205_000,
      }),
      makeCandidate({
        slug: 'other-device-2',
        name: 'Other Device 2',
        brand: '   ',
        price: 202_000,
      }),
    ];

    const model = buildProductSemanticModel(
      makeInput({ currentProduct, inventory })
    );

    expect(model.sameBrand).toBeNull();
    expect(model.alternatives?.cards.length).toBe(2);
  });

  it('allocates other-brand to alternatives and same-brand to sameBrand in minimal mixed-brand fixture', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-16-pro',
      name: 'iPhone 16 Pro',
      brand: 'Apple',
      price: 1_200_000,
    });
    const sameBrandCandidate = makeCandidate({
      slug: 'iphone-15-pro',
      name: 'iPhone 15 Pro',
      brand: 'Apple',
      price: 1_000_000,
    });
    const otherBrandCandidate = makeCandidate({
      slug: 'galaxy-s24-ultra',
      name: 'Galaxy S24 Ultra',
      brand: 'Samsung',
      price: 1_150_000,
    });

    const model = buildProductSemanticModel(
      makeInput({
        currentProduct,
        inventory: [currentProduct, sameBrandCandidate, otherBrandCandidate],
      })
    );

    expect(model.alternatives).not.toBeNull();
    expect(model.sameBrand).not.toBeNull();
    expect(model.alternatives?.cards).toHaveLength(1);
    expect(model.alternatives?.cards[0]?.href).toContain('galaxy-s24-ultra');
    expect(model.sameBrand?.cards).toHaveLength(1);
    expect(model.sameBrand?.cards[0]?.href).toContain('iphone-15-pro');
  });

  it('retains up to 2 cards in sameBrand while populating alternatives in multi-brand category', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-16',
      name: 'iPhone 16',
      brand: 'Apple',
      price: 800_000,
    });
    const inventory = [
      currentProduct,
      makeCandidate({
        slug: 'iphone-15',
        name: 'iPhone 15',
        brand: 'Apple',
        price: 750_000,
      }),
      makeCandidate({
        slug: 'iphone-14',
        name: 'iPhone 14',
        brand: 'Apple',
        price: 700_000,
      }),
      makeCandidate({
        slug: 'iphone-13',
        name: 'iPhone 13',
        brand: 'Apple',
        price: 650_000,
      }),
      makeCandidate({
        slug: 'pixel-8',
        name: 'Pixel 8',
        brand: 'Google',
        price: 780_000,
      }),
      makeCandidate({
        slug: 'galaxy-s24',
        name: 'Galaxy S24',
        brand: 'Samsung',
        price: 790_000,
      }),
    ];

    const model = buildProductSemanticModel(
      makeInput({ currentProduct, inventory })
    );

    expect(model.alternatives).not.toBeNull();
    expect(model.sameBrand).not.toBeNull();
    expect(model.sameBrand?.cards.length).toBeGreaterThanOrEqual(2);
    const alternativeHrefs = new Set(
      model.alternatives?.cards.map((c) => c.href)
    );
    const sameBrandHrefs = new Set(model.sameBrand?.cards.map((c) => c.href));
    for (const href of sameBrandHrefs) {
      expect(alternativeHrefs.has(href)).toBe(false);
    }
  });

  it('consumes all candidates in alternatives and returns null for sameBrand when single-brand has <= 6 candidates', () => {
    const currentProduct = makeCandidate({
      slug: 'macbook-pro-16',
      name: 'MacBook Pro 16',
      brand: 'Apple',
      price: 2_500_000,
    });
    const inventory = [
      currentProduct,
      makeCandidate({
        slug: 'macbook-pro-14',
        name: 'MacBook Pro 14',
        brand: 'Apple',
        price: 2_000_000,
      }),
      makeCandidate({
        slug: 'macbook-air-15',
        name: 'MacBook Air 15',
        brand: 'Apple',
        price: 1_600_000,
      }),
    ];

    const model = buildProductSemanticModel(
      makeInput({ currentProduct, inventory })
    );

    expect(model.alternatives?.cards).toHaveLength(2);
    expect(model.sameBrand).toBeNull();
  });

  it('allocates top 6 to alternatives and 7th candidate to sameBrand when single-brand has 7 candidates', () => {
    const currentProduct = makeCandidate({
      slug: 'ipad-pro-13',
      name: 'iPad Pro 13',
      brand: 'Apple',
      price: 1_500_000,
    });
    const candidates = Array.from({ length: 7 }, (_, i) =>
      makeCandidate({
        slug: `ipad-model-${i + 1}`,
        name: `iPad Model ${i + 1}`,
        brand: 'Apple',
        price: 1_000_000 + i * 50_000,
      })
    );

    const model = buildProductSemanticModel(
      makeInput({ currentProduct, inventory: [currentProduct, ...candidates] })
    );

    expect(model.alternatives?.cards).toHaveLength(6);
    expect(model.sameBrand).not.toBeNull();
    expect(model.sameBrand?.cards).toHaveLength(1);

    const alternativeSlugs = new Set(
      model.alternatives?.cards.map((c) => c.href)
    );
    const sameBrandSlugs = new Set(model.sameBrand?.cards.map((c) => c.href));
    for (const href of sameBrandSlugs) {
      expect(alternativeSlugs.has(href)).toBe(false);
    }
  });
});
