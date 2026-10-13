import { describe, expect, it, vi } from 'vitest';
import { SNAPCHAT_ADS_API_ROOT } from './constants';
import {
  fetchSnapchatAdsDailyReport,
  listSnapchatAdsAccounts,
} from './provider';

describe('Snapchat Ads provider', () => {
  it('pins the documented fixed v1 Ads API origin', () => {
    expect(SNAPCHAT_ADS_API_ROOT).toBe('https://adsapi.snapchat.com/v1');
  });
  it('discovers only active nested ad accounts with their organization and timezone', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          organizations: [
            {
              ad_accounts: [
                {
                  currency: 'USD',
                  id: 'ad-1',
                  name: 'Active account',
                  status: 'ACTIVE',
                  timezone: 'America/New_York',
                },
                {
                  currency: 'USD',
                  id: 'ad-2',
                  name: 'Disabled',
                  status: 'PAUSED',
                  timezone: 'UTC',
                },
              ],
              id: 'org-1',
            },
          ],
        })
      )
    );
    await expect(
      listSnapchatAdsAccounts({ accessToken: 'token' }, fetchImpl)
    ).resolves.toEqual([
      {
        accountId: 'ad-1',
        currencyCode: 'USD',
        label: 'Active account',
        organizationId: 'org-1',
        timezoneName: 'America/New_York',
      },
    ]);
    expect(
      new URL(fetchImpl.mock.calls[0]?.[0].toString()).searchParams.get(
        'with_ad_accounts'
      )
    ).toBe('true');
  });

  it('unwraps documented timeseries_stat rows across DST and keeps micro-currency exact', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          conversion_data_processed_end_time: '2026-03-10T00:00:00Z',
          finalized_data_end_time: '2026-03-09T04:00:00Z',
          timeseries_stats: [
            {
              sub_request_status: 'success',
              timeseries_stat: {
                conversion_data_processed_end_time: '2026-03-10T00:00:00Z',
                end_time: '2026-03-09T04:00:00Z',
                finalized_data_end_time: '2026-03-09T04:00:00Z',
                start_time: '2026-03-08T05:00:00Z',
                timeseries: [
                  {
                    end_time: '2026-03-09T04:00:00Z',
                    start_time: '2026-03-08T05:00:00Z',
                    stats: {
                      conversion_purchases: '1.5',
                      impressions: '9007199254740993',
                      spend: '9007199254740993',
                      swipes: '7',
                    },
                  },
                ],
              },
            },
          ],
        })
      )
    );
    await expect(
      fetchSnapchatAdsDailyReport(
        {
          accessToken: 'token',
          accountId: 'ad-1',
          currencyCode: 'USD',
          endDate: '2026-03-08',
          startDate: '2026-03-08',
          timezoneName: 'America/New_York',
        },
        fetchImpl
      )
    ).resolves.toEqual([
      expect.objectContaining({
        spendAmountDecimal: '9007199254.740993',
        spendDate: '2026-03-08',
        spendMicros: '9007199254740993',
        conversionDataProcessedEndTime: '2026-03-10T00:00:00Z',
        finalizedDataEndTime: '2026-03-09T04:00:00Z',
        sourceEndTime: '2026-03-09T04:00:00Z',
        sourceStartTime: '2026-03-08T05:00:00Z',
      }),
    ]);
    const url = new URL(fetchImpl.mock.calls[0]?.[0].toString());
    expect(url.searchParams.get('granularity')).toBe('DAY');
    expect(url.searchParams.get('start_time')).toBe('2026-03-08T05:00:00.000Z');
    expect(url.searchParams.get('end_time')).toBe('2026-03-09T04:00:00.000Z');
  });

  it('accepts numeric daily stats returned by the Snapchat API', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          timeseries: [
            {
              end_time: '2026-08-21T00:00:00Z',
              start_time: '2026-08-20T00:00:00Z',
              stats: {
                conversion_purchases: 2.5,
                impressions: 120,
                spend: 1250000,
                swipes: 7,
              },
            },
          ],
        })
      )
    );

    await expect(
      fetchSnapchatAdsDailyReport(
        {
          accessToken: 'token',
          accountId: 'ad-1',
          currencyCode: 'USD',
          endDate: '2026-08-20',
          startDate: '2026-08-20',
          timezoneName: 'UTC',
        },
        fetchImpl
      )
    ).resolves.toEqual([
      expect.objectContaining({
        clicks: '7',
        conversions: '2.5',
        impressions: '120',
        spendAmountDecimal: '1.25',
        spendMicros: '1250000',
      }),
    ]);
  });

  it('rejects report objects without a recognized timeseries payload', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: {} })));

    await expect(
      fetchSnapchatAdsDailyReport(
        {
          accessToken: 'token',
          accountId: 'ad-1',
          currencyCode: 'USD',
          endDate: '2026-08-20',
          startDate: '2026-08-20',
          timezoneName: 'UTC',
        },
        fetchImpl
      )
    ).rejects.toMatchObject({
      code: 'SNAPCHAT_ADS_REPORT_RESPONSE_INVALID',
    });
  });

  it('accepts an explicitly empty recognized timeseries payload', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ timeseries: [] })));

    await expect(
      fetchSnapchatAdsDailyReport(
        {
          accessToken: 'token',
          accountId: 'ad-1',
          currencyCode: 'USD',
          endDate: '2026-08-20',
          startDate: '2026-08-20',
          timezoneName: 'UTC',
        },
        fetchImpl
      )
    ).resolves.toEqual([]);
  });
  it('rejects report-run responses because v1 only supports synchronous daily summaries', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ report_run_id: 'opaque-run' }))
      );
    await expect(
      fetchSnapchatAdsDailyReport(
        {
          accessToken: 'token',
          accountId: 'ad-1',
          currencyCode: 'USD',
          endDate: '2026-08-20',
          startDate: '2026-08-20',
          timezoneName: 'UTC',
        },
        fetchImpl
      )
    ).rejects.toMatchObject({ code: 'SNAPCHAT_ADS_ASYNC_REPORT_UNSUPPORTED' });
  });
  it.each([
    'STARTED',
    'RUNNING',
    'COMPLETED',
    'FAILED',
  ])('rejects an async %s state rather than falsely reporting success', async (status) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ report_run_id: 'run', status }))
      );
    await expect(
      fetchSnapchatAdsDailyReport(
        {
          accessToken: 'token',
          accountId: 'ad-1',
          currencyCode: 'USD',
          endDate: '2026-08-20',
          startDate: '2026-08-20',
          timezoneName: 'UTC',
        },
        fetchImpl
      )
    ).rejects.toMatchObject({ code: 'SNAPCHAT_ADS_ASYNC_REPORT_UNSUPPORTED' });
  });
});
