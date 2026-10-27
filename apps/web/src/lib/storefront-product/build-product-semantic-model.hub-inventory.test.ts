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
  });
});
