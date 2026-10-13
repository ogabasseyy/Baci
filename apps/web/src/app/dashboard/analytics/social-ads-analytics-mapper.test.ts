import { describe, expect, it } from 'vitest';
import { mapSocialAdsReporting } from './social-ads-analytics-mapper';

describe('mapSocialAdsReporting', () => {
  it('maps exact metrics and safe dashboard states', () => {
    expect(
      mapSocialAdsReporting({
        attributionNotice: 'Keep provider attribution separate.',
        mixedCurrencies: true,
        providers: [
          {
            accountName: 'Baci Meta',
            accountTimezone: 'Africa/Lagos',
            clicksLabel: 'Clicks',
            connectionStatus: 'connected',
            conversionsLabel: 'Meta-attributed conversions',
            dataStatus: 'ready',
            displayName: 'Meta Ads',
            freshness: 'stale',
            isStale: true,
            lastSyncedAt: '2026-08-20T00:00:00.000Z',
            metrics: {
              clicks: '15',
              conversions: '1.5',
              endDate: '2026-08-22',
              impressions: '500',
              reach: '300',
              spendByCurrency: [
                { currencyCode: 'NGN', spendAmountDecimal: '12500.50' },
              ],
              startDate: '2026-08-01',
            },
            needsAccountSelection: false,
            provider: 'meta_ads',
          },
        ],
        spendByCurrency: [
          { currencyCode: 'NGN', spendAmountDecimal: '12500.50' },
          { currencyCode: 'USD', spendAmountDecimal: '9.99' },
        ],
      })
    ).toMatchObject({
      mixedCurrencies: true,
      providers: [
        {
          connectionStatus: 'connected',
          freshness: 'stale',
          metrics: {
            conversions: '1.5',
            spendByCurrency: [
              { currencyCode: 'NGN', spendAmountDecimal: '12500.50' },
            ],
          },
          provider: 'meta_ads',
        },
      ],
    });
  });

  it('drops malformed providers, currencies, and numeric fields', () => {
    const mapped = mapSocialAdsReporting({
      providers: [
        { provider: 'unknown_ads' },
        {
          connectionStatus: 'mystery',
          metrics: {
            clicks: 'not-a-number',
            spendByCurrency: [
              { currencyCode: 'TOKEN', spendAmountDecimal: 'secret' },
            ],
          },
          provider: 'snapchat_ads',
        },
      ],
    });

    expect(mapped?.providers).toHaveLength(1);
    expect(mapped?.providers[0]).toMatchObject({
      connectionStatus: 'disconnected',
      metrics: { clicks: '0', spendByCurrency: [] },
      provider: 'snapchat_ads',
    });
  });
});
