import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadRankedMcpProducts } from './search-products-ranked';
import { POST_FILTER_RESULT_PAGE_SIZE } from './search-products-ranking';

function rankedClient(total: number, nameForRank: (rank: number) => string) {
  const rpc = vi.fn(async (_name: string, args: { result_offset: number; result_limit: number }) => ({
    data: Array.from({ length: Math.max(0, Math.min(args.result_limit, total - args.result_offset)) }, (_, index) => ({
      product_id: `ranked-${args.result_offset + index}`,
      total_count: total,
    })),
    error: null,
  }));
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(async (_column: string, ids: string[]) => ({
      data: ids.map((id) => ({
        id, name: nameForRank(Number(id.slice('ranked-'.length))),
        brand: 'Samsung', category: 'Accessories',
      })),
      error: null,
    })),
  };
  return {
    rpc,
    supabase: { rpc, from: vi.fn(() => ({ select: vi.fn(() => query) })) } as unknown as SupabaseClient,
  };
}

function searchInput(supabase: SupabaseClient, query: string, filters = false) {
  return {
    args: { query, limit: 1 },
    hasPostHydrationFilters: filters,
    limit: 1,
    priceSensitive: false,
    merchantId: 'merchant-1',
    sanitizedBrand: undefined,
    sanitizedCategory: undefined,
    sanitizedCondition: undefined,
    sanitizedQuery: query,
    supabase,
  };
}

describe('ranked product loading', () => {
  it('returns the first ranked product without scanning extra pages', async () => {
    const { rpc, supabase } = rankedClient(2, (rank) => `Product ${rank}`);
    const result = await loadRankedMcpProducts(searchInput(supabase, 'gadget'));
    expect(result.products.map((product) => product.id)).toEqual(['ranked-0']);
    expect(result.sawRankedRows).toBe(true);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it('scans whole pages past substring matches to a whole-word result', async () => {
    const { rpc, supabase } = rankedClient(151, (rank) =>
      rank === 150 ? 'Work Laptop' : 'DreamWorks Toy'
    );
    const result = await loadRankedMcpProducts(searchInput(supabase, 'work', true));
    expect(result.products.map((product) => product.id)).toEqual(['ranked-150']);
    expect(rpc.mock.calls.map(([, args]) => args.result_offset)).toEqual([0, POST_FILTER_RESULT_PAGE_SIZE]);
    expect(rpc.mock.calls[0]?.[1].result_limit).toBe(POST_FILTER_RESULT_PAGE_SIZE);
  });

  it('rejects a ranked RPC error before querying products', async () => {
    const error = new Error('ranking unavailable');
    const rpc = vi.fn(async () => ({ data: null, error }));
    const from = vi.fn();
    await expect(loadRankedMcpProducts(searchInput(
      { rpc, from } as unknown as SupabaseClient, 'phone'
    ))).rejects.toBe(error);
    expect(from).not.toHaveBeenCalled();
  });
});
