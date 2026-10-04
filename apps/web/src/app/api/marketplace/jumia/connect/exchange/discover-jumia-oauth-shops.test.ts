import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetShops, mockConstructJumiaClient } = vi.hoisted(() => ({
  mockGetShops: vi.fn(),
  mockConstructJumiaClient: vi.fn(),
}));

vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: class MockJumiaClient {
    constructor(config: unknown) {
      mockConstructJumiaClient(config);
    }

    getShops() {
      return mockGetShops();
    }
  },
}));

import { discoverJumiaOAuthShops } from './discover-jumia-oauth-shops';

const baseArgs = {
  merchantId: 'merchant-1',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  tokenExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
  supabase: {} as SupabaseClient,
};

describe('discoverJumiaOAuthShops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns discovered shops without using the fallback', async () => {
    const shops = [
      {
        id: 'shop-1',
        name: 'Shop One',
        email: '',
        businessClients: [],
      },
    ];
    mockGetShops.mockResolvedValueOnce(shops);

    const result = await discoverJumiaOAuthShops(baseArgs);

    expect(result).toEqual({ shops, isFallbackShop: false });
    expect(mockConstructJumiaClient).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: 'temp',
        merchantId: 'merchant-1',
        shopId: 'oauth',
        marketplaceKey: 'oauth',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      })
    );
  });

  it('fails over to the inactive placeholder when provider discovery fails', async () => {
    mockGetShops.mockRejectedValueOnce(new Error('provider unavailable'));

    const result = await discoverJumiaOAuthShops(baseArgs);

    expect(result).toEqual({
      isFallbackShop: true,
      shops: [
        expect.objectContaining({
          id: 'oauth',
          name: 'Jumia Shop',
          businessClients: [expect.objectContaining({ code: 'jumia_ng' })],
        }),
      ],
    });
  });
});
