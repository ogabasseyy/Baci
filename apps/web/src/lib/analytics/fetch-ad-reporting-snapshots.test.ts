import { describe, expect, it, vi } from 'vitest';
import { fetchAdReportingSnapshots } from './fetch-ad-reporting-snapshots';
import { chainResult } from './fetch-ad-reporting-snapshots.test-support';

describe('fetchAdReportingSnapshots', () => {
  it('reads only credential-free Google and social projections', async () => {
    const results = [
      {
        data: {
          last_synced_at: '2026-08-22T09:00:00.000Z',
          provider_customer_id: 'google-1',
          status: 'active',
        },
        error: null,
      },
      {
        data: [
          {
            clicks: '2',
            conversions: '1',
            currency_code: 'NGN',
            fetched_at: '2026-08-22T09:00:00.000Z',
            impressions: '20',
            provider_customer_id: 'google-1',
            spend_date: '2026-08-22',
            spend_micros: '2500000',
          },
          {
            clicks: '50',
            conversions: '5',
            currency_code: 'USD',
            fetched_at: '2026-08-21T09:00:00.000Z',
            impressions: '500',
            provider_customer_id: 'google-old',
            spend_date: '2026-08-21',
            spend_micros: '500000000',
          },
        ],
        error: null,
      },
      {
        data: [
          {
            account_timezone: 'UTC',
            last_synced_at: '2026-08-22T09:00:00.000Z',
            provider: 'snapchat_ads',
            provider_account_label: 'Baci Snap',
            provider_customer_id: 'snap-1',
            status: 'active',
          },
        ],
        error: null,
      },
      {
        data: [
          {
            account_timezone: 'UTC',
            clicks: '3',
            conversions: '0.5',
            currency_code: 'GBP',
            fetched_at: '2026-08-22T09:00:00.000Z',
            impressions: '30',
            provider: 'snapchat_ads',
            provider_customer_id: 'snap-1',
            reach: '24',
            spend_amount_decimal: '12.50',
            spend_date: '2026-08-22',
          },
          {
            account_timezone: 'UTC',
            clicks: '90',
            conversions: '9',
            currency_code: 'EUR',
            fetched_at: '2026-08-21T09:00:00.000Z',
            impressions: '900',
            provider: 'snapchat_ads',
            provider_customer_id: 'snap-old',
            reach: '720',
            spend_amount_decimal: '900',
            spend_date: '2026-08-21',
          },
        ],
        error: null,
      },
    ];
    const orderedResults = [results[0], results[2], results[3], results[1]];
    const terminals = ['maybeSingle', 'in', 'range', 'range'] as const;
    let index = 0;
    const from = vi.fn(() =>
      chainResult(
        orderedResults[index] ?? { data: [], error: null },
        terminals[index++]
      )
    );

    const result = await fetchAdReportingSnapshots({
      endDate: '2026-08-22',
      merchantId: 'merchant-1',
      startDate: '2026-08-01',
      supabase: { from } as never,
    });

    expect(result.googleAds).toMatchObject({
      connected: true,
      currencyCode: 'NGN',
      endDate: '2026-08-22',
      spendMicros: '2500000',
      startDate: '2026-08-01',
    });
    expect(result.googleAds?.daily).toHaveLength(1);
    expect(result.socialAds.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectionStatus: 'connected',
          metrics: expect.objectContaining({
            clicks: '3',
            spendByCurrency: [
              { currencyCode: 'GBP', spendAmountDecimal: '12.5' },
            ],
          }),
          provider: 'snapchat_ads',
        }),
      ])
    );
    expect(result.socialAds.spendByCurrency).toEqual([
      { currencyCode: 'GBP', spendAmountDecimal: '12.5' },
    ]);
    const selectedColumns = from.mock.results.flatMap((call) => {
      const value = call.value as { select?: ReturnType<typeof vi.fn> };
      return value.select?.mock.calls.flat() ?? [];
    });
    expect(selectedColumns.join(' ')).not.toMatch(
      /access_token|refresh_token|secret|credential/i
    );
    expect(selectedColumns.join(' ')).toContain('provider_customer_id');
  });

  it('preserves a Google connection read failure for the dashboard state', async () => {
    const results = [
      { data: null, error: { message: 'read failed' } },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ];
    const terminals = ['maybeSingle', 'in', 'range'] as const;
    let index = 0;
    const from = vi.fn(() =>
      chainResult(
        results[index] ?? { data: [], error: null },
        terminals[index++]
      )
    );

    const result = await fetchAdReportingSnapshots({
      endDate: '2026-08-22',
      merchantId: 'merchant-1',
      startDate: '2026-08-01',
      supabase: { from } as never,
    });

    expect(result.googleAds).toMatchObject({
      connectionStatus: 'error',
      dataStatus: 'error',
      error: 'Google Ads reporting is temporarily unavailable.',
    });
  });

  it('keeps the Google connection state when its spend read fails', async () => {
    const results = [
      {
        data: {
          last_synced_at: '2026-08-22T09:00:00.000Z',
          provider_customer_id: 'google-1',
          status: 'active',
        },
        error: null,
      },
      { data: null, error: { message: 'read failed' } },
      { data: [], error: null },
      { data: [], error: null },
    ];
    const orderedResults = [results[0], results[2], results[3], results[1]];
    const terminals = ['maybeSingle', 'in', 'range', 'range'] as const;
    let index = 0;
    const from = vi.fn(() =>
      chainResult(
        orderedResults[index] ?? { data: [], error: null },
        terminals[index++]
      )
    );

    const result = await fetchAdReportingSnapshots({
      endDate: '2026-08-22',
      merchantId: 'merchant-1',
      startDate: '2026-08-01',
      supabase: { from } as never,
    });

    expect(result.googleAds).toMatchObject({
      connected: true,
      connectionStatus: 'connected',
      dataStatus: 'error',
      error: 'Google Ads reporting is temporarily unavailable.',
    });
  });
});
