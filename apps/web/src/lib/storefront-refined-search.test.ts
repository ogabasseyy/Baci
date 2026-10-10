import { getRefinedSearchArgs, readRefinedSearchRows } from '@baci/shared/lib';
import { describe, expect, it } from 'vitest';

describe('refined search adapter contract', () => {
  it('sends brand OR filtering and zero price bounds to the new contract', () => {
    expect(
      getRefinedSearchArgs(
        'merchant',
        'phone',
        { brands: ['Samsung', 'Apple'], sort: 'price_desc', maxPrice: 0 },
        20,
        40
      )
    ).toEqual({
      search_query: 'phone',
      merchant_id_param: 'merchant',
      brands_filter: ['Apple', 'Samsung'],
      category_id_filter: null,
      condition_filter: null,
      min_price_filter: null,
      max_price_filter: 0,
      min_rating_filter: null,
      sort_by: 'price_desc',
      result_limit: 20,
      result_offset: 40,
    });
  });
  it('projects matching price and IDs without trusting malformed provider rows', () => {
    const rows = readRefinedSearchRows([
      {
        product_id: 'p1',
        total_count: '2',
        effective_price: '200000',
        matched_variant_id: 'v1',
        matched_offer_id: null,
        matched_condition: 'used',
      },
    ]);
    expect(rows).toEqual([
      {
        productId: 'p1',
        total: 2,
        price: 200000,
        variantId: 'v1',
        condition: 'used',
      },
    ]);
    expect(() =>
      readRefinedSearchRows([
        { product_id: 'p1', total_count: -1, effective_price: 'NaN' },
      ])
    ).toThrow();
  });
});
