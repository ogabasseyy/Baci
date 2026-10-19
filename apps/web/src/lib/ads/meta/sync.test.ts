import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.fn();
const mockResolve = vi.fn();
const mockAccounts = vi.fn();
const mockInsights = vi.fn();

vi.mock('./config', () => ({
  getMetaAdsConfig: (...args: unknown[]) => mockConfig(...args),
}));
vi.mock('./access-token', () => ({
  resolveMetaAdsAccessToken: (...args: unknown[]) => mockResolve(...args),
}));
vi.mock('./provider', () => ({
  fetchMetaAdsDailyInsights: (...args: unknown[]) => mockInsights(...args),
  listMetaAdsAccounts: (...args: unknown[]) => mockAccounts(...args),
  MetaAdsProviderError: class MetaAdsProviderError extends Error {},
}));

import { createMetaAdsSyncTestCall } from './sync.test-support';

describe('Meta Ads sync', () => {
  const rpc = vi.fn();
  const sync = createMetaAdsSyncTestCall(rpc);

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.mockReturnValue({});
    mockResolve.mockReturnValue('access');
    mockAccounts.mockResolvedValue([
      {
        accountId: 'act_12',
        currencyCode: 'NGN',
        label: 'Account',
        timezoneName: 'Africa/Lagos',
        timezoneOffsetHours: '1',
      },
    ]);
    mockInsights.mockResolvedValue([
      {
        accountId: 'act_12',
        actions: [{ actionType: 'purchase', value: '1' }],
        actionValues: [{ actionType: 'purchase', value: '999.99' }],
        attributionSetting: '7d_click',
        clicks: '2',
        dateStart: '2026-08-20',
        dateStop: '2026-08-20',
        impressions: '10',
        reach: '9',
        spendAmountDecimal: '10.000000001',
      },
    ]);
    rpc.mockImplementation((name: string) => {
      if (name === 'get_merchant_ads_connection_secret')
        return Promise.resolve({
          data: [
            {
              access_token_ciphertext: 'cipher',
              provider_customer_id: 'act_12',
              refresh_token_ciphertext: 'refresh-cipher',
              status: 'active',
              token_expires_at: '2026-10-20T00:00:00Z',
            },
          ],
          error: null,
        });
      if (name === 'replace_merchant_ads_spend_daily_window')
        return Promise.resolve({ data: 1, error: null });
      return Promise.resolve({ data: true, error: null });
    });
  });

  it('requires a selected discovered account and writes exact Meta decimals plus labelled actions', async () => {
    await expect(sync()).resolves.toEqual({
      accountId: 'act_12',
      rowsWritten: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      'replace_merchant_ads_spend_daily_window',
      expect.objectContaining({
        p_sync_run_id: expect.any(String),
        p_rows: [
          expect.objectContaining({
            spend_amount_decimal: '10.000000001',
            spend_micros: '0',
            attribution_metadata: expect.objectContaining({
              actions: [{ actionType: 'purchase', value: '1' }],
            }),
          }),
        ],
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_synced_if_current',
      {
        p_merchant_id: 'merchant',
        p_provider: 'meta_ads',
        p_provider_customer_id: 'act_12',
        p_sync_run_id: expect.any(String),
        p_sync_window_end_date: '2026-08-20',
        p_sync_window_start_date: '2026-08-20',
      }
    );
  });

  it('replaces the Meta window even when the provider returns no activity', async () => {
    mockInsights.mockResolvedValueOnce([]);
    rpc.mockResolvedValueOnce({
      data: [
        {
          access_token_ciphertext: 'cipher',
          provider_customer_id: 'act_12',
          refresh_token_ciphertext: 'refresh-cipher',
          status: 'active',
          token_expires_at: '2026-10-20T00:00:00Z',
        },
      ],
      error: null,
    });
    rpc.mockResolvedValueOnce({ data: true, error: null });
    rpc.mockResolvedValueOnce({ data: 0, error: null });

    await expect(sync()).resolves.toEqual({
      accountId: 'act_12',
      rowsWritten: 0,
    });

    expect(rpc).toHaveBeenCalledWith(
      'replace_merchant_ads_spend_daily_window',
      expect.objectContaining({
        p_end_date: '2026-08-20',
        p_provider: 'meta_ads',
        p_provider_customer_id: 'act_12',
        p_rows: [],
        p_start_date: '2026-08-20',
      })
    );
  });

  it('does not replace a window when the sync-start freshness marker cannot be cleared', async () => {
    rpc.mockImplementation((name: string) => {
      if (name === 'get_merchant_ads_connection_secret')
        return Promise.resolve({
          data: [
            {
              access_token_ciphertext: 'cipher',
              provider_customer_id: 'act_12',
              refresh_token_ciphertext: 'refresh-cipher',
              status: 'active',
              token_expires_at: '2026-10-20T00:00:00Z',
            },
          ],
          error: null,
        });
      if (name === 'mark_merchant_ads_connection_sync_started_if_current')
        return Promise.resolve({ data: false, error: null });
      return Promise.resolve({ data: true, error: null });
    });

    await expect(sync()).rejects.toMatchObject({
      code: 'SYNC_STATUS_UPDATE_FAILED',
    });
    expect(rpc).not.toHaveBeenCalledWith(
      'replace_merchant_ads_spend_daily_window',
      expect.anything()
    );
  });

  it('adds large and fractional selected action values without Number precision loss', async () => {
    mockInsights.mockResolvedValueOnce([
      {
        accountId: 'act_12',
        actions: [
          { actionType: 'purchase', value: '9007199254740993.5' },
          { actionType: 'purchase', value: '0.25' },
        ],
        actionValues: [],
        attributionSetting: null,
        clicks: '0',
        dateStart: '2026-08-20',
        dateStop: '2026-08-20',
        impressions: '0',
        reach: null,
        spendAmountDecimal: '0',
      },
    ]);
    await sync();
    expect(rpc).toHaveBeenCalledWith(
      'replace_merchant_ads_spend_daily_window',
      expect.objectContaining({
        p_rows: [
          expect.objectContaining({ conversions: '9007199254740993.75' }),
        ],
      })
    );
  });

  it('persists an error state when the encrypted token is expired', async () => {
    mockResolve.mockImplementationOnce(() => {
      throw new Error('META_ADS_REAUTH_REQUIRED');
    });
    await expect(sync()).rejects.toMatchObject({
      code: 'META_ADS_REAUTH_REQUIRED',
    });
    expect(rpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_reauth_if_current',
      expect.objectContaining({
        p_access_token_ciphertext: 'cipher',
        p_provider: 'meta_ads',
        p_refresh_token_ciphertext: 'refresh-cipher',
        p_reason: 'META_ADS_REAUTH_REQUIRED',
      })
    );
  });

  it('marks a selected legacy connection with no access ciphertext for reauthorization', async () => {
    mockResolve.mockImplementationOnce(() => {
      throw new Error('META_ADS_REAUTH_REQUIRED');
    });
    rpc.mockImplementation((name: string) => {
      if (name === 'get_merchant_ads_connection_secret')
        return Promise.resolve({
          data: [
            {
              access_token_ciphertext: null,
              provider_customer_id: 'act_12',
              refresh_token_ciphertext: null,
              status: 'active',
              token_expires_at: null,
            },
          ],
          error: null,
        });
      return Promise.resolve({ data: true, error: null });
    });

    await expect(sync()).rejects.toMatchObject({
      code: 'META_ADS_REAUTH_REQUIRED',
    });
    expect(rpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_reauth_if_current',
      expect.objectContaining({
        p_access_token_ciphertext: null,
        p_provider: 'meta_ads',
        p_refresh_token_ciphertext: null,
        p_reason: 'META_ADS_REAUTH_REQUIRED',
      })
    );
  });

  it('marks an undecryptable access token for reauthorization', async () => {
    mockResolve.mockImplementationOnce(() => {
      throw new Error('META_ADS_ACCESS_TOKEN_DECRYPT_FAILED');
    });

    await expect(sync()).rejects.toMatchObject({
      code: 'META_ADS_ACCESS_TOKEN_DECRYPT_FAILED',
    });
    expect(rpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_reauth_if_current',
      expect.objectContaining({
        p_reason: 'META_ADS_ACCESS_TOKEN_DECRYPT_FAILED',
      })
    );
  });

  it('treats a stale CAS marker as a superseded connection', async () => {
    mockResolve.mockImplementationOnce(() => {
      throw new Error('META_ADS_REAUTH_REQUIRED');
    });
    rpc.mockImplementation((name: string) => {
      if (name === 'get_merchant_ads_connection_secret')
        return Promise.resolve({
          data: [
            {
              access_token_ciphertext: 'cipher',
              provider_customer_id: 'act_12',
              refresh_token_ciphertext: 'refresh-cipher',
              status: 'active',
              token_expires_at: '2026-10-20T00:00:00Z',
            },
          ],
          error: null,
        });
      if (name === 'mark_merchant_ads_connection_reauth_if_current')
        return Promise.resolve({ data: false, error: null });
      return Promise.resolve({ data: true, error: null });
    });
    await expect(sync()).rejects.toMatchObject({
      code: 'META_ADS_REAUTH_REQUIRED',
    });
    expect(rpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_reauth_if_current',
      expect.objectContaining({ p_reason: 'META_ADS_REAUTH_REQUIRED' })
    );
  });

  it('marks revoked ads_read permission with the same CAS marker', async () => {
    mockResolve.mockImplementationOnce(() => {
      throw Object.assign(new Error('permission revoked'), {
        code: 'META_ADS_ADS_READ_NOT_GRANTED',
      });
    });
    rpc.mockImplementation((name: string) => {
      if (name === 'get_merchant_ads_connection_secret')
        return Promise.resolve({
          data: [
            {
              access_token_ciphertext: 'cipher',
              provider_customer_id: 'act_12',
              refresh_token_ciphertext: 'refresh-cipher',
              status: 'active',
              token_expires_at: '2026-10-20T00:00:00Z',
            },
          ],
          error: null,
        });
      return Promise.resolve({ data: true, error: null });
    });
    await expect(sync()).rejects.toMatchObject({
      code: 'META_ADS_ADS_READ_NOT_GRANTED',
    });
    expect(rpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_reauth_if_current',
      expect.objectContaining({ p_reason: 'META_ADS_ADS_READ_NOT_GRANTED' })
    );
  });

  it('surfaces a stable error when CAS reauth persistence fails', async () => {
    mockResolve.mockImplementationOnce(() => {
      throw new Error('META_ADS_REAUTH_REQUIRED');
    });
    rpc.mockImplementation((name: string) => {
      if (name === 'get_merchant_ads_connection_secret')
        return Promise.resolve({
          data: [
            {
              access_token_ciphertext: 'cipher',
              provider_customer_id: 'act_12',
              refresh_token_ciphertext: 'refresh-cipher',
              status: 'active',
              token_expires_at: '2026-10-20T00:00:00Z',
            },
          ],
          error: null,
        });
      if (name === 'mark_merchant_ads_connection_reauth_if_current')
        return Promise.resolve({ data: null, error: { message: 'denied' } });
      return Promise.resolve({ data: true, error: null });
    });
    await expect(sync()).rejects.toMatchObject({
      code: 'META_ADS_REAUTH_PERSIST_FAILED',
    });
  });

  it('does not coalesce concurrent syncs for different date ranges', async () => {
    await Promise.all([
      sync({ endDate: '2026-08-20', startDate: '2026-08-20' }),
      sync({ endDate: '2026-08-21', startDate: '2026-08-21' }),
    ]);
    expect(mockInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: '2026-08-20',
        endDate: '2026-08-20',
      }),
      expect.anything(),
      undefined,
      expect.anything()
    );
    expect(mockInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: '2026-08-21',
        endDate: '2026-08-21',
      }),
      expect.anything(),
      undefined,
      expect.anything()
    );
  });
});
