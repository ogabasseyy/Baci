import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticate = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockCsrf = vi.fn();
const mockGetOAuthConfig = vi.fn();
const mockGetReportingConfig = vi.fn();
const mockResolveToken = vi.fn();
const mockListAccounts = vi.fn();
const mockInvalidateAnalytics = vi.fn();
const mockRpc = vi.fn();
const mockCredentialRpc = vi.fn();
const mockSupabase = { rpc: mockRpc };
const mockCredentialSupabase = { rpc: mockCredentialRpc };
const mockCreateAdsCredentialServiceClient = vi.hoisted(() => vi.fn());
const MockGoogleAdsProviderError = vi.hoisted(
  () =>
    class MockGoogleAdsProviderError extends Error {
      readonly code: string;
      readonly status?: number;

      constructor(code: string, status?: number) {
        super(code);
        this.name = 'GoogleAdsProviderError';
        this.code = code;
        this.status = status;
      }
    }
);

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => mockAuthenticate(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCsrf(...args),
}));
vi.mock('@/lib/google-ads/config', () => ({
  GOOGLE_ADS_CONFIG_MISSING: 'Google Ads integration is not configured',
  getGoogleAdsOAuthConfig: (...args: unknown[]) => mockGetOAuthConfig(...args),
  getGoogleAdsReportingConfig: (...args: unknown[]) =>
    mockGetReportingConfig(...args),
}));
vi.mock('@/lib/google-ads/access-token', () => ({
  resolveGoogleAdsAccessToken: (...args: unknown[]) =>
    mockResolveToken(...args),
}));
vi.mock('@/lib/google-ads/provider', () => ({
  GOOGLE_ADS_DISCOVERY_LIMIT_CODES: [
    'GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT',
    'GOOGLE_ADS_MANAGER_DEPTH_LIMIT',
    'GOOGLE_ADS_ACCOUNT_DISCOVERY_LIMIT',
  ],
  GoogleAdsProviderError: MockGoogleAdsProviderError,
  listGoogleAdsAccessibleCustomerIds: (...args: unknown[]) =>
    mockListAccounts(...args),
}));
vi.mock('@/lib/ads/analytics-cache', () => ({
  invalidateAdsAnalyticsCache: (...args: unknown[]) =>
    mockInvalidateAnalytics(...args),
}));
vi.mock('@/lib/ads/server-credential-client', () => ({
  createAdsCredentialServiceClient: (...args: unknown[]) => {
    mockCreateAdsCredentialServiceClient(...args);
    return mockCredentialSupabase;
  },
}));

import { GET, PATCH } from './route';

const connection = {
  access_token_ciphertext: 'encrypted-access',
  id: 'connection-1',
  provider_customer_id: null,
  refresh_token_ciphertext: 'encrypted-refresh',
  status: 'active',
  token_expires_at: null,
};

