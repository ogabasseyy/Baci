import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_POST_FILTER_RESULT_PAGES,
  POST_FILTER_RESULT_PAGE_SIZE,
} from './search-products-ranking';
import { loadMcpSearchProducts } from './search-products-query';

function createRankedSearchSupabase(category?: string) {
  const inMock = vi.fn(async (_column: string, productIds: string[]) => ({
    data: productIds.map((id) => ({
      brand: 'Samsung',
      category,
      id,
      name: `Product ${id}`,
    })),
    error: null,
  }));
  const query = {
    eq: vi.fn(() => query),
    in: inMock,
  };
  const select = vi.fn(() => query);
  const rpc = vi.fn(
    async (_functionName: string, args: { result_offset?: number }) => {
      const offset = args.result_offset ?? 0;
      const rows = Array.from(
        { length: POST_FILTER_RESULT_PAGE_SIZE },
        (_, index) => ({
          product_id: `ranked-${offset + index}`,
          total_count: 10_000,
        })
      );

      return { data: rows, error: null };
    }
  );

  return {
    rpc,
    select,
    supabase: {
      from: vi.fn(() => ({ select })),
      rpc,
    } as unknown as SupabaseClient,
  };
}

function createCatalogSearchSupabase() {
  const rows = Array.from({ length: POST_FILTER_RESULT_PAGE_SIZE }, (_, index) => ({
    condition: 'new',
    has_condition_offers: false,
    id: `catalog-${index}`,
    name: `Catalog ${index}`,
  }));
  const range = vi.fn(async () => ({ data: rows, error: null }));
  const query = {
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    ilike: vi.fn(() => query),
    lte: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    range,
  };
  const select = vi.fn(() => query);

  return {
    range,
    select,
    supabase: {
      from: vi.fn(() => ({ select })),
    } as unknown as SupabaseClient,
  };
}

describe('loadMcpSearchProducts', () => {
  it('keeps tablet matches out of an explicit phone search', async () => {
    const { supabase } = createRankedSearchSupabase('Tablets');
    const result = await loadMcpSearchProducts({
      args: { query: 'Redmi phones', limit: 2 },
      merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      supabase,
    });

    expect(result.products).toEqual([]);
  });

  it('caps ranked post-filter pagination when hydrated rows keep failing filters', async () => {
    const { rpc, select, supabase } = createRankedSearchSupabase();

    const result = await loadMcpSearchProducts({
      args: { brand: 'Apple', limit: 20, query: 'phone' },
      merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      supabase,
    });

    expect(result.products).toEqual([]);
    expect(select).toHaveBeenCalledWith(expect.stringContaining('manage_stock'));
    expect(rpc).toHaveBeenCalledTimes(MAX_POST_FILTER_RESULT_PAGES);
    expect(rpc.mock.calls.map(([, args]) => args.result_offset)).toEqual(
      Array.from(
        { length: MAX_POST_FILTER_RESULT_PAGES },
        (_, index) => index * POST_FILTER_RESULT_PAGE_SIZE
      )
    );
  });

  it('caps catalog condition-family pagination when pages keep failing hydration filters', async () => {
    const { range, select, supabase } = createCatalogSearchSupabase();

    const result = await loadMcpSearchProducts({
      args: { condition: 'used', limit: 20 },
      merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      supabase,
    });

    expect(result.products).toEqual([]);
    expect(select).toHaveBeenCalledWith(expect.stringContaining('manage_stock'));
    expect(range).toHaveBeenCalledTimes(MAX_POST_FILTER_RESULT_PAGES);
    expect(range.mock.calls).toEqual(
      Array.from({ length: MAX_POST_FILTER_RESULT_PAGES }, (_, index) => {
        const offset = index * POST_FILTER_RESULT_PAGE_SIZE;
        return [offset, offset + POST_FILTER_RESULT_PAGE_SIZE - 1];
      })
    );
  });
});
