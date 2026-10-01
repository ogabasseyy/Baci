import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hydrateSearchProductAvailability } from './search-product-availability';

describe('hydrateSearchProductAvailability PostgREST paging', () => {
  it('pages variant lookups so no response can hit the 1,000-row clamp', async () => {
    const products = Array.from({ length: 8 }, (_, index) => ({
      id: `paged-${index}`,
      price: 1000,
      manage_stock: false,
      has_variants: true,
    }));
    const rpc = vi.fn(async (name: string, args: { p_product_ids: string[] }) => {
      if (name !== 'get_mcp_search_product_variants') {
        return { data: [], error: null };
      }
      return {
        data: args.p_product_ids.map((product_id) => ({
          id: `v-${product_id}`,
          product_id,
          attributes: {},
          price_override: 900,
          stock_quantity: 1,
        })),
        error: null,
      };
    });
    const supabase = { rpc } as unknown as SupabaseClient;

    const hydrated = await hydrateSearchProductAvailability(
      products,
      supabase,
      'merchant-1'
    );

    const variantCalls = rpc.mock.calls.filter(
      ([name]) => name === 'get_mcp_search_product_variants'
    );
    expect(variantCalls).toHaveLength(2);
    expect(variantCalls[0][1].p_product_ids).toHaveLength(7);
    expect(variantCalls[1][1].p_product_ids).toHaveLength(1);
    expect(hydrated).toHaveLength(8);
    for (const row of hydrated) {
      expect(row.allVariants).toHaveLength(1);
      expect(row.variantLookupFailed).toBe(false);
    }
  });
});
