import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';
import { POST_FILTER_RESULT_PAGE_SIZE } from './search-products-ranking';

export function createRankedSearchSupabase(
  category?: string,
  nameForId?: (id: string) => string,
  descriptionForId?: (id: string) => string
) {
  const inMock = vi.fn(async (_column: string, productIds: string[]) => ({
    data: productIds.map((id) => ({
      brand: 'Samsung',
      category,
      description: descriptionForId?.(id),
      id,
      name: nameForId?.(id) ?? `Product ${id}`,
    })),
    error: null,
  }));
  const query = {
    eq: vi.fn(() => query),
    in: inMock,
  };
  const select = vi.fn(() => query);
  const rpc = vi.fn(
    async (_functionName: string, args: { result_limit?: number; result_offset?: number }) => {
      const offset = args.result_offset ?? 0;
      const rows = Array.from(
        { length: args.result_limit ?? POST_FILTER_RESULT_PAGE_SIZE },
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
