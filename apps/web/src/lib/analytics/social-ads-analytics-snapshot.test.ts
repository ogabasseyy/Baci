import { describe, expect, it } from 'vitest';
import { buildSocialAdsAnalyticsSnapshot } from './social-ads-analytics-snapshot';

describe('buildSocialAdsAnalyticsSnapshot', () => {
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
          token_expires_at: '2099-09-01T00:00:00.000Z',
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
