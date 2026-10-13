import { beforeEach, describe, expect, it, vi } from 'vitest';

const usableGrant = vi.fn();
const config = vi.fn();
const accounts = vi.fn();
const reports = vi.fn();

vi.mock('./access-token', () => ({
  getSnapchatAdsUsableGrant: (...args: unknown[]) => usableGrant(...args),
  SnapchatAdsTokenRefreshError: class SnapchatAdsTokenRefreshError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));
vi.mock('./config', () => ({
  getSnapchatAdsConfig: (...args: unknown[]) => config(...args),
}));
vi.mock('./provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./provider')>()),
  fetchSnapchatAdsDailyReport: (...args: unknown[]) => reports(...args),
  listSnapchatAdsAccounts: (...args: unknown[]) => accounts(...args),
}));

import { SnapchatAdsTokenRefreshError } from './access-token';
import {
  snapchatAdsTrailingStartDate,
  syncSnapchatAdsSpendForMerchant,
} from './sync';

describe('Snapchat Ads sync', () => {
  const rpc = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    config.mockReturnValue({ tokenEncryptionKey: 'key' });
    usableGrant.mockResolvedValue({
      accessToken: 'token',
      accessTokenCiphertext: 'access',
      refreshTokenCiphertext: 'refresh',
      tokenExpiresAt: '2026-09-01T00:00:00.000Z',
    });
    accounts.mockResolvedValue([
      {
        accountId: 'ad-1',
        currencyCode: 'USD',
        label: 'Account',
        organizationId: 'org-1',
        timezoneName: 'America/New_York',
      },
    ]);
    reports.mockResolvedValue([
      {
        accountId: 'ad-1',
        clicks: '2',
        conversions: '1',
        currencyCode: 'USD',
        impressions: '10',
        spendAmountDecimal: '1.25',
        spendDate: '2026-08-20',
        spendMicros: '1250000',
        timezoneName: 'America/New_York',
      },
    ]);
    rpc.mockImplementation((name: string) => {
      if (name === 'get_merchant_ads_connection_secret')
        return Promise.resolve({
          data: [
            {
              access_token_ciphertext: 'access',
              provider_customer_id: 'ad-1',
              refresh_token_ciphertext: 'refresh',
              status: 'active',
              token_expires_at: '2026-09-01T00:00:00.000Z',
            },
          ],
          error: null,
        });
      return Promise.resolve({
        data: name === 'replace_merchant_ads_spend_daily_window' ? 1 : true,
        error: null,
      });
    });
  });
  it('rediscovers the selected account and persists exact micro-currency with Snap labels', async () => {
    await expect(
      syncSnapchatAdsSpendForMerchant({
        credentialSupabase: { rpc } as never,
        merchantId: 'merchant',
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        spendSupabase: { rpc } as never,
        supabase: { rpc } as never,
      })
    ).resolves.toEqual({ accountId: 'ad-1', rowsWritten: 1 });
    expect(rpc).toHaveBeenCalledWith(
      'replace_merchant_ads_spend_daily_window',
      expect.objectContaining({
        p_sync_run_id: expect.any(String),
        p_rows: [
          expect.objectContaining({
            attribution_metadata: expect.objectContaining({
              providerClicksLabel: 'Swipe Ups',
              providerConversionsLabel: 'Snapchat-attributed purchases',
            }),
            spend_micros: '1250000',
          }),
        ],
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_synced_if_current',
      {
        p_merchant_id: 'merchant',
        p_provider: 'snapchat_ads',
        p_provider_customer_id: 'ad-1',
        p_sync_run_id: expect.any(String),
        p_sync_window_end_date: '2026-08-20',
        p_sync_window_start_date: '2026-08-20',
      }
    );
  });

  it('replaces the Snapchat window even when the provider returns no activity', async () => {
    reports.mockResolvedValueOnce([]);
    rpc.mockResolvedValueOnce({
      data: [
        {
          access_token_ciphertext: 'access',
          provider_customer_id: 'ad-1',
          refresh_token_ciphertext: 'refresh',
          status: 'active',
          token_expires_at: '2026-09-01T00:00:00.000Z',
        },
      ],
      error: null,
    });
    rpc.mockResolvedValueOnce({ data: true, error: null });
    rpc.mockResolvedValueOnce({ data: 0, error: null });

    await expect(
      syncSnapchatAdsSpendForMerchant({
        credentialSupabase: { rpc } as never,
        merchantId: 'merchant',
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        spendSupabase: { rpc } as never,
        supabase: { rpc } as never,
      })
    ).resolves.toEqual({ accountId: 'ad-1', rowsWritten: 0 });

    expect(rpc).toHaveBeenCalledWith(
      'replace_merchant_ads_spend_daily_window',
      expect.objectContaining({
        p_end_date: '2026-08-20',
        p_provider: 'snapchat_ads',
        p_provider_customer_id: 'ad-1',
        p_rows: [],
        p_start_date: '2026-08-20',
      })
    );
  });
  it('resyncs a bounded conversion-attribution window for a current report', () => {
    expect(
      snapchatAdsTrailingStartDate(
        '2026-08-20',
        '2026-08-21',
        'Africa/Lagos',
        new Date('2026-08-21T12:00:00Z')
      )
    ).toBe('2026-07-22');
  });
  it('marks the persisted connection as reconnect-required after a revoked provider token', async () => {
    reports.mockRejectedValueOnce(
      Object.assign(new Error('revoked'), {
        code: 'SNAPCHAT_ADS_ACCESS_REVOKED',
      })
    );
    await expect(
      syncSnapchatAdsSpendForMerchant({
        credentialSupabase: { rpc } as never,
        merchantId: 'merchant',
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        spendSupabase: { rpc } as never,
        supabase: { rpc } as never,
      })
    ).rejects.toMatchObject({ code: 'SNAPCHAT_ADS_ACCESS_REVOKED' });
    expect(rpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_reauth_if_current',
      expect.objectContaining({
        p_reason: 'SNAPCHAT_ADS_ACCESS_REVOKED',
        p_access_token_ciphertext: 'access',
        p_refresh_token_ciphertext: 'refresh',
      })
    );
  });

  it('marks a missing access token as reconnect-required when refresh is rejected', async () => {
    usableGrant.mockRejectedValueOnce(
      new SnapchatAdsTokenRefreshError('SNAPCHAT_ADS_REFRESH_REJECTED')
    );
    rpc.mockImplementation((name: string) => {
      if (name === 'get_merchant_ads_connection_secret')
        return Promise.resolve({
          data: [
            {
              access_token_ciphertext: null,
              provider_customer_id: 'ad-1',
              refresh_token_ciphertext: 'refresh',
              status: 'active',
              token_expires_at: null,
            },
          ],
          error: null,
        });
      return Promise.resolve({ data: true, error: null });
    });

    await expect(
      syncSnapchatAdsSpendForMerchant({
        credentialSupabase: { rpc } as never,
        merchantId: 'merchant',
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        spendSupabase: { rpc } as never,
        supabase: { rpc } as never,
      })
    ).rejects.toMatchObject({ code: 'SNAPCHAT_ADS_REFRESH_REJECTED' });
    expect(rpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_reauth_if_current',
      expect.objectContaining({
        p_access_token_ciphertext: null,
        p_refresh_token_ciphertext: 'refresh',
        p_reason: 'SNAPCHAT_ADS_REFRESH_REJECTED',
      })
    );
    expect(accounts).not.toHaveBeenCalled();
  });

  it('marks an undecryptable refresh token as reconnect-required', async () => {
    usableGrant.mockRejectedValueOnce(
      new SnapchatAdsTokenRefreshError(
        'SNAPCHAT_ADS_REFRESH_TOKEN_DECRYPT_FAILED'
      )
    );

    await expect(
      syncSnapchatAdsSpendForMerchant({
        credentialSupabase: { rpc } as never,
        merchantId: 'merchant',
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        spendSupabase: { rpc } as never,
        supabase: { rpc } as never,
      })
    ).rejects.toMatchObject({
      code: 'SNAPCHAT_ADS_REFRESH_TOKEN_DECRYPT_FAILED',
    });
    expect(rpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_reauth_if_current',
      expect.objectContaining({
        p_reason: 'SNAPCHAT_ADS_REFRESH_TOKEN_DECRYPT_FAILED',
      })
    );
    expect(accounts).not.toHaveBeenCalled();
  });

  it('uses refreshed ciphertext when a provider rejects the refreshed token', async () => {
    usableGrant.mockResolvedValueOnce({
      accessToken: 'refreshed-token',
      accessTokenCiphertext: 'new-access',
      refreshTokenCiphertext: 'new-refresh',
      tokenExpiresAt: '2026-09-01T01:00:00.000Z',
    });
    reports.mockRejectedValueOnce(
      Object.assign(new Error('revoked'), {
        code: 'SNAPCHAT_ADS_ACCESS_REVOKED',
      })
    );

    await expect(
      syncSnapchatAdsSpendForMerchant({
        credentialSupabase: { rpc } as never,
        merchantId: 'merchant',
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        spendSupabase: { rpc } as never,
        supabase: { rpc } as never,
      })
    ).rejects.toMatchObject({ code: 'SNAPCHAT_ADS_ACCESS_REVOKED' });
    expect(rpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_reauth_if_current',
      expect.objectContaining({
        p_access_token_ciphertext: 'new-access',
        p_refresh_token_ciphertext: 'new-refresh',
      })
    );
  });
});
