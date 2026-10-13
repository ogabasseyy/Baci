import { describe, expect, it } from 'vitest';
import { buildSocialAdsAnalyticsSnapshot } from './social-ads-analytics-snapshot';

describe('buildSocialAdsAnalyticsSnapshot account state', () => {
  it('binds metrics only to each active selected account after switches and reconnects', () => {
    const snapshot = buildSocialAdsAnalyticsSnapshot({
      connections: [
        {
          account_timezone: 'UTC',
          last_synced_at: null,
          provider: 'meta_ads',
          provider_account_label: null,
          provider_customer_id: null,
          status: 'active',
          token_expires_at: '2026-09-01T00:00:00.000Z',
        },
        {
          account_timezone: 'UTC',
          last_synced_at: '2026-08-22T08:00:00.000Z',
          provider: 'tiktok_ads',
          provider_account_label: 'Needs reconnect',
          provider_customer_id: 'advertiser-1',
          status: 'error',
        },
        {
          account_timezone: 'UTC',
          last_synced_at: '2026-08-22T09:00:00.000Z',
          provider: 'snapchat_ads',
          provider_account_label: 'Current Snap',
          provider_customer_id: 'snap-new',
          status: 'active',
        },
      ],
      endDate: '2026-08-22',
      now: new Date('2026-08-22T10:00:00.000Z'),
      spendRows: [
        {
          account_timezone: 'UTC',
          clicks: '10',
          conversions: '1',
          currency_code: 'NGN',
          fetched_at: '2026-08-20T09:00:00.000Z',
          impressions: '100',
          provider: 'meta_ads',
          provider_customer_id: 'act-old',
          reach: '80',
          spend_amount_decimal: '100',
          spend_date: '2026-08-20',
        },
        {
          account_timezone: 'UTC',
          clicks: '20',
          conversions: '2',
          currency_code: 'USD',
          fetched_at: '2026-08-21T08:00:00.000Z',
          impressions: '200',
          provider: 'tiktok_ads',
          provider_customer_id: 'advertiser-1',
          reach: '160',
          spend_amount_decimal: '200',
          spend_date: '2026-08-21',
        },
        {
          account_timezone: 'UTC',
          clicks: '30',
          conversions: '3',
          currency_code: 'EUR',
          fetched_at: '2026-08-21T09:00:00.000Z',
          impressions: '300',
          provider: 'snapchat_ads',
          provider_customer_id: 'snap-old',
          reach: '240',
          spend_amount_decimal: '300',
          spend_date: '2026-08-21',
        },
        {
          account_timezone: 'UTC',
          clicks: '4',
          conversions: '0.5',
          currency_code: 'GBP',
          fetched_at: '2026-08-22T09:00:00.000Z',
          impressions: '40',
          provider: 'snapchat_ads',
          provider_customer_id: 'snap-new',
          reach: '32',
          spend_amount_decimal: '12.50',
          spend_date: '2026-08-22',
        },
      ],
      startDate: '2026-08-01',
    });

    expect(snapshot.providers[0]).toMatchObject({
      metrics: null,
      needsAccountSelection: true,
      provider: 'meta_ads',
    });
    expect(snapshot.providers[1]).toMatchObject({
      connectionStatus: 'error',
      metrics: null,
      provider: 'tiktok_ads',
    });
    expect(snapshot.providers[2]).toMatchObject({
      metrics: {
        clicks: '4',
        spendByCurrency: [{ currencyCode: 'GBP', spendAmountDecimal: '12.5' }],
      },
      provider: 'snapchat_ads',
    });
    expect(snapshot.spendByCurrency).toEqual([
      { currencyCode: 'GBP', spendAmountDecimal: '12.5' },
    ]);
    expect(snapshot.mixedCurrencies).toBe(false);
  });

  it('reports disconnected, account-selection, stale, and read-error states', () => {
    const snapshot = buildSocialAdsAnalyticsSnapshot({
      connections: [
        {
          account_timezone: 'UTC',
          last_synced_at: null,
          provider: 'meta_ads',
          provider_account_label: null,
          provider_customer_id: null,
          status: 'active',
          token_expires_at: '2026-09-01T00:00:00.000Z',
        },
        {
          account_timezone: 'UTC',
          last_synced_at: '2026-08-01T00:00:00.000Z',
          provider: 'tiktok_ads',
          provider_account_label: 'Old account',
          provider_customer_id: 'advertiser-1',
          status: 'active',
        },
      ],
      endDate: '2026-08-22',
      now: new Date('2026-08-22T10:00:00.000Z'),
      spendRows: [],
      startDate: '2026-08-01',
    });

    expect(snapshot.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          freshness: 'never_synced',
          needsAccountSelection: true,
          provider: 'meta_ads',
        }),
        expect.objectContaining({
          freshness: 'never_synced',
          isStale: false,
          lastSyncedAt: null,
          provider: 'tiktok_ads',
        }),
        expect.objectContaining({
          connectionStatus: 'disconnected',
          provider: 'snapchat_ads',
        }),
      ])
    );

    const failed = buildSocialAdsAnalyticsSnapshot({
      connectionReadFailed: true,
      connections: [],
      endDate: '2026-08-22',
      spendRows: [],
      startDate: '2026-08-01',
    });
    expect(
      failed.providers.every((provider) => provider.dataStatus === 'error')
    ).toBe(true);
    expect(JSON.stringify(failed)).not.toMatch(/token|secret|credential/i);
  });
});
