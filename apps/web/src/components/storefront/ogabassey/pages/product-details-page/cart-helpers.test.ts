import { describe, expect, it, vi } from 'vitest';
import {
  applySingleOptionAxisSelectionsToVariants,
  buildCartProduct,
  getAxisOptions,
  getVariantBackedSelections,
  hasVariantBackedAxis,
} from './cart-helpers';
import type { NormalizedProductDetails } from './product-normalization';

vi.mock('./related-product', () => ({
  toRelatedProductsProduct: () => ({
    id: 'prod-1',
    name: 'iPhone 15',
    price: 650000,
  }),
}));

function productFixture(
  overrides: Partial<NormalizedProductDetails>
): NormalizedProductDetails {
  return {
    platforms: [],
    storage: [],
    ...overrides,
  } as unknown as NormalizedProductDetails;
}

function makeProductData(
  overrides: Partial<NormalizedProductDetails> = {}
): NormalizedProductDetails {
  return {
    images: [
      'https://cdn.example.com/iphone-15-open-box.avif',
      'https://cdn.example.com/iphone-15-yellow.avif',
    ],
    colorImages: {
      Black: ['https://cdn.example.com/iphone-15-black.avif'],
      Yellow: ['https://cdn.example.com/iphone-15-yellow.avif'],
    },
    description: 'A phone',
    rating: 4.8,
    category: 'Phones',
    categories: { name: 'Phones' },
    ...overrides,
  } as unknown as NormalizedProductDetails;
}

describe('cart helpers', () => {
  it('reads variant-backed options from legacy-cased attribute keys', () => {
    const product = productFixture({
      variants: [
        {
          attributes: { Storage: '128GB' },
          id: 'variant-128',
          stock_quantity: 2,
        },
        {
          attributes: { Storage: '256GB' },
          id: 'variant-256',
          stock_quantity: 2,
        },
      ],
    });

    expect(getAxisOptions('storage', product)).toEqual(['128GB', '256GB']);
  });

  it('falls back to one metadata option when variant rows lack the axis', () => {
    const product = productFixture({
      storage: ['128GB'],
      variants: [
        {
          attributes: {},
          id: 'variant-128',
          stock_quantity: 2,
        },
      ],
    });

    expect(getAxisOptions('storage', product)).toEqual(['128GB']);
  });

  it('falls back to one generic metadata option when variant rows lack the axis', () => {
    const product = productFixture({
      variant_attributes: { ram: ['8GB'] },
      variants: [
        {
          attributes: {},
          id: 'variant-8gb',
          stock_quantity: 2,
        },
      ],
    });

    expect(getAxisOptions('ram', product)).toEqual(['8GB']);
  });

  it('detects whether an axis is backed by variant rows', () => {
    const product = productFixture({
      variants: [
        {
          attributes: { Storage: '128GB' },
          id: 'variant-128',
          stock_quantity: 2,
        },
      ],
    });

    expect(hasVariantBackedAxis('storage', product.variants)).toBe(true);
    expect(hasVariantBackedAxis('platform', product.variants)).toBe(false);
  });

  it('keeps only selected axes backed by variant rows', () => {
    const product = productFixture({
      variants: [
        {
          attributes: { storage: '128GB' },
          id: 'variant-128',
          stock_quantity: 2,
        },
      ],
    });

    expect(
      getVariantBackedSelections(
        { platform: 'PS5', storage: '128GB' },
        product.variants
      )
    ).toEqual({ storage: '128GB' });
  });

  it('does not expose multi-option metadata fallbacks without variant-backed values', () => {
    const product = productFixture({
      storage: ['128GB', '256GB'],
      variants: [
        {
          attributes: {},
          id: 'variant-empty',
          stock_quantity: 2,
        },
      ],
    });

    expect(getAxisOptions('storage', product)).toEqual([]);
  });

  it('normalizes missing single-option axes into variant rows for resolution', () => {
    expect(
      applySingleOptionAxisSelectionsToVariants(
        [
          {
            attributes: {},
            id: 'variant-empty',
            stock_quantity: 2,
          },
          {
            attributes: { storage: '256GB' },
            id: 'variant-explicit',
            stock_quantity: 2,
          },
        ],
        { storage: '128GB' }
      )
    ).toEqual([
      {
        attributes: { storage: '128GB' },
        id: 'variant-empty',
        stock_quantity: 2,
      },
      {
        attributes: { storage: '256GB' },
        id: 'variant-explicit',
        stock_quantity: 2,
      },
    ]);
  });
});

const offer = { rawPrice: 600000 } as Parameters<typeof buildCartProduct>[1];

describe('buildCartProduct catalog basis', () => {
  it('retains the catalog price for a non-variant condition offer', () => {
    const product = buildCartProduct(
      makeProductData({ condition: 'new' }),
      offer,
      0,
      'used',
      {}
    );

    expect(product.price).toBe(600000);
    expect(product.catalogPrice).toBe(650000);
  });

  it('omits the catalog price when the condition matches the base', () => {
    const product = buildCartProduct(
      makeProductData({ condition: 'new' }),
      { rawPrice: 650000 } as Parameters<typeof buildCartProduct>[1],
      0,
      'new',
      {}
    );

    expect(product.catalogPrice).toBeUndefined();
  });

  it('omits the catalog price when variant pricing applies', () => {
    const product = buildCartProduct(
      makeProductData({ condition: 'new' }),
      offer,
      0,
      'used',
      {},
      undefined,
      { hasVariantPricing: true }
    );

    expect(product.price).toBe(600000);
    expect(product.catalogPrice).toBeUndefined();
  });
});

describe('buildCartProduct image resolution', () => {
  it("uses the selected color's image even when the gallery frame is the default", () => {
    const product = buildCartProduct(
      makeProductData(),
      offer,
      0, // gallery still on the open-box default frame
      'new',
      {},
      'Black'
    );

    expect(product.image).toBe('https://cdn.example.com/iphone-15-black.avif');
    expect(product.imageLarge).toBe(
      'https://cdn.example.com/iphone-15-black.avif'
    );
  });

  it('falls back to the displayed gallery frame when the color has no image', () => {
    const product = buildCartProduct(
      makeProductData({ colorImages: {} }),
      offer,
      1,
      'new',
      {},
      'Black'
    );

    expect(product.image).toBe('https://cdn.example.com/iphone-15-yellow.avif');
  });

  it('falls back to the displayed frame for single-image products with no color', () => {
    const product = buildCartProduct(
      makeProductData({ colorImages: {} }),
      offer,
      0,
      'new',
      {}
    );

    expect(product.image).toBe(
      'https://cdn.example.com/iphone-15-open-box.avif'
    );
  });
});
