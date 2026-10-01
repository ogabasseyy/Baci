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
  getGoogleAdsOAuthConfig: () => mockGetOAuthConfig(),
  getGoogleAdsReportingConfig: () => mockGetReportingConfig(),
}));
vi.mock('@/lib/google-ads/access-token', () => ({
  resolveGoogleAdsAccessToken: (...args: unknown[]) =>
    mockResolveToken(...args),
}));
vi.mock('@/lib/google-ads/provider', () => ({
  fetchGoogleAdsDailySpend: (...args: unknown[]) => mockFetchSpend(...args),
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

import { GoogleAdsProviderError } from './provider';
import { syncGoogleAdsSpendForMerchant } from './sync';

describe('syncGoogleAdsSpendForMerchant refreshed token reauthorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOAuthConfig.mockReturnValue({
      clientId: 'client',
      clientSecret: 'secret',
      tokenEncryptionKey: 'key',
    });
    mockGetReportingConfig.mockReturnValue({
      developerToken: 'developer-token',
    });
    mockResolveToken.mockResolvedValue({
      accessToken: 'refreshed-access-token',
      encryptedAccessToken: 'refreshed-access-ciphertext',
      expiresAt: '2026-08-22T01:00:00.000Z',
    });
    mockCredentialRpc.mockImplementation((name: string) => {
      if (name === 'get_google_ads_connection_secret') {
        return Promise.resolve({
          data: [
            {
              access_token_ciphertext: 'expired-access-ciphertext',
              provider_customer_id: '1234567890',
              refresh_token_ciphertext: 'refresh-ciphertext',
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
    mockFetchSpend.mockRejectedValue(
      new GoogleAdsProviderError('GOOGLE_ADS_SPEND_QUERY_FAILED', 401)
    );
  });

  it('marks the refreshed token rejected by Google while preserving compare-and-set safety', async () => {
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
      'update_google_ads_connection_token_if_current',
      expect.objectContaining({
        p_access_token_ciphertext: 'refreshed-access-ciphertext',
        p_expected_access_token_ciphertext: 'expired-access-ciphertext',
        p_expected_refresh_token_ciphertext: 'refresh-ciphertext',
      })
    );
    expect(mockCredentialRpc).toHaveBeenCalledWith(
      'mark_google_ads_connection_reauth_if_current',
      {
        p_access_token_ciphertext: 'refreshed-access-ciphertext',
        p_merchant_id: 'merchant-1',
        p_reason: 'GOOGLE_ADS_ACCESS_REVOKED',
        p_refresh_token_ciphertext: 'refresh-ciphertext',
      }
    );
    expect(mockCredentialRpc).not.toHaveBeenCalledWith(
      'mark_google_ads_connection_reauth_if_current',
      expect.objectContaining({
        p_access_token_ciphertext: 'expired-access-ciphertext',
      })
    );
  });
});
