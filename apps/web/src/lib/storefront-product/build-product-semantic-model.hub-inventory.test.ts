import { describe, expect, it } from 'vitest';
import { buildProductSemanticModel } from './build-product-semantic-model';
import {
  makeCandidate,
  makeInput,
} from './build-product-semantic-model.test-helpers';

describe('hubEligibilityInventory integration in buildProductSemanticModel', () => {
  it('forwards hubEligibilityInventory to model.supportLinks and defaults omitted inventory to empty', () => {
    const currentProduct = makeCandidate({
      slug: 'iphone-15-pro-max',
      name: 'iPhone 15 Pro Max',
      brand: 'Apple',
      price: 1_200_000,
    });
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
      price: 1_000_000,
      availability: 'InStock' as const,
      stock: i === 2 ? 0 : 5,
      category_slug: 'smartphones',
    }));

    const withoutHubInventory = buildProductSemanticModel(
      makeInput({
        currentProduct,
        inventory: [currentProduct],
      })
    );
    expect(
      withoutHubInventory.supportLinks.some((l) => l.href.includes('/brands/'))
    ).toBe(false);

    const withHubInventory = buildProductSemanticModel(
      makeInput({
        currentProduct,
        inventory: [currentProduct],
        hubEligibilityInventory,
      })
    );
    expect(withHubInventory.supportLinks).toEqual(
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
    expect(withoutHubInventory.sameBrand).toBeNull();
    expect(withHubInventory.sameBrand?.cards.map((card) => card.href)).toEqual([
      'https://ogabassey.com/smartphones/iphone-0',
      'https://ogabassey.com/smartphones/iphone-1',
      'https://ogabassey.com/smartphones/iphone-2',
      'https://ogabassey.com/smartphones/iphone-3',
      'https://ogabassey.com/smartphones/iphone-4',
    ]);
  });

  it('supplements sameBrand recommendations from hubEligibilityInventory when brand products fall outside the 48-row category preview', () => {
    const currentProduct = makeCandidate({
      slug: 'tecno-camon-30-premier',
      name: 'Tecno Camon 30 Premier',
      brand: 'Tecno',
      condition: 'new',
      price: 620_000,
      stock: 0,
      manage_stock: false,
    });
    const samsungPreviewProducts = Array.from({ length: 6 }, (_, index) =>
      makeCandidate({
        slug: `samsung-galaxy-a5${index}`,
        name: `Samsung Galaxy A5${index}`,
        brand: 'Samsung',
        condition: 'new',
        price: 550_000 + index * 15_000,
        stock: 0,
        manage_stock: false,
      })
    );
    const hubEligibilityInventory = [
      {
        slug: 'tecno-phantom-v-fold',
        name: 'Tecno Phantom V Fold',
        brand: 'Tecno',
        condition: 'new',
        price: 900_000,
        stock: 0,
        manage_stock: false,
        availability: 'InStock' as const,
        category_slug: 'smartphones',
      },
      {
        slug: 'tecno-camon-30-pro',
        name: 'Tecno Camon 30 Pro',
        brand: 'Tecno',
        condition: 'new',
        price: 580_000,
        stock: 0,
        manage_stock: false,
        availability: 'InStock' as const,
        category_slug: 'smartphones',
      },
      {
        slug: 'tecno-spark-20-pro',
        name: 'Tecno Spark 20 Pro',
        brand: 'Tecno',
        condition: 'new',
        price: 290_000,
        stock: 0,
        manage_stock: true,
        availability: 'OutOfStock' as const,
        category_slug: 'smartphones',
      },
    ];

    const model = buildProductSemanticModel(
      makeInput({
        currentProduct,
        inventory: [currentProduct, ...samsungPreviewProducts],
        hubEligibilityInventory,
      })
    );

    expect(model.sameBrand?.cards.map((card) => card.href)).toEqual([
      'https://ogabassey.com/smartphones/tecno-camon-30-pro',
      'https://ogabassey.com/smartphones/tecno-phantom-v-fold',
    ]);
  });
});
