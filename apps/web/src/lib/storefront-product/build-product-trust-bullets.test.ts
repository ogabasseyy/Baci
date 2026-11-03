import { describe, expect, it } from 'vitest';
import { buildProductTrustBullets } from './build-product-trust-bullets';
import type { BuildProductSemanticModelInput } from './product-semantic-types';

function makeInput(
  overrides: Partial<BuildProductSemanticModelInput> = {}
): BuildProductSemanticModelInput {
  return {
    storeUrl: 'https://ogabassey.com',
    merchantBusinessName: 'Ogabassey',
    categorySlug: 'smartphones',
    categoryName: 'Smartphones',
    currentProduct: {
      slug: 'iphone-16e',
      name: 'iPhone 16e',
      price: 450_000,
      brand: 'Apple',
      condition: 'open_box',
      stock: 4,
      category_slug: 'smartphones',
      product_key_specs: {},
    },
    inventory: [],
    ...overrides,
  };
}

describe('buildProductTrustBullets', () => {
  it('builds bounded condition and curated price-band facts', () => {
    expect(buildProductTrustBullets(makeInput())).toEqual([
      'Available in Open Box condition',
      'Listed in Best Smartphones Under ₦500,000',
    ]);
  });

  it('omits unsupported price-band copy when the category has no curated band', () => {
    expect(
      buildProductTrustBullets(
        makeInput({
          categorySlug: 'cameras',
          categoryName: 'Cameras',
        })
      )
    ).toEqual(['Available in Open Box condition']);
  });
});
