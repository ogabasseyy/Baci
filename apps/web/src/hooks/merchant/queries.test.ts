import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { fetchMerchantBySlug } from './queries';

function createMockSupabase(results: Array<{ data: unknown; error: unknown }>) {
  const selects: string[] = [];
  const maybeSingle = vi.fn(
    async () => results.shift() ?? { data: null, error: null }
  );
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn((columns: string) => {
    selects.push(columns);
    return { eq };
  });
  const from = vi.fn(() => ({ select }));

  return {
    supabase: { from } as unknown as SupabaseClient,
    selects,
    maybeSingle,
  };
}

describe('fetchMerchantBySlug', () => {
  it('returns normalized merchant data on success', async () => {
    const { supabase, selects } = createMockSupabase([
      {
        data: {
          id: 'm-1',
          slug: 'ogabassey',
          feature_settings: [{ oxygen_enabled: true }],
        },
        error: null,
      },
    ]);

    const result = await fetchMerchantBySlug(supabase, 'ogabassey');

    expect(selects[0]).toContain('oxygen_enabled');
    expect(result).toMatchObject({
      id: 'm-1',
      slug: 'ogabassey',
      feature_settings: { oxygen_enabled: true },
    });
  });

  it('falls back to select without oxygen_enabled when column is missing pre-migration', async () => {
    const { supabase, selects } = createMockSupabase([
      {
        data: null,
        error: {
          code: '42703',
          message:
            'column merchant_feature_settings_1.oxygen_enabled does not exist',
        },
      },
      {
        data: {
          id: 'm-1',
          slug: 'ogabassey',
          feature_settings: { paystack_enabled: true },
        },
        error: null,
      },
    ]);

    const result = await fetchMerchantBySlug(supabase, 'ogabassey');

    expect(selects).toHaveLength(2);
    expect(selects[0]).toContain('oxygen_enabled');
    expect(selects[1]).not.toContain('oxygen_enabled');
    expect(result).toMatchObject({
      id: 'm-1',
      feature_settings: { paystack_enabled: true },
    });
  });

  it('rethrows unrelated query errors', async () => {
    const { supabase, selects } = createMockSupabase([
      {
        data: null,
        error: {
          code: '500',
          message: 'connection failed',
        },
      },
    ]);

    await expect(fetchMerchantBySlug(supabase, 'ogabassey')).rejects.toEqual({
      code: '500',
      message: 'connection failed',
    });
    expect(selects).toHaveLength(1);
  });
});
