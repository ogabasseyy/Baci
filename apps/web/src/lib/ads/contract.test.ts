import { describe, expect, it } from 'vitest';
import { ADS_PROVIDERS, isAdsProvider, normalizeAdsSpendRow } from './contract';

describe('ads contract', () => {
  it('only accepts the provider keys supported by shared storage', () => {
    expect(ADS_PROVIDERS).toEqual([
      'google_ads',
      'meta_ads',
      'tiktok_ads',
      'snapchat_ads',
    ]);
    expect(isAdsProvider('meta_ads')).toBe(true);
    expect(isAdsProvider('facebook_ads')).toBe(false);
  });

  it('preserves exact decimal spend without converting through a float', () => {
    expect(
      normalizeAdsSpendRow({
        accountTimezone: 'America/Los_Angeles',
        attributionMetadata: { source: 'provider' },
        clicks: '2',
        conversions: '1.125',
        currencyCode: 'usd',
        fetchedAt: '2026-08-21T10:00:00.000Z',
        impressions: '7',
        provider: 'meta_ads',
        providerCustomerId: 'act_123',
        reach: '5',
        spendAmountDecimal: '123456789.123456789',
        spendDate: '2026-08-20',
        spendMicros: '123456789123456',
      })
    ).toMatchObject({
      currencyCode: 'USD',
      spendAmountDecimal: '123456789.123456789',
      spendMicros: '123456789123456',
    });
  });

  it('rejects unsafe normalized rows before they reach an RPC', () => {
    expect(() =>
      normalizeAdsSpendRow({
        accountTimezone: 'UTC',
        attributionMetadata: {},
        clicks: '0',
        conversions: '0',
        currencyCode: 'USD',
        fetchedAt: 'not-a-date',
        impressions: '0',
        provider: 'meta_ads',
        providerCustomerId: 'act_123',
        spendAmountDecimal: '1.001',
        spendDate: '2026-08-20',
        spendMicros: '1001000',
      })
    ).toThrow('fetchedAt');
  });

  it('requires a timestamp rather than accepting a calendar date as freshness', () => {
    expect(() =>
      normalizeAdsSpendRow({
        accountTimezone: 'UTC',
        attributionMetadata: {},
        clicks: '0',
        conversions: '0',
        currencyCode: 'USD',
        fetchedAt: '2026-08-20',
        impressions: '0',
        provider: 'meta_ads',
        providerCustomerId: 'act_123',
        spendAmountDecimal: '1.001',
        spendDate: '2026-08-20',
        spendMicros: '1001000',
      })
    ).toThrow('fetchedAt');
  });
});
