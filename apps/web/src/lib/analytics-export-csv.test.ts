import { describe, expect, it } from 'vitest';
import type { AnalyticsData } from '@/components/analytics/analytics-grid-types';
import { buildAnalyticsCsvContent } from './analytics-export-csv';

const dateRange = {
  from: new Date('2026-08-01T00:00:00.000Z'),
  to: new Date('2026-08-07T00:00:00.000Z'),
};

const baseData: AnalyticsData = {
  summary: {
    activeNow: { change: 0, value: 0 },
    customers: { change: 0, value: 4 },
    revenue: { change: 0, value: 125 },
    sales: { change: 0, value: 3 },
  },
};

describe('buildAnalyticsCsvContent', () => {
  it('includes ad reporting metrics and provider rows for the active Ads category', () => {
    const data: AnalyticsData = {
      ...baseData,
      adAnalytics: {
        configuredPlatforms: 2,
        details: {
          ordersWithClickIds: 2,
          ordersWithLDU: 1,
          ordersWithTracking: 2,
        },
        googleAds: {
          accountName: 'Google account',
          currency: 'USD',
          metrics: { clicks: 10, spend: 12.5 },
        },
        offlineConversionsEnabled: true,
        platforms: [
          {
            clickAttributed: 2,
            configured: true,
            conversions: 3,
            name: 'Meta Ads',
            revenue: 75,
          },
        ],
        socialAds: {
          attributionNotice: 'Provider attribution is separate.',
          mixedCurrencies: false,
          providers: [
            {
              accountName: 'Meta account',
              accountTimezone: 'Africa/Lagos',
              clicksLabel: 'Clicks',
              connectionStatus: 'connected',
              conversionsLabel: 'Conversions',
              dataStatus: 'ready',
              displayName: 'Meta Ads',
              error: null,
              freshness: 'fresh',
              isStale: false,
              lastSyncedAt: null,
              metrics: {
                clicks: '12',
                conversions: '3',
                endDate: '2026-08-07',
                impressions: '100',
                reach: '80',
                spendByCurrency: [
                  { currencyCode: 'USD', spendAmountDecimal: '9.50' },
                ],
                startDate: '2026-08-01',
              },
              needsAccountSelection: false,
              provider: 'meta_ads',
            },
          ],
          spendByCurrency: [
            { currencyCode: 'USD', spendAmountDecimal: '9.50' },
          ],
        },
        summary: {
          clickAttributionRate: 66.7,
          lduRate: 33.3,
          totalAttributedRevenue: 75,
          totalConversions: 3,
          totalOrders: 3,
          trackingRate: 66.7,
        },
      },
    };

    const csv = buildAnalyticsCsvContent(data, dateRange, 'Baci', 'ads');

    expect(csv).toContain('Category: Ad Conversions');
    expect(csv).toContain('AD PERFORMANCE');
    expect(csv).toContain('AD PLATFORM PERFORMANCE');
    expect(csv).toContain('GOOGLE ADS REPORTING');
    expect(csv).toContain('SOCIAL ADS REPORTING');
    expect(csv).toContain('Meta account');
    expect(csv).toContain('USD 9.50');
  });

  it('exports lifetime segment metrics and does not label them with the date picker range', () => {
    const data: AnalyticsData = {
      ...baseData,
      segmentSummary: {
        at_risk_count: 1,
        champions_count: 2,
        segments: [
          {
            avg_clv: 42,
            count: 2,
            segment: 'Champions',
            total_revenue: 84,
          },
        ],
        total_customers: 4,
      },
    };

    const csv = buildAnalyticsCsvContent(data, dateRange, 'Baci', 'segments');

    expect(csv).toContain('Period: Lifetime');
    expect(csv).not.toContain('Period: Aug 1, 2026 - Aug 7, 2026');
    expect(csv).toContain('CUSTOMER SEGMENTS (LIFETIME)');
    expect(csv).toContain('SEGMENT BREAKDOWN');
    expect(csv).toContain('Champions');
    expect(csv).toContain('$84.00');
  });

  it('preserves the generic base export when no specialized category is active', () => {
    const csv = buildAnalyticsCsvContent(baseData, dateRange, 'Baci');

    expect(csv).toContain('Analytics Report - Baci');
    expect(csv).toContain('SUMMARY METRICS');
    expect(csv).not.toContain('Category:');
    expect(csv).not.toContain('AD PERFORMANCE');
  });
});
