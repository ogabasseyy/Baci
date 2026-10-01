import { describe, expect, it } from 'vitest';
import { buildMetaAdsSpendRecords } from './spend-records';

describe('buildMetaAdsSpendRecords', () => {
  it('maps provider insights into exact spend rows with attribution metadata', () => {
    const rows = buildMetaAdsSpendRecords({
      account: {
        accountId: 'act_12',
        currencyCode: 'NGN',
        label: 'Account',
        timezoneName: 'Africa/Lagos',
        timezoneOffsetHours: '1',
      },
      fetchedAt: '2026-08-28T00:00:00.000Z',
      insights: [
        {
          accountId: 'act_12',
          actions: [
            { actionType: 'purchase', value: '9007199254740993.5' },
            { actionType: 'purchase', value: '0.25' },
          ],
          actionValues: [{ actionType: 'purchase', value: '10.50' }],
          attributionSetting: '7d_click',
          clicks: '2',
          dateStart: '2026-08-20',
          dateStop: '2026-08-20',
          impressions: '10',
          reach: '9',
          spendAmountDecimal: '10.000000001',
        },
      ],
      usageTelemetry: {
        adAccountCallCount: 1,
        businessUseCaseCallCount: 2,
        insightsThrottleResetSeconds: null,
      },
    });

    expect(rows).toEqual([
      expect.objectContaining({
        account_timezone: 'Africa/Lagos',
        clicks: '2',
        conversions: '9007199254740993.75',
        currency_code: 'NGN',
        fetched_at: '2026-08-28T00:00:00.000Z',
        impressions: '10',
        provider_customer_id: 'act_12',
        spend_amount_decimal: '10.000000001',
        spend_date: '2026-08-20',
        spend_micros: '0',
      }),
    ]);
    expect(rows[0]?.attribution_metadata).toEqual(
      expect.objectContaining({
        actionValues: [{ actionType: 'purchase', value: '10.50' }],
        actions: [
          { actionType: 'purchase', value: '9007199254740993.5' },
          { actionType: 'purchase', value: '0.25' },
        ],
        provider: 'meta_ads',
        providerVersion: 'v25.0',
        usageTelemetry: {
          adAccountCallCount: 1,
          businessUseCaseCallCount: 2,
          insightsThrottleResetSeconds: null,
        },
      })
    );
  });

  it('returns no rows when Meta has no activity', () => {
    expect(
      buildMetaAdsSpendRecords({
        account: {
          accountId: 'act_12',
          currencyCode: 'NGN',
          label: 'Account',
          timezoneName: 'Africa/Lagos',
          timezoneOffsetHours: null,
        },
        fetchedAt: '2026-08-28T00:00:00.000Z',
        insights: [],
        usageTelemetry: null,
      })
    ).toEqual([]);
  });
});
