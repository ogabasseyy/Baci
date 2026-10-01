import { describe, expect, it } from 'vitest';
import { buildGoogleAdsAnalyticsSnapshot } from './analytics-snapshot';

describe('buildGoogleAdsAnalyticsSnapshot', () => {
  it('omits historical spend when the connected account has no selection', () => {
    expect(
      buildGoogleAdsAnalyticsSnapshot(
        {
          last_synced_at: null,
          provider_customer_id: null,
          status: 'active',
        },
        [
          {
            clicks: 50,
            conversions: '5',
            currency_code: 'USD',
            fetched_at: '2026-08-20T10:00:00.000Z',
            impressions: 500,
            provider_customer_id: 'previous-account',
            spend_date: '2026-08-20',
            spend_micros: '999000000',
          },
        ]
      )
    ).toEqual({
      connected: true,
      connectionStatus: 'connected',
      customerId: null,
      dataStatus: 'ready',
      isStale: false,
      lastSyncedAt: null,
      needsAccountSelection: true,
    });
  });

  it('aggregates daily rows without losing micros precision in the API field', () => {
    const result = buildGoogleAdsAnalyticsSnapshot(
      {
        last_synced_at: '2026-08-21T10:00:00.000Z',
        provider_customer_id: '1234567890',
        status: 'active',
      },
      [
        {
          clicks: 99,
          conversions: '10',
          currency_code: 'USD',
          fetched_at: '2026-08-20T09:00:00.000Z',
          impressions: 999,
          provider_customer_id: 'previous-account',
          spend_date: '2026-08-19',
          spend_micros: '500000000',
        },
        {
          clicks: 1,
          conversions: '0.5',
          currency_code: 'NGN',
          fetched_at: '2026-08-21T10:00:00.000Z',
          impressions: 10,
          provider_customer_id: '1234567890',
          spend_date: '2026-08-20',
          spend_micros: '1250000',
        },
      ]
    );

    expect(result).toMatchObject({
      connectionStatus: 'connected',
      currencyCode: 'NGN',
      dataStatus: 'ready',
      needsAccountSelection: false,
      spend: 1.25,
      spendMicros: '1250000',
    });
    expect(result?.daily?.[0]).toMatchObject({
      date: '2026-08-20',
      spend: 1.25,
    });
    expect(result?.daily).toHaveLength(1);
  });

  it('does not expose cached metrics while the selected account needs reconnecting', () => {
    const result = buildGoogleAdsAnalyticsSnapshot(
      {
        last_synced_at: '2026-08-21T10:00:00.000Z',
        provider_customer_id: '1234567890',
        status: 'error',
      },
      [
        {
          clicks: 1,
          conversions: '0.5',
          currency_code: 'NGN',
          fetched_at: '2026-08-21T10:00:00.000Z',
          impressions: 10,
          provider_customer_id: '1234567890',
          spend_date: '2026-08-20',
          spend_micros: '1250000',
        },
      ]
    );

    expect(result).toEqual({
      connected: false,
      connectionStatus: 'error',
      customerId: '1234567890',
      dataStatus: 'ready',
      error: 'This connection needs to be reauthorized.',
      isStale: false,
      lastSyncedAt: '2026-08-21T10:00:00.000Z',
      needsAccountSelection: false,
    });
  });

  it('hides retained rows until the selected account completes a sync', () => {
    const result = buildGoogleAdsAnalyticsSnapshot(
      {
        last_synced_at: null,
        provider_customer_id: '1234567890',
        status: 'active',
      },
      [
        {
          clicks: 4,
          conversions: '1.5',
          currency_code: 'NGN',
          fetched_at: '2026-08-22T09:00:00.000Z',
          impressions: 40,
          provider_customer_id: '1234567890',
          spend_date: '2026-08-22',
          spend_micros: '1250000',
        },
      ],
      { now: new Date('2026-08-22T10:00:00.000Z') }
    );

    expect(result).toMatchObject({
      lastSyncedAt: null,
      needsAccountSelection: false,
    });
    expect(result?.daily).toBeUndefined();
    expect(result?.spend).toBeUndefined();
  });

  it('keeps a read failure visible instead of presenting a disconnected account', () => {
    expect(
      buildGoogleAdsAnalyticsSnapshot(null, [], {
        connectionReadFailed: true,
      })
    ).toEqual({
      connected: false,
      connectionStatus: 'error',
      customerId: null,
      dataStatus: 'error',
      error: 'Google Ads reporting is temporarily unavailable.',
      isStale: false,
      lastSyncedAt: null,
      needsAccountSelection: false,
    });
  });

  it('keeps the selected account context when the spend read fails', () => {
    expect(
      buildGoogleAdsAnalyticsSnapshot(
        {
          last_synced_at: '2026-08-20T09:00:00.000Z',
          provider_customer_id: '1234567890',
          status: 'active',
        },
        [],
        { spendReadFailed: true }
      )
    ).toMatchObject({
      connected: true,
      connectionStatus: 'connected',
      customerId: '1234567890',
      dataStatus: 'error',
      error: 'Google Ads reporting is temporarily unavailable.',
      needsAccountSelection: false,
    });
  });

  it('marks old selected-account reporting data as stale', () => {
    expect(
      buildGoogleAdsAnalyticsSnapshot(
        {
          last_synced_at: '2026-08-19T09:00:00.000Z',
          provider_customer_id: '1234567890',
          status: 'active',
        },
        [],
        { now: new Date('2026-08-22T10:00:00.000Z') }
      )
    ).toMatchObject({
      isStale: true,
      lastSyncedAt: '2026-08-19T09:00:00.000Z',
    });
  });

  it('does not mark an incomplete chunk fresh from its row timestamp', () => {
    const result = buildGoogleAdsAnalyticsSnapshot(
      {
        last_synced_at: '2026-08-19T09:00:00.000Z',
        provider_customer_id: '1234567890',
        status: 'active',
      },
      [
        {
          clicks: 1,
          conversions: 0,
          currency_code: 'NGN',
          fetched_at: '2026-08-22T09:00:00.000Z',
          impressions: 1,
          provider_customer_id: '1234567890',
          spend_date: '2026-08-22',
          spend_micros: 1,
        },
      ],
      { now: new Date('2026-08-22T10:00:00.000Z') }
    );

    expect(result?.lastSyncedAt).toBe('2026-08-19T09:00:00.000Z');
    expect(result?.isStale).toBe(true);
  });

  it('derives freshness from the selected window rows instead of the connection marker', () => {
    const result = buildGoogleAdsAnalyticsSnapshot(
      {
        last_synced_at: '2026-08-27T09:00:00.000Z',
        provider_customer_id: '1234567890',
        status: 'active',
      },
      [
        {
          clicks: 1,
          conversions: 0,
          currency_code: 'USD',
          fetched_at: '2026-08-01T09:00:00.000Z',
          impressions: 10,
          provider_customer_id: '1234567890',
          spend_date: '2026-08-21',
          spend_micros: 1,
        },
        {
          clicks: 2,
          conversions: 0,
          currency_code: 'USD',
          fetched_at: '2026-08-27T09:00:00.000Z',
          impressions: 20,
          provider_customer_id: '1234567890',
          spend_date: '2026-08-22',
          spend_micros: 2,
        },
        {
          clicks: 99,
          conversions: 0,
          currency_code: 'USD',
          fetched_at: '2026-08-27T09:00:00.000Z',
          impressions: 999,
          provider_customer_id: '1234567890',
          spend_date: '2026-08-23',
          spend_micros: 999,
        },
      ],
      {
        endDate: '2026-08-22',
        now: new Date('2026-08-27T10:00:00.000Z'),
        startDate: '2026-08-21',
      }
    );

    expect(result).toMatchObject({
      isStale: true,
      lastSyncedAt: '2026-08-01T09:00:00.000Z',
      spendMicros: '3',
    });
    expect(result?.daily).toHaveLength(2);
  });

  it('does not mark an empty requested window fresh from the connection marker', () => {
    const result = buildGoogleAdsAnalyticsSnapshot(
      {
        last_synced_at: '2026-08-27T09:00:00.000Z',
        provider_customer_id: '1234567890',
        status: 'active',
      },
      [],
      {
        endDate: '2026-08-22',
        now: new Date('2026-08-27T10:00:00.000Z'),
        startDate: '2026-08-21',
      }
    );

    expect(result).toMatchObject({
      isStale: false,
      lastSyncedAt: null,
    });
  });

  it('reports an empty requested window fresh after its exact range completes', () => {
    const result = buildGoogleAdsAnalyticsSnapshot(
      {
        last_synced_at: '2026-08-22T09:00:00.000Z',
        last_synced_end_date: '2026-08-22',
        last_synced_start_date: '2026-08-01',
        provider_customer_id: '1234567890',
        status: 'active',
      },
      [],
      {
        endDate: '2026-08-22',
        now: new Date('2026-08-22T10:00:00.000Z'),
        startDate: '2026-08-01',
      }
    );

    expect(result).toMatchObject({
      connected: true,
      isStale: false,
      lastSyncedAt: '2026-08-22T09:00:00.000Z',
    });
    expect(result?.daily).toBeUndefined();
  });

  it('does not reuse an empty-window marker for another requested range', () => {
    const result = buildGoogleAdsAnalyticsSnapshot(
      {
        last_synced_at: '2026-08-22T09:00:00.000Z',
        last_synced_end_date: '2026-08-22',
        last_synced_start_date: '2026-08-01',
        provider_customer_id: '1234567890',
        status: 'active',
      },
      [],
      {
        endDate: '2026-08-23',
        now: new Date('2026-08-22T10:00:00.000Z'),
        startDate: '2026-08-01',
      }
    );

    expect(result).toMatchObject({
      isStale: false,
      lastSyncedAt: null,
    });
  });

  it('hides retained overlap rows when the completed marker does not cover the requested range', () => {
    const result = buildGoogleAdsAnalyticsSnapshot(
      {
        last_synced_at: '2026-08-10T09:00:00.000Z',
        last_synced_end_date: '2026-08-10',
        last_synced_start_date: '2026-08-01',
        provider_customer_id: '1234567890',
        status: 'active',
      },
      [
        {
          clicks: 1,
          conversions: 1,
          currency_code: 'USD',
          fetched_at: '2026-08-10T09:00:00.000Z',
          impressions: 10,
          provider_customer_id: '1234567890',
          spend_date: '2026-08-05',
          spend_micros: '1000000',
        },
      ],
      {
        endDate: '2026-08-20',
        now: new Date('2026-08-10T10:00:00.000Z'),
        startDate: '2026-08-01',
      }
    );

    expect(result).toMatchObject({
      isStale: false,
      lastSyncedAt: null,
    });
    expect(result?.daily).toBeUndefined();
    expect(result?.spend).toBeUndefined();
    expect(result?.spendMicros).toBeUndefined();
  });
});
