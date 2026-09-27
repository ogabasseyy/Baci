import { describe, expect, it } from 'vitest';
import {
  buildSearchProductsV2RpcArgs,
  POST_FILTER_RESULT_PAGE_SIZE,
  orderRowsByRankedProductIds,
} from './search-products-ranking';
import { toRankedSearchProductRows } from './search-products-query-helpers';

describe('MCP search_products ranking helpers', () => {
  it('builds search_products_v2 arguments for ranked MCP catalog search', () => {
    expect(
      buildSearchProductsV2RpcArgs({
        args: {
          brand: 'Apple',
          condition: 'used',
          max_price: 500_000,
          min_price: 100_000,
          sort: 'price_asc',
        },
        limit: 20,
        merchantId: '123e4567-e89b-12d3-a456-426614174000',
        sanitizedQuery: 'iphnoe',
      })
    ).toEqual({
      brand_filter: null,
      category_id_filter: null,
      condition_filter: null,
      max_price_filter: 500_000,
      merchant_id_param: '123e4567-e89b-12d3-a456-426614174000',
      min_price_filter: 100_000,
      min_rating_filter: null,
      parent_only: false,
      result_limit: 100,
      result_offset: 0,
      search_query: 'iphnoe',
      sort_by: 'price_asc',
      status_filter: 'active',
      stock_filter: null,
    });
  });

  it('leaves condition aliases for post-hydration family filtering', () => {
    expect(
      buildSearchProductsV2RpcArgs({
        args: {
          condition: 'refurbished',
        },
        limit: 10,
        merchantId: '123e4567-e89b-12d3-a456-426614174000',
        sanitizedQuery: 'iphone',
      })
    ).toMatchObject({
      condition_filter: null,
      result_limit: 100,
    });
  });

  it('builds default rpc arguments when optional filters are absent', () => {
    expect(
      buildSearchProductsV2RpcArgs({
        args: {},
        limit: 10,
        merchantId: '123e4567-e89b-12d3-a456-426614174000',
        sanitizedQuery: 'iphone',
      })
    ).toMatchObject({
      brand_filter: null,
      category_id_filter: null,
      condition_filter: null,
      max_price_filter: null,
      min_price_filter: null,
      result_limit: 10,
      sort_by: 'relevance',
    });
  });

  it('uses the post-filter result buffer when only category is present', () => {
    expect(
      buildSearchProductsV2RpcArgs({
        args: {
          category: 'phones',
        },
        limit: 20,
        merchantId: '123e4567-e89b-12d3-a456-426614174000',
        sanitizedQuery: 'iphone',
      })
    ).toMatchObject({
      result_limit: 100,
    });
  });

  it('uses the bounded post-filter buffer for price-sensitive option searches', () => {
    expect(
      buildSearchProductsV2RpcArgs({
        args: { sort: 'relevance' },
        forcePostFilterBuffer: true,
        limit: 10,
        merchantId: '123e4567-e89b-12d3-a456-426614174000',
        sanitizedQuery: 'iphone',
      })
    ).toMatchObject({ result_limit: POST_FILTER_RESULT_PAGE_SIZE });
  });

  it('uses the post-filter result buffer when brand and category are present', () => {
    expect(
      buildSearchProductsV2RpcArgs({
        args: {
          brand: 'Apple',
          category: 'phones',
        },
        limit: 20,
        merchantId: '123e4567-e89b-12d3-a456-426614174000',
        sanitizedQuery: 'iphone',
      })
    ).toMatchObject({
      result_limit: 100,
    });
  });

  it('applies the ranked search page offset for post-filter paging', () => {
    expect(
      buildSearchProductsV2RpcArgs({
        args: {
          brand: 'Apple',
        },
        limit: 20,
        merchantId: '123e4567-e89b-12d3-a456-426614174000',
        offset: 100,
        sanitizedQuery: 'iphone',
      })
    ).toMatchObject({
      result_limit: 100,
      result_offset: 100,
    });
  });

  it('preserves ranked product order after product hydration', () => {
    expect(
      orderRowsByRankedProductIds(
        [
          { id: 'product-1', name: 'iPhone X' },
          { id: 'product-2', name: 'iPhone 16 Pro' },
        ],
        ['product-2', 'product-1']
    ).map((row) => row.id)
  ).toEqual(['product-2', 'product-1']);
  });

  it('preserves original order when no ranked ids are available', () => {
    const rows = [
      { id: 'product-1', name: 'iPhone X' },
      { id: 'product-2', name: 'iPhone 16 Pro' },
    ];

    expect(orderRowsByRankedProductIds(rows, [])).toEqual(rows);
  });

  it('moves unmatched ids after ranked rows', () => {
    expect(
      orderRowsByRankedProductIds(
        [
          { id: 'product-1', name: 'iPhone X' },
          { id: 'product-2', name: 'iPhone 16 Pro' },
          { id: 'product-3', name: 'iPhone Case' },
        ],
        ['product-2']
      ).map((row) => row.id)
    ).toEqual(['product-2', 'product-1', 'product-3']);
  });

  it('handles empty row arrays', () => {
    expect(orderRowsByRankedProductIds([], ['product-1'])).toEqual([]);
  });

  it('keeps only valid ranked RPC rows before hydration', () => {
    expect(
      toRankedSearchProductRows([
        { product_id: 'product-1', total_count: '2' },
        { product_id: 'product-2', total_count: 2 },
        { product_id: 123, total_count: 2 },
        { total_count: 2 },
        null,
      ])
    ).toEqual([
      { product_id: 'product-1', total_count: '2' },
      { product_id: 'product-2', total_count: 2 },
    ]);
  });
});
