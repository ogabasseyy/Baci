import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetOAuthConfig = vi.fn();
const mockGetReportingConfig = vi.fn();
const mockResolveToken = vi.fn();
const mockFetchSpend = vi.fn();
const mockRpc = vi.fn();
const mockCredentialRpc = vi.fn();
const supabase = { rpc: mockRpc } as never;
const credentialSupabase = { rpc: mockCredentialRpc } as never;

vi.mock('@/lib/google-ads/config', () => ({
  getGoogleAdsOAuthConfig: (...args: unknown[]) => mockGetOAuthConfig(...args),
  getGoogleAdsReportingConfig: (...args: unknown[]) =>
    mockGetReportingConfig(...args),
}));
vi.mock('@/lib/google-ads/access-token', () => ({
  resolveGoogleAdsAccessToken: (...args: unknown[]) =>
    mockResolveToken(...args),
}));
vi.mock('@/lib/google-ads/provider', () => ({
  fetchGoogleAdsDailySpend: (...args: unknown[]) => mockFetchSpend(...args),
  GoogleAdsProviderError: class GoogleAdsProviderError extends Error {
    code: string;
    status?: number;

    constructor(code: string, status?: number) {
      super(code);
      this.code = code;
      this.status = status;
    }
  },
}));

import { GoogleAdsProviderError } from './provider';
import { syncGoogleAdsSpendForMerchant } from './sync';

