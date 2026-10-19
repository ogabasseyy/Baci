import { describe, expect, it } from 'vitest';
import { readRefinedSearchRows } from './refined-search-rows';

describe('refined-search-rows', () => {
  it('reads rows with prices and matched ids', () => {
    expect(
      readRefinedSearchRows([
        {
          product_id: 'p1',
          total_count: '21',
          effective_price: '150.5',
          matched_variant_id: 'v1',
          matched_offer_id: 'o1',
          matched_condition: 'used',
        },
        { product_id: 'p2', total_count: 21, effective_price: null },
      ])
    ).toEqual([
      {
        productId: 'p1',
        total: 21,
        price: 150.5,
        variantId: 'v1',
        offerId: 'o1',
        condition: 'used',
      },
      { productId: 'p2', total: 21 },
    ]);
  });

  it.each([
    ['non-array payload', 'nope'],
    ['non-object row', [null]],
    ['missing product id', [{ total_count: 1 }]],
    ['non-integer total', [{ product_id: 'p1', total_count: 1.5 }]],
    ['negative total', [{ product_id: 'p1', total_count: -1 }]],
    [
      'negative price',
      [{ product_id: 'p1', total_count: 1, effective_price: -5 }],
    ],
    [
      'non-numeric price',
      [{ product_id: 'p1', total_count: 1, effective_price: 'much' }],
    ],
  ])('rejects %s with the unavailable error', (_label, value) => {
    expect(() => readRefinedSearchRows(value)).toThrow(
      'Search results unavailable'
    );
  });
});
