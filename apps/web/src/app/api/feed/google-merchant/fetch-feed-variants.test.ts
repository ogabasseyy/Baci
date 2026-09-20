import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { fetchFeedVariants } from './fetch-feed-variants';

function createVariantsSupabase(
  responses: Array<{ data?: unknown[] | null; error?: unknown }>
) {
  const rpc = vi.fn();
  for (const response of responses) {
    rpc.mockResolvedValueOnce({
      data: response.data ?? null,
      error: response.error ?? null,
    });
  }
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

describe('fetchFeedVariants', () => {
  it('aggregates variant rows across product batches', async () => {
    const productIds = Array.from({ length: 51 }, (_, index) => `p${index}`);
    const firstBatch = productIds.slice(0, 50).map((product_id) => ({
      id: `v-${product_id}`,
      product_id,
      attributes: null,
    }));
    const secondBatch = [{ id: 'v-p50', product_id: 'p50', attributes: null }];
    const { supabase, rpc } = createVariantsSupabase([
      { data: firstBatch },
      { data: secondBatch },
    ]);

    const rows = await fetchFeedVariants(supabase, 'm1', productIds);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, 'get_feed_product_variants', {
      p_merchant_id: 'm1',
      p_product_ids: productIds.slice(0, 50),
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_feed_product_variants', {
      p_merchant_id: 'm1',
      p_product_ids: ['p50'],
    });
    expect(rows.map((r) => r.id)).toEqual([
      ...firstBatch.map((r) => r.id),
      'v-p50',
    ]);
  });

  it('returns an empty list without calling the RPC for no products', async () => {
    const { supabase, rpc } = createVariantsSupabase([]);

    await expect(fetchFeedVariants(supabase, 'm1', [])).resolves.toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('throws when the variants RPC fails', async () => {
    const { supabase } = createVariantsSupabase([
      { error: { message: 'db down' } },
    ]);

    await expect(fetchFeedVariants(supabase, 'm1', ['p1'])).rejects.toThrow(
      'Failed to fetch product variants'
    );
  });
});
