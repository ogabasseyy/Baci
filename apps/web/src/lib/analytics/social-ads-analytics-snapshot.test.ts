import { describe, expect, it } from 'vitest';
import { buildSocialAdsAnalyticsSnapshot } from './social-ads-analytics-snapshot';

describe('buildSocialAdsAnalyticsSnapshot', () => {
  it('keeps exact provider metrics and mixed currencies separate', () => {
    const snapshot = buildSocialAdsAnalyticsSnapshot({
      connections: [
        {
          account_timezone: 'Africa/Lagos',
          last_synced_at: '2026-08-22T09:00:00.000Z',
          provider: 'meta_ads',
          provider_account_label: 'Baci Meta',
          provider_customer_id: 'act_1',
          status: 'active',
          token_expires_at: '2099-01-01T00:00:00.000Z',
        },
        {
          account_timezone: 'UTC',
          last_synced_at: '2026-08-22T08:00:00.000Z',
          provider: 'tiktok_ads',
          provider_account_label: 'Baci TikTok',
          provider_customer_id: 'advertiser-1',
          status: 'active',
        },
      ],
      endDate: '2026-08-22',
      now: new Date('2026-08-22T10:00:00.000Z'),
      spendRows: [
        {
          account_timezone: 'Africa/Lagos',
          clicks: '3',
          conversions: '1.25',
          currency_code: 'NGN',
          fetched_at: '2026-08-22T09:00:00.000Z',
          impressions: '100',
          provider: 'meta_ads',
          provider_customer_id: 'act_1',
          reach: '80',
          spend_amount_decimal: '9007199254740993.123456789',
          spend_date: '2026-08-22',
        },
        {
          account_timezone: 'Africa/Lagos',
          clicks: '2',
          conversions: '0.75',
          currency_code: 'NGN',
          fetched_at: '2026-08-22T09:00:00.000Z',
          impressions: '50',
          provider: 'meta_ads',
          provider_customer_id: 'act_1',
          reach: '20',
          spend_amount_decimal: '0.876543211',
          spend_date: '2026-08-22',
        },
        {
          account_timezone: 'America/New_York',
          clicks: '99',
          conversions: '20',
          currency_code: 'USD',
          fetched_at: '2026-08-21T09:00:00.000Z',
          impressions: '999',
          provider: 'meta_ads',
          provider_customer_id: 'act_old',
          reach: '900',
          spend_amount_decimal: '500',
          spend_date: '2026-08-21',
        },
        {
          account_timezone: 'UTC',
          clicks: '4',
          conversions: '2',
          currency_code: 'USD',
          fetched_at: '2026-08-22T08:00:00.000Z',
          impressions: '200',
          provider: 'tiktok_ads',
          provider_customer_id: 'advertiser-1',
          reach: '150',
          spend_amount_decimal: '10.50',
          spend_date: '2026-08-22',
        },
      ],
      startDate: '2026-08-01',
    });

    expect(snapshot.mixedCurrencies).toBe(true);
    expect(snapshot.spendByCurrency).toEqual([
      { currencyCode: 'NGN', spendAmountDecimal: '9007199254740994' },
      { currencyCode: 'USD', spendAmountDecimal: '10.5' },
    ]);
    expect(snapshot.providers[0]).toMatchObject({
      connectionStatus: 'connected',
      freshness: 'fresh',
      metrics: {
        clicks: '5',
        conversions: '2',
        impressions: '150',
        reach: null,
        spendByCurrency: [
          { currencyCode: 'NGN', spendAmountDecimal: '9007199254740994' },
        ],
      },
      provider: 'meta_ads',
    });
    expect(snapshot.attributionNotice).toContain('separate from Baci');
  });

  it('keeps one-day reach while avoiding a misleading multi-day sum', () => {
    const snapshot = buildSocialAdsAnalyticsSnapshot({
      connections: [
        {
          account_timezone: 'UTC',
          last_synced_at: '2026-08-22T09:00:00.000Z',
          provider: 'meta_ads',
          provider_account_label: 'Baci Meta',
          provider_customer_id: 'act_1',
          status: 'active',
          token_expires_at: '2099-01-01T00:00:00.000Z',
        },
      ],
      endDate: '2026-08-22',
      spendRows: [
        {
          account_timezone: 'UTC',
          clicks: '1',
          conversions: '1',
          currency_code: 'NGN',
          fetched_at: '2026-08-22T09:00:00.000Z',
          impressions: '10',
          provider: 'meta_ads',
          provider_customer_id: 'act_1',
          reach: '8',
          spend_amount_decimal: '1',
          spend_date: '2026-08-22',
        },
      ],
      startDate: '2026-08-22',
    });

    expect(snapshot.providers[0]?.metrics?.reach).toBe('8');
  });

  it('treats an expired active token as a reauthorization-required connection', () => {
    const snapshot = buildSocialAdsAnalyticsSnapshot({
      connections: [
        {
          account_timezone: 'UTC',
          last_synced_at: '2026-08-22T09:00:00.000Z',
          provider: 'meta_ads',
          provider_account_label: 'Baci Meta',
          provider_customer_id: 'act_1',
          status: 'active',
          token_expires_at: '2026-08-22T09:00:00.000Z',
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
          fetched_at: '2026-08-22T09:30:00.000Z',
          impressions: '100',
          provider: 'meta_ads',
          provider_customer_id: 'act_1',
          reach: '80',
          spend_amount_decimal: '100',
          spend_date: '2026-08-22',
        },
      ],
      startDate: '2026-08-22',
    });

    expect(snapshot.providers[0]).toMatchObject({
      connectionStatus: 'error',
      error: 'This connection needs to be reauthorized.',
      freshness: 'not_applicable',
      metrics: null,
      needsAccountSelection: false,
      provider: 'meta_ads',
    });
  });

  it('treats a Meta connection without expiry metadata as reauthorization-required', () => {
    const snapshot = buildSocialAdsAnalyticsSnapshot({
      connections: [
        {
          account_timezone: 'UTC',
          last_synced_at: '2026-08-22T09:00:00.000Z',
          provider: 'meta_ads',
          provider_account_label: 'Baci Meta',
          provider_customer_id: 'act_1',
          status: 'active',
          token_expires_at: null,
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
          fetched_at: '2026-08-22T09:30:00.000Z',
          impressions: '100',
          provider: 'meta_ads',
          provider_customer_id: 'act_1',
          reach: '80',
          spend_amount_decimal: '100',
          spend_date: '2026-08-22',
        },
      ],
      startDate: '2026-08-22',
    });

    expect(snapshot.providers[0]).toMatchObject({
      connectionStatus: 'error',
      error: 'This connection needs to be reauthorized.',
      metrics: null,
      provider: 'meta_ads',
    });
  });

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
          token_expires_at: '2099-01-01T00:00:00.000Z',
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
          token_expires_at: '2099-01-01T00:00:00.000Z',
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

  it('derives freshness from the selected window rows instead of the connection marker', () => {
    const snapshot = buildSocialAdsAnalyticsSnapshot({
      connections: [
        {
          account_timezone: 'UTC',
          last_synced_at: '2026-08-27T09:00:00.000Z',
          provider: 'meta_ads',
          provider_account_label: 'Baci Meta',
          provider_customer_id: 'act_1',
          status: 'active',
          token_expires_at: '2099-01-01T00:00:00.000Z',
        },
      ],
      endDate: '2026-08-22',
      now: new Date('2026-08-27T10:00:00.000Z'),
      spendRows: [
        {
          account_timezone: 'UTC',
          clicks: '10',
          conversions: '1',
          currency_code: 'NGN',
          fetched_at: '2026-08-01T09:00:00.000Z',
          impressions: '100',
          provider: 'meta_ads',
          provider_customer_id: 'act_1',
          reach: '80',
          spend_amount_decimal: '100',
          spend_date: '2026-08-21',
        },
        {
          account_timezone: 'UTC',
          clicks: '20',
          conversions: '2',
          currency_code: 'NGN',
          fetched_at: '2026-08-27T09:00:00.000Z',
          impressions: '200',
          provider: 'meta_ads',
          provider_customer_id: 'act_1',
          reach: '160',
          spend_amount_decimal: '200',
          spend_date: '2026-08-22',
        },
        {
          account_timezone: 'UTC',
          clicks: '99',
          conversions: '9',
          currency_code: 'NGN',
          fetched_at: '2026-08-27T09:00:00.000Z',
          impressions: '999',
          provider: 'meta_ads',
          provider_customer_id: 'act_1',
          reach: '900',
          spend_amount_decimal: '900',
          spend_date: '2026-08-23',
        },
      ],
      startDate: '2026-08-21',
    });

    const meta = snapshot.providers.find(
      (provider) => provider.provider === 'meta_ads'
    );
    expect(meta).toMatchObject({
      freshness: 'stale',
      isStale: true,
      lastSyncedAt: '2026-08-01T09:00:00.000Z',
      metrics: {
        clicks: '30',
        spendByCurrency: [{ currencyCode: 'NGN', spendAmountDecimal: '300' }],
      },
    });
  });
});
