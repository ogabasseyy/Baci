import { describe, expect, it } from 'vitest';
import { PRODUCT_SCOPED_COMPARE_DISCOVERY_PRODUCT_LIMIT } from '@/lib/storefront-compare/build-compare-discovery-links';
import {
  buildProductSemanticModel,
  MAX_SEMANTIC_SECTION_CARDS,
} from './build-product-semantic-model';
import type {
  BuildProductSemanticModelInput,
  ProductSemanticCandidate,
} from './product-semantic-types';

function makeCandidate(
  overrides: Partial<ProductSemanticCandidate> &
    Pick<ProductSemanticCandidate, 'slug' | 'name' | 'price'>
): ProductSemanticCandidate {
  return {
    brand: null,
    condition: 'new',
    stock: 5,
    category_slug: 'smartphones',
    product_key_specs: {},
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

const publishedGuidePosts = [
  {
    slug: 'best-phones-in-nigeria',
    title: 'Best Phones in Nigeria',
    excerpt: 'Budget and flagship phone picks.',
    category: 'Smartphones',
    tags: ['smartphones', 'budget', 'iphone'],
    keywords: ['android', 'battery'],
    featured_image_url: null,
    published_at: '2026-04-10T09:00:00.000Z',
    reading_time_minutes: 6,
  },
  {
    slug: 'apple-vs-samsung-buying-guide',
    title: 'Apple vs Samsung Buying Guide',
    excerpt: 'Which ecosystem fits you.',
    category: 'Smartphones',
    tags: ['smartphones', 'apple', 'samsung'],
    keywords: ['iphone', 'galaxy'],
    featured_image_url: null,
    published_at: '2026-04-09T09:00:00.000Z',
    reading_time_minutes: 5,
  },
];

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
      model.alternatives?.cards.some((card) =>
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

  it('keeps PDP support links when category inventory rows omit category_slug', () => {
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
    const model = buildProductSemanticModel(
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

    expect(model.supportLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      ])
    );
  });

  it('formats semantic card prices with the storefront country currency', () => {
    const currentProduct = makeCandidate({
      slug: 'kurta-set',
      name: 'Kurta Set',
      brand: 'Yodha',
      price: 2500,
    });
    const model = buildProductSemanticModel(
      makeInput({
        currentProduct,
        countryCode: 'IN',
        inventory: [
          currentProduct,
          makeCandidate({
            slug: 'lehenga-set',
            name: 'Lehenga Set',
            brand: 'Yodha',
            price: 5000,
          }),
        ],
      })
    );

    expect(model.sameBrand?.cards[0]?.description).toMatch(/₹|INR/);
    expect(model.sameBrand?.cards[0]?.description).not.toContain('₦');
    expect(model.trustBullets.join(' ')).toMatch(/₹|INR/);
    expect(model.trustBullets.join(' ')).not.toContain('₦');
  });

  it('keeps explicitly product-linked guides ahead of broader cluster guides', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-17-pro-max',
      name: 'iPhone 17 Pro Max',
      brand: 'Apple',
      price: 495_000,
    });
    const model = buildProductSemanticModel(
      makeInput({
        currentProduct,
        inventory: [currentProduct],
        guidePosts: [
          ...publishedGuidePosts,
          {
            slug: 'iphone-17-pro-max-buying-guide',
            title: 'iPhone 17 Pro Max Buying Guide',
            excerpt: 'Exact buying context for iPhone 17 Pro Max.',
            category: 'Smartphones',
            tags: ['smartphones', 'apple'],
            keywords: ['iphone 17 pro max'],
            featured_image_url: null,
            published_at: '2026-04-01T09:00:00.000Z',
            reading_time_minutes: 4,
          },
        ],
        priorityGuidePostSlugs: ['iphone-17-pro-max-buying-guide'],
      })
    );

    expect(model.guideLinks[0]).toMatchObject({
      href: 'https://ogabassey.com/blog/iphone-17-pro-max-buying-guide',
      title: 'iPhone 17 Pro Max Buying Guide',
    });
  });

  it('renders explicitly product-linked guides even without cluster metadata', () => {
    const currentProduct = makeCandidate({
      slug: 'lenovo-legion',
      name: 'Lenovo Legion',
      brand: 'Lenovo',
      price: 3_500_000,
      category_slug: 'laptops',
    });
    const model = buildProductSemanticModel(
      makeInput({
        categorySlug: 'laptops',
        categoryName: 'Laptops',
        currentProduct,
        inventory: [currentProduct],
        guidePosts: [
          {
            slug: 'lenovo-legion-warranty-support',
            title: 'Warranty Support Checklist',
            excerpt: null,
            category: 'Support',
            tags: null,
            keywords: null,
            featured_image_url: null,
            published_at: '2026-04-01T09:00:00.000Z',
            reading_time_minutes: 3,
          },
          ...publishedGuidePosts,
        ],
        priorityGuidePostSlugs: ['lenovo-legion-warranty-support'],
      })
    );

    expect(model.guideLinks[0]).toEqual({
      href: 'https://ogabassey.com/blog/lenovo-legion-warranty-support',
      title: 'Warranty Support Checklist',
      description: '3 minute guide',
      kind: 'buyer-guide',
    });
  });

  it('falls back to Nigerian currency for semantic trust bullets', () => {
    const currentProduct = makeCandidate({
      slug: 'galaxy-a56',
      name: 'Galaxy A56',
      brand: 'Samsung',
      price: 410_000,
    });
    const model = buildProductSemanticModel(
      makeInput({
        currentProduct,
        inventory: [
          currentProduct,
          makeCandidate({
            slug: 'galaxy-a36',
            name: 'Galaxy A36',
            brand: 'Samsung',
            price: 360_000,
          }),
        ],
      })
    );

    expect(model.trustBullets.join(' ')).toContain('₦');
    expect(model.trustBullets.join(' ')).not.toMatch(/₹|INR/);
  });

  it('ranks alternatives by condition bucket, stock, price distance, spec overlap, then slug', () => {
    const currentProduct = makeCandidate({
      slug: 'samsung-galaxy-s25',
      name: 'Samsung Galaxy S25',
      brand: 'Samsung',
      price: 900_000,
      product_key_specs: {
        chipset: 'Snapdragon 8 Elite',
        ram_gb: 12,
        storage_gb: 256,
        screen_size_inches: 6.7,
      },
    });
    const model = buildProductSemanticModel(
      makeInput({
        currentProduct,
        inventory: [
          currentProduct,
          makeCandidate({
            slug: 'pixel-10',
            name: 'Pixel 10',
            brand: 'Google',
            price: 905_000,
            stock: 9,
            product_key_specs: {
              chipset: 'Tensor X',
              ram_gb: 12,
              storage_gb: 256,
              screen_size_inches: 6.7,
            },
          }),
          makeCandidate({
            slug: 'iphone-17-air',
            name: 'iPhone 17 Air',
            brand: 'Apple',
            price: 898_000,
            stock: 0,
            product_key_specs: {
              chipset: 'A19',
              ram_gb: 8,
              storage_gb: 128,
              screen_size_inches: 6.1,
            },
          }),
          makeCandidate({
            slug: 'used-xperia-1-vii',
            name: 'Used Xperia 1 VII',
            brand: 'Sony',
            condition: 'used',
            price: 901_000,
            stock: 9,
            product_key_specs: {
              chipset: 'Snapdragon 8 Elite',
              ram_gb: 12,
              storage_gb: 512,
              screen_size_inches: 6.7,
            },
          }),
        ],
      })
    );

    expect(model.alternatives?.cards.map((card) => card.title)).toEqual([
      'Pixel 10',
      'iPhone 17 Air',
      'Used Xperia 1 VII',
    ]);
  });

  it('returns null card sections when inventory is missing and when the current product has no brand', () => {
    const missingInventoryModel = buildProductSemanticModel(
      makeInput({
        currentProduct: makeCandidate({
          slug: 'mystery-phone',
          name: 'Mystery Phone',
          price: 250_000,
        }),
        inventory: [],
      })
    );

    expect(missingInventoryModel.supportLinks).toEqual([
      {
        href: 'https://ogabassey.com/smartphones',
        label: 'Shop more Smartphones',
      },
    ]);
    expect(missingInventoryModel.guideLinks).toEqual([]);
    expect(missingInventoryModel.alternatives).toBeNull();
    expect(missingInventoryModel.sameBrand).toBeNull();
    expect(missingInventoryModel.samePrice).toBeNull();

    const noBrandModel = buildProductSemanticModel(
      makeInput({
        currentProduct: makeCandidate({
          slug: 'house-brand-phone',
          name: 'House Brand Phone',
          price: 310_000,
          product_key_specs: { chipset: 'Custom', ram_gb: 6, storage_gb: 128 },
        }),
        inventory: [
          makeCandidate({
            slug: 'house-brand-phone',
            name: 'House Brand Phone',
            price: 310_000,
            product_key_specs: {
              chipset: 'Custom',
              ram_gb: 6,
              storage_gb: 128,
            },
          }),
          makeCandidate({
            slug: 'tecno-spark-40',
            name: 'Tecno Spark 40',
            brand: 'Tecno',
            price: 300_000,
            stock: 8,
            product_key_specs: {
              chipset: 'MediaTek',
              ram_gb: 8,
              storage_gb: 128,
            },
          }),
        ],
      })
    );

    expect(noBrandModel.sameBrand).toBeNull();
    expect(noBrandModel.guideLinks).toEqual([]);
  });

  it('keeps the viewed product independent of a saturated enrichment inventory cap', () => {
    // The PDP enrichment RPC caps its OTHER-product inventory
    // (PDP_SEMANTIC_INVENTORY_LIMIT = 48). The viewed product is sourced from
    // the bounded PDP core snapshot, never from that capped inventory, so a full
    // inventory that does NOT contain the current product must never drop it:
    // its own support surface stays, and it is excluded from its own
    // alternative/same-brand/same-price cards (it is the anchor, not a
    // candidate). The cap therefore only bounds the OTHER candidates and can
    // never crowd the viewed product out of its own PDP.
    const SATURATED_ENRICHMENT_INVENTORY = 48;
    const currentProduct = makeCandidate({
      slug: 'anchor-flagship',
      name: 'Anchor Flagship',
      brand: 'Apple',
      price: 500_000,
      product_key_specs: { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 },
    });
    const inventory = Array.from(
      { length: SATURATED_ENRICHMENT_INVENTORY },
      (_, index) =>
        makeCandidate({
          slug: `enrichment-candidate-${index}`,
          name: `Enrichment Candidate ${index}`,
          brand: index % 2 === 0 ? 'Apple' : 'Samsung',
          price: 480_000 + index * 1_000,
          product_key_specs: {
            chipset: `Chip ${index}`,
            ram_gb: 8,
            storage_gb: 128,
          },
        })
    );

    const model = buildProductSemanticModel(
      makeInput({ currentProduct, inventory })
    );

    // The viewed product's own presentation survives regardless of inventory
    // size — the category hub link is derived from the current product.
    expect(model.supportLinks).toEqual(
      expect.arrayContaining([
        {
          href: 'https://ogabassey.com/smartphones',
          label: 'Shop more Smartphones',
        },
      ])
    );

    // The viewed product is the anchor: it never appears as a candidate card,
    // and the capped inventory only bounds the OTHER candidates (<= MAX cards).
    const allCards = [
      ...(model.alternatives?.cards ?? []),
      ...(model.sameBrand?.cards ?? []),
      ...(model.samePrice?.cards ?? []),
    ];
    expect(
      allCards.some((card) => card.href.endsWith('/anchor-flagship'))
    ).toBe(false);
    expect(model.alternatives?.cards.length ?? 0).toBeLessThanOrEqual(
      MAX_SEMANTIC_SECTION_CARDS
    );
    expect(model.sameBrand?.cards.length ?? 0).toBeLessThanOrEqual(
      MAX_SEMANTIC_SECTION_CARDS
    );
  });
});
