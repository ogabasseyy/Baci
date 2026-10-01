import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticate = vi.fn();
const mockHasPermission = vi.fn();
const mockResolveMerchant = vi.fn();
const mockGetOAuthConfig = vi.fn();
const mockGetReportingConfig = vi.fn();
const mockResolveToken = vi.fn();
const mockListAccounts = vi.fn();
const mockRpc = vi.fn();
const mockCredentialRpc = vi.fn();
const mockSupabase = { rpc: mockRpc };
const mockCredentialSupabase = { rpc: mockCredentialRpc };
const mockCreateAdsCredentialServiceClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => mockAuthenticate(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock('@/lib/ads/merchant-context', () => ({
  resolveAdsMerchantAccess: (...args: unknown[]) =>
    mockResolveMerchant(...args),
}));
vi.mock('@/lib/ads/server-credential-client', () => ({
  createAdsCredentialServiceClient: (...args: unknown[]) => {
    mockCreateAdsCredentialServiceClient(...args);
    return mockCredentialSupabase;
  },
}));
vi.mock('@/lib/google-ads/config', () => ({
  GOOGLE_ADS_CONFIG_MISSING: 'Google Ads integration is not configured',
  getGoogleAdsOAuthConfig: () => mockGetOAuthConfig(),
  getGoogleAdsReportingConfig: () => mockGetReportingConfig(),
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
  listGoogleAdsAccessibleCustomerIds: (...args: unknown[]) =>
    mockListAccounts(...args),
  GoogleAdsProviderError: class GoogleAdsProviderError extends Error {
    readonly code: string;
    readonly status?: number;

    constructor(code: string, status?: number) {
      super(code);
      this.code = code;
      this.status = status;
    }
  },
}));

import { GoogleAdsProviderError } from '@/lib/google-ads/provider';
import { GET } from './route';

const connection = {
  access_token_ciphertext: 'current-access-ciphertext',
  provider_customer_id: null,
  refresh_token_ciphertext: 'current-refresh-ciphertext',
  status: 'active',
  token_expires_at: '2026-08-26T00:00:00.000Z',
};

describe('Google Ads account discovery revoked-token handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({
      error: null,
      supabase: mockSupabase,
      user: { id: 'user-1' },
    });
    mockResolveMerchant.mockResolvedValue({
      access: { merchantId: 'merchant-1' },
      response: null,
    });
    mockHasPermission.mockReturnValue(true);
    mockGetOAuthConfig.mockReturnValue({});
    mockGetReportingConfig.mockReturnValue({});
    mockResolveToken.mockResolvedValue({
      accessToken: 'rejected-access-token',
      encryptedAccessToken: null,
      expiresAt: connection.token_expires_at,
    });
    mockListAccounts.mockRejectedValue(
      new GoogleAdsProviderError('GOOGLE_ADS_ACCOUNT_DISCOVERY_FAILED', 401)
    );
    mockCredentialRpc.mockImplementation((name: string) => {
      if (name === 'get_google_ads_connection_secret') {
        return Promise.resolve({ data: [connection], error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });
    mockRpc.mockResolvedValue({ data: true, error: null });
  });

  it('marks the currently rejected grant reconnect-required when discovery returns 401', async () => {
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts'
      )
    );

    expect(response.status).toBe(502);
    expect(mockCredentialRpc).toHaveBeenCalledWith(
      'mark_google_ads_connection_reauth_if_current',
      {
        p_access_token_ciphertext: 'current-access-ciphertext',
        p_merchant_id: 'merchant-1',
        p_reason: 'GOOGLE_ADS_ACCESS_REVOKED',
        p_refresh_token_ciphertext: 'current-refresh-ciphertext',
      }
    );
    expect(mockRpc).not.toHaveBeenCalledWith(
      'get_google_ads_connection_secret',
      expect.anything()
    );
  });

  it('marks a refreshed token when discovery rejects it after its guarded update', async () => {
    mockResolveToken.mockResolvedValue({
      accessToken: 'refreshed-access-token',
      encryptedAccessToken: 'refreshed-access-ciphertext',
      expiresAt: '2026-08-26T01:00:00.000Z',
    });

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts'
      )
    );

    expect(response.status).toBe(502);
    expect(mockCredentialRpc).toHaveBeenCalledWith(
      'update_google_ads_connection_token_if_current',
      expect.objectContaining({
        p_access_token_ciphertext: 'refreshed-access-ciphertext',
        p_expected_access_token_ciphertext: 'current-access-ciphertext',
        p_expected_refresh_token_ciphertext: 'current-refresh-ciphertext',
      })
    );
    expect(mockCredentialRpc).toHaveBeenCalledWith(
      'mark_google_ads_connection_reauth_if_current',
      expect.objectContaining({
        p_access_token_ciphertext: 'refreshed-access-ciphertext',
        p_refresh_token_ciphertext: 'current-refresh-ciphertext',
      })
    );
  });

  it('reports a status-write failure when a newer OAuth grant wins the race', async () => {
    mockCredentialRpc.mockImplementation((name: string) => {
      if (name === 'get_google_ads_connection_secret') {
        return Promise.resolve({ data: [connection], error: null });
      }
      if (name === 'mark_google_ads_connection_reauth_if_current') {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/accounts'
      )
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to update Google Ads authorization status',
    });
  });
});
