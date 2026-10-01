import { describe, expect, it } from 'vitest';
import {
  getVariantBackedSelections,
  hasVariantBackedAxis,
} from './cart-helpers';
import type { NormalizedProductDetails } from './product-normalization';

function productFixture(
  overrides: Partial<NormalizedProductDetails>
): NormalizedProductDetails {
  return {
    platforms: [],
    storage: [],
    ...overrides,
  } as unknown as NormalizedProductDetails;
}

describe('cart helpers variant-backed axes', () => {
  it('treats top-level variant.condition as a variant-backed condition axis', () => {
    const product = productFixture({
      variants: [
        {
          attributes: { storage: '128GB' },
          condition: 'new',
          id: 'variant-new',
          stock_quantity: 2,
        },
        {
          attributes: { storage: '256GB' },
          condition: 'used',
          id: 'variant-used',
          stock_quantity: 2,
        },
      ],
    });

    expect(hasVariantBackedAxis('condition', product.variants)).toBe(true);
    expect(
      getVariantBackedSelections(
        { condition: 'new', storage: '128GB' },
        product.variants
      )
    ).toEqual({ condition: 'new', storage: '128GB' });
  });

  it('omits display-only metadata from variant-backed availability constraints', () => {
    const product = productFixture({
      variants: [
        {
          attributes: {
            availability_note: 'Confirm price before checkout',
            storage: '128GB',
          },
          id: 'variant-128',
          stock_quantity: 2,
        },
        {
          attributes: {
            availability_note: 'Call to confirm stock',
            storage: '256GB',
          },
          id: 'variant-256',
          stock_quantity: 2,
        },
      ],
    });

    const selections = getVariantBackedSelections(
      {
        availability_note: 'Confirm price before checkout',
        storage: '128GB',
      },
      product.variants
    );

    expect(selections).toEqual({ storage: '128GB' });
  });

  it('canonicalizes display-only axis keys before filtering availability constraints', () => {
    const product = productFixture({
      variants: [
        {
          attributes: {
            'Availability Note': 'Confirm price before checkout',
            storage: '128GB',
          },
          id: 'variant-128',
          stock_quantity: 2,
        },
        {
          attributes: {
            'availability-note': 'Call to confirm stock',
            storage: '256GB',
          },
          id: 'variant-256',
          stock_quantity: 2,
        },
      ],
    });

    const selections = getVariantBackedSelections(
      {
        'Availability Note': 'Confirm price before checkout',
        storage: '128GB',
      },
      product.variants
    );

    expect(selections).toEqual({ storage: '128GB' });
  });
});
