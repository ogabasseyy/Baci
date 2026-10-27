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
});
