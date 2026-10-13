import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticate = vi.fn();
const access = vi.fn();
const permission = vi.fn();
const csrf = vi.fn();
const listAccounts = vi.fn();
const resolveToken = vi.fn();
const rpc = vi.fn();
const { credentialRpc, createAdsCredentialServiceClient } = vi.hoisted(() => ({
  credentialRpc: vi.fn(),
  createAdsCredentialServiceClient: vi.fn(),
}));
const getConfig = vi.fn();
const markReauth = vi.fn();
const invalidateAnalytics = vi.fn();
vi.mock('@/lib/ads/analytics-cache', () => ({
  invalidateAdsAnalyticsCache: (...args: unknown[]) =>
    invalidateAnalytics(...args),
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => authenticate(...args),
  getUserAccess: (...args: unknown[]) => access(...args),
  hasPermission: (...args: unknown[]) => permission(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => csrf(...args),
}));
vi.mock('@/lib/ads/meta/config', () => ({
  getMetaAdsConfig: (...args: unknown[]) => getConfig(...args),
  META_ADS_CONFIG_MISSING: 'Meta Ads integration is not configured',
  MetaAdsConfigError: class MetaAdsConfigError extends Error {},
}));
vi.mock('@/lib/ads/meta/access-token', () => ({
  resolveMetaAdsAccessToken: (...args: unknown[]) => resolveToken(...args),
}));
vi.mock('@/lib/ads/meta/provider', () => ({
  listMetaAdsAccounts: (...args: unknown[]) => listAccounts(...args),
  MetaAdsProviderError: class MetaAdsProviderError extends Error {},
}));
vi.mock('@/lib/ads/meta/sync', () => ({
  markMetaAdsReauthRequired: (...args: unknown[]) => markReauth(...args),
  MetaAdsReauthPersistenceError: class MetaAdsReauthPersistenceError extends Error {
    code = 'META_ADS_REAUTH_PERSIST_FAILED';
  },
}));
vi.mock('@/lib/ads/server-credential-client', () => ({
  createAdsCredentialServiceClient: (...args: unknown[]) => {
    createAdsCredentialServiceClient(...args);
    return { rpc: credentialRpc };
  },
}));

import { GET, PATCH } from './route';

describe('Meta Ads accounts route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    csrf.mockResolvedValue({ valid: true });
    getConfig.mockReturnValue({});
    markReauth.mockResolvedValue(undefined);
    resolveToken.mockReturnValue('access');
    listAccounts.mockResolvedValue([
      {
        accountId: 'act_12',
        currencyCode: 'NGN',
        label: 'Verified account',
        timezoneName: 'Africa/Lagos',
        timezoneOffsetHours: '1',
      },
    ]);
    rpc.mockImplementation((name: string) =>
      name === 'get_merchant_ads_connection_secret'
        ? Promise.resolve({
            data: [
              {
                access_token_ciphertext: 'cipher',
                provider_customer_id: null,
                refresh_token_ciphertext: 'refresh-cipher',
                status: 'active',
                token_expires_at: '2026-10-01T00:00:00Z',
              },
            ],
            error: null,
          })
        : Promise.resolve({ data: true, error: null })
    );
    credentialRpc.mockImplementation((name: string) =>
      name === 'get_merchant_ads_connection_secret'
        ? Promise.resolve({
            data: [
              {
                access_token_ciphertext: 'cipher',
                provider_customer_id: null,
                refresh_token_ciphertext: 'refresh-cipher',
                status: 'active',
                token_expires_at: '2026-10-01T00:00:00Z',
              },
            ],
            error: null,
          })
        : Promise.resolve({ data: true, error: null })
    );
  });

  it('distinguishes missing configuration from provider authorization errors', async () => {
    getConfig.mockImplementationOnce(() => {
      const error = new Error('missing');
      error.name = 'MetaAdsConfigError';
      throw error;
    });
    const configuration = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/meta/accounts')
    );
    expect(configuration.status).toBe(503);
    expect((await configuration.json()).error).toBe(
      'Meta Ads integration is not configured'
    );
    listAccounts.mockRejectedValueOnce(
      Object.assign(new Error('META_ADS_ACCESS_REVOKED'), {
        code: 'META_ADS_ACCESS_REVOKED',
      })
    );
    const revoked = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/meta/accounts')
    );
    expect(revoked.status).toBe(502);
    expect((await revoked.json()).error).toBe('META_ADS_ACCESS_REVOKED');
    expect(markReauth).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'META_ADS_ACCESS_REVOKED' })
    );
  });

  it('marks a missing Meta access grant for reauthorization during discovery and selection', async () => {
    resolveToken.mockImplementation(() => {
      throw new Error('META_ADS_REAUTH_REQUIRED');
    });

    const discovery = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/meta/accounts')
    );
    expect(discovery.status).toBe(502);
    expect(markReauth).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: expect.objectContaining({
          refresh_token_ciphertext: 'refresh-cipher',
        }),
        failureCode: 'META_ADS_REAUTH_REQUIRED',
      })
    );

    markReauth.mockClear();
    const selection = await PATCH(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/accounts',
        {
          body: JSON.stringify({ accountId: 'act_12' }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        }
      )
    );
    expect(selection.status).toBe(502);
    expect(markReauth).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'META_ADS_REAUTH_REQUIRED' })
    );
  });

  it('marks an undecryptable Meta access grant for reauthorization', async () => {
    resolveToken.mockImplementation(() => {
      throw new Error('META_ADS_ACCESS_TOKEN_DECRYPT_FAILED');
    });

    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/meta/accounts')
    );

    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe(
      'META_ADS_AUTHORIZATION_UNAVAILABLE'
    );
    expect(markReauth).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: 'META_ADS_ACCESS_TOKEN_DECRYPT_FAILED',
      })
    );
  });
  it('does not discover accounts without authentication', async () => {
    authenticate.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/meta/accounts'
          )
        )
      ).status
    ).toBe(401);
    expect(createAdsCredentialServiceClient).not.toHaveBeenCalled();
  });

  it('rejects malformed selection input before merchant lookup', async () => {
    const response = await PATCH(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/accounts',
        {
          body: '{',
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        }
      )
    );

    expect(response.status).toBe(400);
    expect(access).not.toHaveBeenCalled();
    expect(listAccounts).not.toHaveBeenCalled();
    expect(createAdsCredentialServiceClient).not.toHaveBeenCalled();
  });

  it('selects only a freshly discovered canonical act_ account', async () => {
    const response = await PATCH(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/accounts',
        {
          body: JSON.stringify({ accountId: 'act_12' }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        }
      )
    );
    expect(response.status).toBe(200);
    expect(credentialRpc).toHaveBeenCalledWith(
      'set_merchant_ads_account',
      expect.objectContaining({
        p_expected_access_token_ciphertext: 'cipher',
        p_provider_customer_id: 'act_12',
      })
    );
    expect(invalidateAnalytics).toHaveBeenCalledWith('merchant');
    expect(rpc).not.toHaveBeenCalledWith(
      'get_merchant_ads_connection_secret',
      expect.anything()
    );
    listAccounts.mockResolvedValueOnce([]);
    const rejected = await PATCH(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/accounts',
        {
          body: JSON.stringify({ accountId: 'act_99' }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        }
      )
    );
    expect(rejected.status).toBe(400);
  });
});