describe('syncGoogleAdsSpendForMerchant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockCredentialRpc.mockImplementation((name: string) => {
      if (name === 'get_google_ads_connection_secret') {
        return Promise.resolve({
          data: [
            {
              access_token_ciphertext: 'encrypted-access',
              id: 'connection-1',
              provider_customer_id: '1234567890',
              refresh_token_ciphertext: 'encrypted-refresh',
              status: 'active',
              token_expires_at: '2026-08-22T00:00:00.000Z',
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: true, error: null });
    });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockResolveToken.mockResolvedValue({
      accessToken: 'access-token',
      encryptedAccessToken: null,
      expiresAt: '2026-08-22T00:00:00.000Z',
    });
    mockFetchSpend.mockResolvedValue([
      {
        clicks: 4,
        conversions: 1.25,
        currencyCode: 'NGN',
        customerId: '1234567890',
        date: '2026-08-20',
        impressions: 100,
        spendMicros: '2500000',
      },
    ]);
  });

  it('writes normalized provider rows through the guarded RPCs', async () => {
    const result = await syncGoogleAdsSpendForMerchant({
      endDate: '2026-08-21',
      credentialSupabase,
      merchantId: 'merchant-1',
      spendSupabase: supabase,
      startDate: '2026-08-20',
      supabase,
    });

    expect(result).toEqual({ customerId: '1234567890', rowsWritten: 1 });
    expect(mockCredentialRpc).toHaveBeenCalledWith(
      'get_google_ads_connection_secret',
      { p_merchant_id: 'merchant-1' }
    );
    expect(mockRpc).not.toHaveBeenCalledWith(
      'get_google_ads_connection_secret',
      expect.anything()
    );
    expect(mockRpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_sync_started_if_current',
      expect.objectContaining({
        p_provider: 'google_ads',
        p_sync_run_id: expect.any(String),
        p_sync_run_started_at: expect.any(String),
      })
    );
    expect(mockRpc).toHaveBeenCalledWith(
      'replace_google_ads_spend_daily',
      expect.objectContaining({
        p_merchant_id: 'merchant-1',
        p_provider_customer_id: '1234567890',
        p_sync_run_id: expect.any(String),
        p_rows: [
          expect.objectContaining({
            clicks: 4,
            currency_code: 'NGN',
            provider_customer_id: '1234567890',
            spend_micros: '2500000',
          }),
        ],
      })
    );
    expect(mockRpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_synced_if_current',
      {
        p_merchant_id: 'merchant-1',
        p_provider: 'google_ads',
        p_provider_customer_id: '1234567890',
        p_sync_run_id: expect.any(String),
        p_sync_window_end_date: '2026-08-21',
        p_sync_window_start_date: '2026-08-20',
      }
    );
  });

  it('rejects a sync date range beyond the bounded window before any provider read', async () => {
    await expect(
      syncGoogleAdsSpendForMerchant({
        endDate: '2026-08-21',
        credentialSupabase,
        merchantId: 'merchant-1',
        spendSupabase: supabase,
        startDate: '2026-01-01',
        supabase,
      })
    ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE' });
    expect(mockCredentialRpc).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFetchSpend).not.toHaveBeenCalled();
  });

  it('marks the connection for reauthorization when Google rejects its refresh token', async () => {
    const refreshFailure = Object.assign(
      new Error('GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED'),
      { code: 'GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED', status: 400 }
    );
    mockResolveToken.mockRejectedValueOnce(refreshFailure);

    await expect(
      syncGoogleAdsSpendForMerchant({
        endDate: '2026-08-21',
        credentialSupabase,
        merchantId: 'merchant-1',
        spendSupabase: supabase,
        startDate: '2026-08-20',
        supabase,
      })
    ).rejects.toMatchObject({ code: 'ACCESS_TOKEN_REFRESH_FAILED' });
    expect(mockCredentialRpc).toHaveBeenCalledWith(
      'mark_google_ads_connection_reauth_if_current',
      {
        p_access_token_ciphertext: 'encrypted-access',
        p_merchant_id: 'merchant-1',
        p_reason: 'GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED',
        p_refresh_token_ciphertext: 'encrypted-refresh',
      }
    );
    expect(mockFetchSpend).not.toHaveBeenCalled();
  });

  it('marks the connection for reauthorization when Google rejects an unexpired access token', async () => {
    mockFetchSpend.mockRejectedValueOnce(
      new GoogleAdsProviderError('GOOGLE_ADS_SPEND_QUERY_FAILED', 401)
    );

    await expect(
      syncGoogleAdsSpendForMerchant({
        endDate: '2026-08-21',
        credentialSupabase,
        merchantId: 'merchant-1',
        spendSupabase: supabase,
        startDate: '2026-08-20',
        supabase,
      })
    ).rejects.toMatchObject({
      code: 'GOOGLE_ADS_SPEND_QUERY_FAILED',
      status: 401,
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
    expect(mockRpc).not.toHaveBeenCalledWith(
      'replace_google_ads_spend_daily',
      expect.anything()
    );
  });

  it('compare-and-set protects a refreshed access token from a newer OAuth grant', async () => {
    mockResolveToken.mockResolvedValueOnce({
      accessToken: 'refreshed-access-token',
      encryptedAccessToken: 'new-encrypted-access',
      expiresAt: '2026-08-22T01:00:00.000Z',
    });
    mockCredentialRpc.mockImplementation((name: string) => {
      if (name === 'get_google_ads_connection_secret') {
        return Promise.resolve({
          data: [
            {
              access_token_ciphertext: 'encrypted-access',
              id: 'connection-1',
              provider_customer_id: '1234567890',
              refresh_token_ciphertext: 'encrypted-refresh',
              status: 'active',
              token_expires_at: '2026-08-22T00:00:00.000Z',
            },
          ],
          error: null,
        });
      }
      if (name === 'update_google_ads_connection_token_if_current') {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });

    await expect(
      syncGoogleAdsSpendForMerchant({
        endDate: '2026-08-21',
        credentialSupabase,
        merchantId: 'merchant-1',
        spendSupabase: supabase,
        startDate: '2026-08-20',
        supabase,
      })
    ).rejects.toMatchObject({ code: 'TOKEN_UPDATE_FAILED' });
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
    expect(mockFetchSpend).not.toHaveBeenCalled();
  });

  it('replaces the requested window when Google returns no daily rows', async () => {
    mockFetchSpend.mockResolvedValueOnce([]);

    const result = await syncGoogleAdsSpendForMerchant({
      endDate: '2026-08-21',
      credentialSupabase,
      merchantId: 'merchant-1',
      spendSupabase: supabase,
      startDate: '2026-08-20',
      supabase,
    });

    expect(result).toEqual({ customerId: '1234567890', rowsWritten: 0 });
    expect(mockRpc).toHaveBeenCalledWith('replace_google_ads_spend_daily', {
      p_end_date: '2026-08-21',
      p_merchant_id: 'merchant-1',
      p_provider_customer_id: '1234567890',
      p_rows: [],
      p_start_date: '2026-08-20',
      p_sync_run_id: expect.any(String),
    });
    expect(mockRpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_synced_if_current',
      {
        p_merchant_id: 'merchant-1',
        p_provider: 'google_ads',
        p_provider_customer_id: '1234567890',
        p_sync_run_id: expect.any(String),
        p_sync_window_end_date: '2026-08-21',
        p_sync_window_start_date: '2026-08-20',
      }
    );
  });
});
