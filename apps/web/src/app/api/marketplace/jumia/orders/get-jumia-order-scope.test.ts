import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { getJumiaOrderScope } from './get-jumia-order-scope';

function createSupabase(
  response: unknown,
  activeIntegrations: unknown = { data: [], error: null }
) {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(response),
    select: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const activeQuery = {
    eq: vi.fn(),
    or: vi.fn(),
    select: vi.fn(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are intentionally thenable.
    then: (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown
    ) => Promise.resolve(activeIntegrations).then(resolve, reject),
  };
  activeQuery.select.mockReturnValue(activeQuery);
  activeQuery.eq.mockReturnValue(activeQuery);
  activeQuery.or.mockImplementation(() => Promise.resolve(activeIntegrations));
  let fromCalls = 0;
  return {
    from: vi.fn(() => {
      fromCalls += 1;
      return fromCalls === 1 ? query : activeQuery;
    }),
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

  it('counts the shop scope within the integration country', async () => {
    const supabase = createSupabase(
      {
        data: {
          marketplace_key: 'NG-main',
          shop_id: 'shop-1',
          country_code: 'NG',
        },
        error: null,
      },
      { data: [], error: null }
    );

    await expect(
      getJumiaOrderScope(supabase, 'merchant-1', 'integration-1')
    ).resolves.toEqual({
      kind: 'ok',
      cachedMarketplaceKeys: ['NG-main', 'default'],
      marketplaceKey: 'NG-main',
      shopId: 'shop-1',
    });
    const activeQuery = (supabase.from as ReturnType<typeof vi.fn>).mock
      .results[1].value as { or: ReturnType<typeof vi.fn> };
    expect(activeQuery.or).toHaveBeenCalledWith(
      'country_code.eq.NG,country_code.is.null'
    );
  });

  it('keeps the shop-wide scope count for OAuth integrations', async () => {
    const supabase = createSupabase(
      {
        data: {
          marketplace_key: 'oauth',
          shop_id: 'shop-1',
          country_code: 'NG',
        },
        error: null,
      },
      { data: [], error: null }
    );

    await expect(
      getJumiaOrderScope(supabase, 'merchant-1', 'integration-1')
    ).resolves.toEqual({
      kind: 'ok',
      cachedMarketplaceKeys: ['oauth', 'default'],
      marketplaceKey: 'oauth',
      shopId: 'shop-1',
    });
    const activeQuery = (supabase.from as ReturnType<typeof vi.fn>).mock
      .results[1].value as { or: ReturnType<typeof vi.fn> };
    expect(activeQuery.or).not.toHaveBeenCalled();
  });

  it('does not include neutral rows when the shop has multiple marketplaces', async () => {
    const supabase = createSupabase(
      {
        data: { marketplace_key: 'NG-main', shop_id: 'shop-1' },
        error: null,
      },
      {
        data: [
          { marketplace_key: 'NG-main' },
          { marketplace_key: 'NG-express' },
        ],
        error: null,
      }
    );

    await expect(
      getJumiaOrderScope(supabase, 'merchant-1', 'integration-1')
    ).resolves.toEqual({
      kind: 'ok',
      cachedMarketplaceKeys: ['NG-main'],
      marketplaceKey: 'NG-main',
      shopId: 'shop-1',
    });
  });

  it('returns a database error when marketplace scope lookup fails', async () => {
    await expect(
      getJumiaOrderScope(
        createSupabase(
          {
            data: { marketplace_key: 'NG-main', shop_id: 'shop-1' },
            error: null,
          },
          { data: null, error: { message: 'offline' } }
        ),
        'merchant-1',
        'integration-1'
      )
    ).resolves.toEqual({ kind: 'database_error', message: 'offline' });
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
