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
          token_expires_at: '2026-09-01T00:00:00.000Z',
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
          token_expires_at: '2026-09-01T00:00:00.000Z',
        },
      ],
      endDate: '2026-08-22',
      now: new Date('2026-08-22T10:00:00.000Z'),
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
});