describe('Google Ads account discovery and selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({
      error: null,
      supabase: mockSupabase,
      user: { id: 'user-1' },
    });
    mockGetUserAccess.mockResolvedValue({ merchantId: 'merchant-1' });
    mockHasPermission.mockReturnValue(true);
    mockCsrf.mockResolvedValue({ valid: true });
    mockGetOAuthConfig.mockReturnValue({
      clientId: 'client',
      clientSecret: 'secret',
      oauthStateSecret: 'state',
      redirectUri: 'https://usebaci.com/api/integrations/ads/google/callback',
      tokenEncryptionKey: 'key',
    });
    mockGetReportingConfig.mockReturnValue({
      developerToken: 'developer-token',
    });
    mockResolveToken.mockResolvedValue({
      accessToken: 'access-token',
      encryptedAccessToken: null,
      expiresAt: null,
    });
    mockListAccounts.mockResolvedValue(['1234567890', '0987654321']);
    mockCredentialRpc.mockImplementation((name: string) => {
      if (name === 'get_google_ads_connection_secret') {
        return Promise.resolve({ data: [connection], error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockCreateAdsCredentialServiceClient.mockClear();
  });

  it('returns 401 before account discovery when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValueOnce({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts'
      )
    );
    expect(response.status).toBe(401);
    expect(mockListAccounts).not.toHaveBeenCalled();
    expect(mockCreateAdsCredentialServiceClient).not.toHaveBeenCalled();
  });

  it('lists accessible customer IDs without returning token ciphertext', async () => {
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts'
      )
    );
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.accounts).toEqual([
      { customerId: '1234567890', selected: false },
      { customerId: '0987654321', selected: false },
    ]);
    expect(JSON.stringify(json)).not.toContain('encrypted-access');
    expect(mockCreateAdsCredentialServiceClient).toHaveBeenCalledTimes(1);
    expect(mockCredentialRpc).toHaveBeenCalledWith(
      'get_google_ads_connection_secret',
      { p_merchant_id: 'merchant-1' }
    );
    expect(mockRpc).not.toHaveBeenCalledWith(
      'get_google_ads_connection_secret',
      expect.anything()
    );
  });

  it('surfaces a bounded discovery failure as a retryable error instead of a partial list', async () => {
    mockListAccounts.mockRejectedValueOnce(
      new MockGoogleAdsProviderError('GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT')
    );

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts'
      )
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT',
      retry: true,
    });
  });

  it('surfaces a bounded discovery failure during selection as a retryable error', async () => {
    mockListAccounts.mockRejectedValueOnce(
      new MockGoogleAdsProviderError('GOOGLE_ADS_MANAGER_DEPTH_LIMIT')
    );

    const response = await PATCH(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts',
        {
          body: JSON.stringify({ customerId: '123-456-7890' }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        }
      )
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'GOOGLE_ADS_MANAGER_DEPTH_LIMIT',
      retry: true,
    });
    expect(mockCredentialRpc).not.toHaveBeenCalledWith(
      'set_google_ads_customer',
      expect.anything()
    );
  });

  it('marks the current grant revoked when selection discovery returns 401', async () => {
    mockListAccounts.mockRejectedValueOnce(
      new MockGoogleAdsProviderError('GOOGLE_ADS_ACCESS_REVOKED', 401)
    );

    const response = await PATCH(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts',
        {
          body: JSON.stringify({ customerId: '123-456-7890' }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        }
      )
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to discover Google Ads accounts',
    });
    expect(mockCredentialRpc).toHaveBeenCalledWith(
      'mark_google_ads_connection_reauth_if_current',
      {
        p_access_token_ciphertext: 'encrypted-access',
        p_merchant_id: 'merchant-1',
        p_reason: 'GOOGLE_ADS_ACCESS_REVOKED',
        p_refresh_token_ciphertext: 'encrypted-refresh',
      }
    );
    expect(mockCredentialRpc).not.toHaveBeenCalledWith(
      'set_google_ads_customer',
      expect.anything()
    );
  });

  it('marks the connection for reauthorization when selection token refresh fails', async () => {
    mockResolveToken.mockRejectedValueOnce({
      code: 'GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED',
      status: 400,
    });

    const response = await PATCH(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts',
        {
          body: JSON.stringify({ customerId: '123-456-7890' }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        }
      )
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Google Ads authorization expired',
    });
    expect(mockCredentialRpc).toHaveBeenCalledWith(
      'mark_google_ads_connection_reauth_if_current',
      {
        p_access_token_ciphertext: 'encrypted-access',
        p_merchant_id: 'merchant-1',
        p_reason: 'GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED',
        p_refresh_token_ciphertext: 'encrypted-refresh',
      }
    );
    expect(mockListAccounts).not.toHaveBeenCalled();
  });

  it('does not overwrite a newer OAuth connection when refresh CAS loses the race', async () => {
    mockResolveToken.mockResolvedValueOnce({
      accessToken: 'refreshed-access-token',
      encryptedAccessToken: 'new-encrypted-access',
      expiresAt: '2026-08-22T01:00:00.000Z',
    });
    mockCredentialRpc.mockImplementation((name: string) => {
      if (name === 'get_google_ads_connection_secret') {
        return Promise.resolve({ data: [connection], error: null });
      }
      if (name === 'update_google_ads_connection_token_if_current') {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts'
      )
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Google Ads authorization changed; retry account discovery',
      retry: true,
    });
    expect(mockCredentialRpc).toHaveBeenCalledWith(
      'update_google_ads_connection_token_if_current',
      {
        p_access_token_ciphertext: 'new-encrypted-access',
        p_expected_access_token_ciphertext: 'encrypted-access',
        p_expected_refresh_token_ciphertext: 'encrypted-refresh',
        p_merchant_id: 'merchant-1',
        p_token_expires_at: '2026-08-22T01:00:00.000Z',
      }
    );
    expect(mockListAccounts).not.toHaveBeenCalled();
  });

  it('marks the connection for reauthorization when discovery cannot refresh its token', async () => {
    mockResolveToken.mockRejectedValueOnce({
      code: 'GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED',
      status: 400,
    });

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts'
      )
    );

    expect(response.status).toBe(502);
    expect(mockCredentialRpc).toHaveBeenCalledWith(
      'mark_google_ads_connection_reauth_if_current',
      {
        p_access_token_ciphertext: 'encrypted-access',
        p_merchant_id: 'merchant-1',
        p_reason: 'GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED',
        p_refresh_token_ciphertext: 'encrypted-refresh',
      }
    );
  });

  it('rejects a syntactically valid customer that Google did not grant', async () => {
    const response = await PATCH(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts',
        {
          body: JSON.stringify({ customerId: '1111111111' }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        }
      )
    );
    expect(response.status).toBe(400);
    expect(mockCredentialRpc).not.toHaveBeenCalledWith(
      'set_google_ads_customer',
      expect.anything()
    );
  });

  it('returns 400 for malformed JSON before provider discovery', async () => {
    const response = await PATCH(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts',
        {
          body: '{',
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        }
      )
    );
    expect(response.status).toBe(400);
    expect(mockGetUserAccess).not.toHaveBeenCalled();
    expect(mockListAccounts).not.toHaveBeenCalled();
    expect(mockCreateAdsCredentialServiceClient).not.toHaveBeenCalled();
  });

  it('selects only a discovered customer account', async () => {
    const response = await PATCH(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts',
        {
          body: JSON.stringify({ customerId: '123-456-7890' }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        }
      )
    );
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json).toEqual({ customerId: '1234567890', selected: true });
    expect(mockCredentialRpc).toHaveBeenCalledWith('set_google_ads_customer', {
      p_expected_access_token_ciphertext: 'encrypted-access',
      p_merchant_id: 'merchant-1',
      p_provider_customer_id: '1234567890',
    });
    expect(mockInvalidateAnalytics).toHaveBeenCalledWith('merchant-1');
    expect(mockCreateAdsCredentialServiceClient).toHaveBeenCalledTimes(1);
  });

  it('persists a refreshed token before selecting an account', async () => {
    mockResolveToken.mockResolvedValueOnce({
      accessToken: 'refreshed-access-token',
      encryptedAccessToken: 'new-encrypted-access',
      expiresAt: '2026-08-22T01:00:00.000Z',
    });

    const response = await PATCH(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts',
        {
          body: JSON.stringify({ customerId: '123-456-7890' }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        }
      )
    );

    expect(response.status).toBe(200);
    expect(mockCredentialRpc).toHaveBeenCalledWith(
      'update_google_ads_connection_token_if_current',
      {
        p_access_token_ciphertext: 'new-encrypted-access',
        p_expected_access_token_ciphertext: 'encrypted-access',
        p_expected_refresh_token_ciphertext: 'encrypted-refresh',
        p_merchant_id: 'merchant-1',
        p_token_expires_at: '2026-08-22T01:00:00.000Z',
      }
    );
    expect(mockCredentialRpc).toHaveBeenCalledWith('set_google_ads_customer', {
      p_expected_access_token_ciphertext: 'new-encrypted-access',
      p_merchant_id: 'merchant-1',
      p_provider_customer_id: '1234567890',
    });
    const updateCallIndex = mockCredentialRpc.mock.calls.findIndex(
      ([name]) => name === 'update_google_ads_connection_token_if_current'
    );
    const selectionCallIndex = mockCredentialRpc.mock.calls.findIndex(
      ([name]) => name === 'set_google_ads_customer'
    );
    expect(updateCallIndex).toBeLessThan(selectionCallIndex);
  });

  it('rejects a selection when the guarded RPC reports no updated connection', async () => {
    mockCredentialRpc.mockImplementation((name: string) => {
      if (name === 'get_google_ads_connection_secret') {
        return Promise.resolve({ data: [connection], error: null });
      }
      if (name === 'set_google_ads_customer') {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });

    const response = await PATCH(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts',
        {
          body: JSON.stringify({ customerId: '123-456-7890' }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        }
      )
    );

    expect(response.status).toBe(409);
    expect(mockInvalidateAnalytics).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: 'Google Ads authorization changed; retry account selection',
    });
  });
});
