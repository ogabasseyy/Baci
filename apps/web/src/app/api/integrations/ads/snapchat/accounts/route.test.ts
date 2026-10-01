import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.fn();
const access = vi.fn();
const permission = vi.fn();
const usableToken = vi.fn();
const accounts = vi.fn();
const csrf = vi.fn();
const config = vi.fn();
const invalidateAnalytics = vi.fn();
const createAdsCredentialServiceClient = vi.fn();
vi.mock('@/lib/ads/analytics-cache', () => ({
  invalidateAdsAnalyticsCache: (...args: unknown[]) =>
    invalidateAnalytics(...args),
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => auth(...args),
  getUserAccess: (...args: unknown[]) => access(...args),
  hasPermission: (...args: unknown[]) => permission(...args),
}));
vi.mock('@/lib/ads/snapchat/access-token', () => ({
  getSnapchatAdsUsableAccessToken: (...args: unknown[]) => usableToken(...args),
  getSnapchatAdsUsableGrant: async (...args: unknown[]) => ({
    accessToken: await usableToken(...args),
    accessTokenCiphertext: 'SNAP_REFRESHED_ACCESS_CIPHERTEXT',
    refreshTokenCiphertext: 'SNAP_REFRESHED_REFRESH_CIPHERTEXT',
    tokenExpiresAt: '2026-09-01T00:00:00.000Z',
  }),
  SnapchatAdsTokenRefreshError: class SnapchatAdsTokenRefreshError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));
vi.mock('@/lib/ads/snapchat/config', () => ({
  getSnapchatAdsConfig: () => config(),
  SNAPCHAT_ADS_CONFIG_MISSING: 'Snapchat Ads integration is not configured',
  SnapchatAdsConfigError: class SnapchatAdsConfigError extends Error {},
}));
vi.mock('@/lib/ads/snapchat/provider', () => ({
  listSnapchatAdsAccounts: (...args: unknown[]) => accounts(...args),
  SnapchatAdsProviderError: class SnapchatAdsProviderError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => csrf(...args),
}));
vi.mock('@/lib/ads/server-credential-client', () => ({
  createAdsCredentialServiceClient: (...args: unknown[]) =>
    createAdsCredentialServiceClient(...args),
}));

import { GET, PATCH } from './route';

describe('Snapchat Ads accounts route', () => {
  function activeConnection() {
    return {
      access_token_ciphertext: 'SNAP_ACCOUNTS_ACCESS_SENTINEL',
      provider_customer_id: null,
      refresh_token_ciphertext: 'SNAP_ACCOUNTS_REFRESH_SENTINEL',
      status: 'active',
      token_expires_at: '2026-08-20T00:00:00Z',
    };
  }

  it('denies unauthenticated discovery and selection', async () => {
    auth.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/snapchat/accounts'
          )
        )
      ).status
    ).toBe(401);
    expect(
      (
        await PATCH(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/snapchat/accounts',
            { body: '{}', method: 'PATCH' }
          )
        )
      ).status
    ).toBe(401);
  });

  it('refreshes an expired connection token before discovery and revalidated selection', async () => {
    const rpc = vi.fn((name: string) => {
      if (name === 'get_merchant_ads_connection_secret')
        return Promise.resolve({
          data: [activeConnection()],
          error: null,
        });
      return Promise.resolve({ data: true, error: null });
    });
    createAdsCredentialServiceClient.mockReturnValue({ rpc });
    auth.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    config.mockReturnValue({ tokenEncryptionKey: 'key' });
    usableToken.mockResolvedValue('refreshed');
    accounts.mockResolvedValue([
      {
        accountId: 'ad-1',
        currencyCode: 'USD',
        label: 'Account',
        organizationId: 'org',
        timezoneName: 'UTC',
      },
    ]);
    csrf.mockResolvedValue({ valid: true });
    const discovery = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/accounts'
      )
    );
    expect(discovery.status).toBe(200);
    expect(JSON.stringify(await discovery.json())).not.toContain(
      'SNAP_ACCOUNTS_ACCESS_SENTINEL'
    );
    await expect(
      PATCH(
        new NextRequest(
          'https://usebaci.com/api/integrations/ads/snapchat/accounts',
          { body: JSON.stringify({ accountId: 'ad-1' }), method: 'PATCH' }
        )
      )
    ).resolves.toMatchObject({ status: 200 });
    expect(usableToken).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith(
      'set_merchant_ads_account',
      expect.objectContaining({
        p_expected_access_token_ciphertext: 'SNAP_REFRESHED_ACCESS_CIPHERTEXT',
        p_provider_customer_id: 'ad-1',
      })
    );
    expect(invalidateAnalytics).toHaveBeenCalledWith('merchant');
  });

  it('drives permission, CSRF, Zod, and inaccessible-account branches', async () => {
    auth.mockResolvedValue({
      error: null,
      supabase: { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(false);
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/snapchat/accounts'
          )
        )
      ).status
    ).toBe(403);
    permission.mockReturnValue(true);
    csrf.mockResolvedValue({ valid: false });
    expect(
      (
        await PATCH(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/snapchat/accounts',
            { body: '{}', method: 'PATCH' }
          )
        )
      ).status
    ).toBe(403);
    csrf.mockResolvedValue({ valid: true });
    expect(
      (
        await PATCH(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/snapchat/accounts',
            { body: '{}', method: 'PATCH' }
          )
        )
      ).status
    ).toBe(400);
  });

  it('returns safe connection, refresh, provider, and selection failures', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ access_token_ciphertext: 'SNAP_READ_SENTINEL' }],
        error: { message: 'SNAP_READ_SENTINEL' },
      })
      .mockResolvedValueOnce({ data: [activeConnection()], error: null })
      .mockResolvedValueOnce({ data: [activeConnection()], error: null })
      .mockResolvedValueOnce({ data: [activeConnection()], error: null });
    createAdsCredentialServiceClient.mockReturnValue({ rpc });
    auth.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    csrf.mockResolvedValue({ valid: true });
    config.mockReturnValue({ tokenEncryptionKey: 'key' });

    const readFailure = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/accounts'
      )
    );
    expect(readFailure.status).toBe(500);
    expect(JSON.stringify(await readFailure.json())).not.toContain(
      'SNAP_READ_SENTINEL'
    );

    usableToken.mockRejectedValueOnce(new Error('SNAP_REFRESH_SENTINEL'));
    const refreshFailure = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/accounts'
      )
    );
    expect(refreshFailure.status).toBe(502);
    expect(JSON.stringify(await refreshFailure.json())).not.toContain(
      'SNAP_REFRESH_SENTINEL'
    );

    usableToken.mockResolvedValueOnce('valid-token');
    accounts.mockRejectedValueOnce(new Error('SNAP_PROVIDER_SENTINEL'));
    const providerFailure = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/accounts'
      )
    );
    expect(providerFailure.status).toBe(502);
    expect(JSON.stringify(await providerFailure.json())).not.toContain(
      'SNAP_PROVIDER_SENTINEL'
    );

    usableToken.mockResolvedValueOnce('valid-token');
    accounts.mockResolvedValueOnce([]);
    const inaccessible = await PATCH(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/accounts',
        {
          body: JSON.stringify({ accountId: 'not-accessible' }),
          method: 'PATCH',
        }
      )
    );
    expect(inaccessible.status).toBe(400);
    expect(await inaccessible.json()).toEqual({
      error: 'Snapchat Ads account is not accessible',
    });
  });

  it('rejects malformed selection input before merchant lookup', async () => {
    auth.mockResolvedValue({
      error: null,
      supabase: { rpc: vi.fn() },
      user: { id: 'user' },
    });
    csrf.mockResolvedValue({ valid: true });
    access.mockClear();
    accounts.mockClear();

    const response = await PATCH(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/accounts',
        { body: '{', method: 'PATCH' }
      )
    );

    expect(response.status).toBe(400);
    expect(access).not.toHaveBeenCalled();
    expect(accounts).not.toHaveBeenCalled();
  });
});
