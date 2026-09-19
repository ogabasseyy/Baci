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
    const { supabase, rpc } = createVariantsSupabase([
      {
        data: [
          { id: 'v1', product_id: 'p1', attributes: null },
          { id: 'v2', product_id: 'p2', attributes: null },
        ],
      },
    ]);

    const rows = await fetchFeedVariants(supabase, 'm1', ['p1', 'p2']);

    expect(rows.map((r) => r.id)).toEqual(['v1', 'v2']);
    expect(rpc).toHaveBeenCalledWith('get_feed_product_variants', {
      p_merchant_id: 'm1',
      p_product_ids: ['p1', 'p2'],
    });
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
