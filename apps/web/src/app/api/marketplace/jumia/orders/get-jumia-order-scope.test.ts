import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { getJumiaOrderScope } from './get-jumia-order-scope';

function createSupabase(response: unknown) {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(response),
    select: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return {
    from: vi.fn(() => query),
  } as unknown as SupabaseClient;
}

describe('getJumiaOrderScope', () => {
  it('returns the provider and marketplace identity for an integration', async () => {
    const supabase = createSupabase({
      data: { marketplace_key: 'NG-main', shop_id: 'shop-1' },
      error: null,
    });

    await expect(
      getJumiaOrderScope(supabase, 'merchant-1', 'integration-1')
    ).resolves.toEqual({
      kind: 'ok',
      cachedMarketplaceKeys: ['NG-main', 'default'],
      marketplaceKey: 'NG-main',
      shopId: 'shop-1',
    });
    const query = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0]
      .value as { eq: ReturnType<typeof vi.fn> };
    expect(query.eq).toHaveBeenCalledWith('platform', 'jumia');
  });

  it('uses the legacy marketplace key when the integration key is empty', async () => {
    const supabase = createSupabase({
      data: { marketplace_key: '  ', shop_id: 'shop-1' },
      error: null,
    });

    await expect(
      getJumiaOrderScope(supabase, 'merchant-1', 'integration-1')
    ).resolves.toEqual({
      kind: 'ok',
      cachedMarketplaceKeys: ['default'],
      marketplaceKey: 'default',
      shopId: 'shop-1',
    });
  });

  it('includes neutral rows for OAuth integrations', async () => {
    const supabase = createSupabase({
      data: {
        marketplace_key: 'oauth',
        shop_id: 'shop-1',
        country_code: 'NG',
      },
      error: null,
    });

    await expect(
      getJumiaOrderScope(supabase, 'merchant-1', 'integration-1')
    ).resolves.toEqual({
      kind: 'ok',
      cachedMarketplaceKeys: ['oauth', 'default'],
      marketplaceKey: 'oauth',
      shopId: 'shop-1',
    });
  });

  it('includes neutral rows when the shop has multiple marketplaces', async () => {
    // Multi-marketplace shops store unattributable orders under the neutral
    // scope; scoped reads must include it or per-integration views are empty.
    const supabase = createSupabase({
      data: { marketplace_key: 'NG-main', shop_id: 'shop-1' },
      error: null,
    });

    await expect(
      getJumiaOrderScope(supabase, 'merchant-1', 'integration-1')
    ).resolves.toEqual({
      kind: 'ok',
      cachedMarketplaceKeys: ['NG-main', 'default'],
      marketplaceKey: 'NG-main',
      shopId: 'shop-1',
    });
  });

  it('preserves database, missing-integration, and invalid-shop outcomes', async () => {
    await expect(
      getJumiaOrderScope(
        createSupabase({ data: null, error: { message: 'offline' } }),
        'merchant-1',
        'integration-1'
      )
    ).resolves.toEqual({ kind: 'database_error', message: 'offline' });

    await expect(
      getJumiaOrderScope(
        createSupabase({ data: null, error: null }),
        'merchant-1',
        'integration-1'
      )
    ).resolves.toEqual({ kind: 'not_found' });

    await expect(
      getJumiaOrderScope(
        createSupabase({
          data: { marketplace_key: 'NG', shop_id: null },
          error: null,
        }),
        'merchant-1',
        'integration-1'
      )
    ).resolves.toEqual({ kind: 'invalid_shop' });
  });
});
