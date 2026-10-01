import { describe, expect, it } from 'vitest';
import { mapGoogleAdsReporting } from './google-ads-analytics-mapper';

describe('mapGoogleAdsReporting', () => {
  it('maps daily provider snapshots without exposing customer identifiers', () => {
    const result = mapGoogleAdsReporting({
      connected: true,
      currencyCode: 'NGN',
      customerId: '1234567890',
      daily: [
        {
          clicks: 12,
          conversions: 2,
          date: '2026-08-20',
          impressions: 1200,
          spend: 500,
        },
      ],
    });

    expect(result).toMatchObject({
      connectionStatus: 'connected',
      currency: 'NGN',
      metrics: {
        clicks: 12,
        conversions: 2,
        cpc: 41.666666666666664,
        ctr: 1,
        endDate: '2026-08-20',
        impressions: 1200,
        spend: 500,
        startDate: '2026-08-20',
      },
    });
    expect(result).not.toHaveProperty('customerId');
  });

  it('keeps missing values undefined instead of inventing zero metrics', () => {
    expect(
      mapGoogleAdsReporting({ connected: true, customerId: null })
    ).toMatchObject({
      connectionStatus: 'connected',
      needsAccountSelection: true,
    });
    expect(
      mapGoogleAdsReporting({ connected: true, customerId: null })?.metrics
    ).toBeUndefined();
  });

  it('does not treat reporting window dates as activity metrics', () => {
    const result = mapGoogleAdsReporting({
      endDate: '2026-08-20',
      startDate: '2026-08-01',
    });

    expect(result?.metrics).toBeUndefined();
    expect(result?.connectionStatus).toBeUndefined();
  });

  it('preserves explicit reporting failures instead of rendering them as disconnected', () => {
    expect(
      mapGoogleAdsReporting({
        connected: false,
        dataStatus: 'error',
        error: 'Reporting data is temporarily unavailable.',
      })
    ).toMatchObject({
      connectionStatus: 'error',
      dataStatus: 'error',
      error: 'Reporting data is temporarily unavailable.',
    });
  });
});
