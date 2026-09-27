import { describe, expect, it, vi } from 'vitest';

const { getShops, conflictingShopIds, MockJumiaClient } = vi.hoisted(() => {
  const mockGetShops = vi.fn();
  class MockJumiaClient {
    getShops = mockGetShops;
  }
  return {
    getShops: mockGetShops,
    conflictingShopIds: [] as string[],
    MockJumiaClient,
  };
});

vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: MockJumiaClient,
}));
vi.mock('@/lib/jumia/jumia-oauth-self-authorization-conflict', () => ({
  getActiveSelfAuthorizedJumiaShopIds: vi.fn(() => new Set<string>()),
  getJumiaOAuthShopIdsConflictingWithSelfAuthorization: vi.fn(
    () => conflictingShopIds
  ),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import { persistJumiaOAuthConnection } from './oauth-persistence';

const tokens = {
  access_token: 'access-token',
  expires_in: 3600,
  token_type: 'bearer',
  refresh_token: 'refresh-token',
  refresh_expires_in: 86400,
};

function makeSupabase(args?: {
  integrations?: Array<{
    shop_id: string;
    is_active: boolean;
    connection_method: string;
  }>;
  selectError?: Error;
  persistError?: Error;
}) {
  const table = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({
          data: args?.integrations ?? [],
          error: args?.selectError ?? null,
        }),
      })),
    })),
  };
  return {
    from: vi.fn(() => table),
    rpc: vi.fn().mockResolvedValue({
      data: args?.persistError ? null : true,
      error: args?.persistError ?? null,
    }),
    table,
  };
}

describe('persistJumiaOAuthConnection', () => {
  it('discovers and persists active shops', async () => {
    getShops.mockResolvedValueOnce([
      {
        id: 'shop-1',
        name: 'Shop 1',
        email: 'merchant@example.com',
        businessClients: [],
      },
    ]);
    const supabase = makeSupabase();

    await expect(
      persistJumiaOAuthConnection({
        merchantId: 'merchant-1',
        supabase: supabase as never,
        tokens,
      })
    ).resolves.toEqual({
      status: 'success',
      shopIds: ['shop-1'],
      isFallback: false,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'persist_jumia_oauth_integrations_atomically',
      expect.objectContaining({ p_merchant_id: 'merchant-1' })
    );
  });

  it('flags empty shop discovery as a fallback so the callback cannot report success', async () => {
    getShops.mockResolvedValueOnce([]);
    const supabase = makeSupabase();

    await expect(
      persistJumiaOAuthConnection({
        merchantId: 'merchant-1',
        supabase: supabase as never,
        tokens,
      })
    ).resolves.toEqual({ status: 'success', shopIds: [], isFallback: true });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'persist_jumia_oauth_integrations_atomically',
      expect.objectContaining({
        p_integrations: expect.arrayContaining([
          expect.objectContaining({ shop_id: 'oauth', is_active: false }),
        ]),
      })
    );
  });

  it('returns a database error when existing integrations cannot be loaded', async () => {
    getShops.mockResolvedValueOnce([]);
    const supabase = makeSupabase({ selectError: new Error('RLS denied') });

    await expect(
      persistJumiaOAuthConnection({
        merchantId: 'merchant-1',
        supabase: supabase as never,
        tokens,
      })
    ).resolves.toEqual({ status: 'database_error' });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when shop discovery fails before OAuth persistence', async () => {
    getShops.mockRejectedValueOnce(new Error('Jumia unavailable'));
    const supabase = makeSupabase();

    await expect(
      persistJumiaOAuthConnection({
        merchantId: 'merchant-1',
        supabase: supabase as never,
        tokens,
      })
    ).resolves.toEqual({ status: 'shop_discovery_failed' });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns a database error when atomic OAuth persistence fails', async () => {
    getShops.mockResolvedValueOnce([
      {
        id: 'shop-1',
        name: 'Shop 1',
        email: 'merchant@example.com',
        businessClients: [],
      },
    ]);
    const supabase = makeSupabase({ persistError: new Error('RPC failed') });

    await expect(
      persistJumiaOAuthConnection({
        merchantId: 'merchant-1',
        supabase: supabase as never,
        tokens,
      })
    ).resolves.toEqual({ status: 'database_error' });
    expect(supabase.rpc).toHaveBeenCalledTimes(3);
  });
});
