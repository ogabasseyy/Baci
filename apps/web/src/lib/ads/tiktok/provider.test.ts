import { describe, expect, it, vi } from 'vitest';
import {
  fetchTikTokAdsDailyReport,
  listTikTokAdsAccounts,
  parseTikTokAdsAsyncTaskStatus,
} from './provider';

describe('TikTok Ads provider', () => {
  it('preserves exact decimals, advertiser timezone, and provider-labelled conversions', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            list: [
              {
                dimensions: {
                  advertiser_id: 'opaque-001',
                  stat_time_day: '2026-08-20 00:00:00',
                },
                metrics: {
                  spend: '9007199254740993.123456789',
                  impressions: '10',
                  clicks: '2',
                  conversion: '1.5',
                  currency: 'NGN',
                  reach: '8',
                },
              },
            ],
            page_info: { page: 1, total_page: 1 },
          },
        })
      )
    );
    await expect(
      fetchTikTokAdsDailyReport(
        {
          accessToken: 'token',
          accountId: 'opaque-001',
          timezoneName: 'Africa/Lagos',
          startDate: '2026-08-20',
          endDate: '2026-08-20',
        },
        fetchImpl
      )
    ).resolves.toEqual([
      expect.objectContaining({
        spendAmountDecimal: '9007199254740993.123456789',
        timezoneName: 'Africa/Lagos',
      }),
    ]);
    expect(
      new URL(fetchImpl.mock.calls[0]?.[0].toString()).searchParams.get(
        'dimensions'
      )
    ).toBe('["advertiser_id","stat_time_day"]');
  });

  it('fails a nonempty report with a discarded malformed row instead of reporting an empty successful sync', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            list: [
              {
                dimensions: {
                  advertiser_id: 'opaque-001',
                  stat_time_day: '2026-08-20 00:00:00',
                },
                metrics: {
                  clicks: '2',
                  conversion: '1',
                  currency: 'NGN',
                  impressions: '10',
                  spend: '1.25',
                },
              },
            ],
            page_info: { page: 1, total_page: 1 },
          },
        })
      )
    );
    await expect(
      fetchTikTokAdsDailyReport(
        {
          accessToken: 'token',
          accountId: 'opaque-001',
          endDate: '2026-08-20',
          startDate: '2026-08-20',
        },
        fetchImpl
      )
    ).rejects.toMatchObject({ code: 'TIKTOK_ADS_REPORT_ROWS_INVALID' });
  });

  it('rejects a nonempty report when pagination metadata is missing', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            list: [
              {
                dimensions: {
                  advertiser_id: 'opaque-001',
                  stat_time_day: '2026-08-20 00:00:00',
                },
                metrics: {
                  clicks: '2',
                  conversion: '1',
                  currency: 'NGN',
                  impressions: '10',
                  spend: '1.25',
                },
              },
            ],
          },
        })
      )
    );

    await expect(
      fetchTikTokAdsDailyReport(
        {
          accessToken: 'token',
          accountId: 'opaque-001',
          endDate: '2026-08-20',
          startDate: '2026-08-20',
          timezoneName: 'Africa/Lagos',
        },
        fetchImpl
      )
    ).rejects.toMatchObject({ code: 'TIKTOK_ADS_REPORT_PAGING_INVALID' });
  });

  it('requires the requested returned advertiser_id dimension to match the selected opaque ID', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            list: [
              {
                dimensions: { stat_time_day: '2026-08-20 00:00:00' },
                metrics: {
                  clicks: '2',
                  conversion: '1',
                  currency: 'NGN',
                  impressions: '10',
                  spend: '1.25',
                },
              },
            ],
            page_info: { page: 1, total_page: 1 },
          },
        })
      )
    );
    await expect(
      fetchTikTokAdsDailyReport(
        {
          accessToken: 'token',
          accountId: 'opaque-001',
          endDate: '2026-08-20',
          startDate: '2026-08-20',
          timezoneName: 'Africa/Lagos',
        },
        fetchImpl
      )
    ).rejects.toMatchObject({ code: 'TIKTOK_ADS_REPORT_ROWS_INVALID' });
  });

  it('rejects number integer metrics before JavaScript can hide precision loss', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            list: [
              {
                dimensions: {
                  advertiser_id: 'opaque-001',
                  stat_time_day: '2026-08-20 00:00:00',
                },
                metrics: {
                  clicks: '2',
                  conversion: '1',
                  currency: 'NGN',
                  impressions: 9007199254740992,
                  spend: '1.25',
                },
              },
            ],
            page_info: { page: 1, total_page: 1 },
          },
        })
      )
    );
    await expect(
      fetchTikTokAdsDailyReport(
        {
          accessToken: 'token',
          accountId: 'opaque-001',
          endDate: '2026-08-20',
          startDate: '2026-08-20',
          timezoneName: 'Africa/Lagos',
        },
        fetchImpl
      )
    ).rejects.toMatchObject({ code: 'TIKTOK_ADS_REPORT_ROWS_INVALID' });
  });
  it('retries bounded TikTok throttles without retaining error bodies', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 40100, message: 'secret body' }), {
          status: 400,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: { list: [] } }))
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(
      listTikTokAdsAccounts(
        { accessToken: 'token', appId: 'app', appSecret: 'secret' },
        fetchImpl,
        sleep
      )
    ).resolves.toEqual([]);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('resolves missing account currency and timezone through advertiser info before selection', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              list: [
                {
                  advertiser_id: 'opaque-001',
                  advertiser_name: 'Account',
                },
              ],
              page_info: { page: 1, total_page: 1 },
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              list: [
                {
                  advertiser_id: 'opaque-001',
                  currency: 'NGN',
                  timezone: 'Africa/Lagos',
                },
              ],
            },
          })
        )
      );

    await expect(
      listTikTokAdsAccounts(
        { accessToken: 'token', appId: 'app', appSecret: 'secret' },
        fetchImpl
      )
    ).resolves.toEqual([
      {
        accountId: 'opaque-001',
        currencyCode: 'NGN',
        label: 'Account',
        timezoneName: 'Africa/Lagos',
      },
    ]);
    const metadataUrl = new URL(fetchImpl.mock.calls[1]?.[0].toString());
    expect(metadataUrl.pathname).toBe('/open_api/v1.3/advertiser/info/');
    expect(metadataUrl.searchParams.get('advertiser_ids')).toBe(
      '["opaque-001"]'
    );
  });

  it('paginates every authorized advertiser page before resolving metadata', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              list: [
                {
                  advertiser_id: 'opaque-001',
                  advertiser_name: 'First account',
                  currency: 'NGN',
                  timezone: 'Africa/Lagos',
                },
              ],
              page_info: { page: 1, total_page: 2 },
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              list: [
                {
                  advertiser_id: 'opaque-002',
                  advertiser_name: 'Second account',
                  currency: 'USD',
                  timezone: 'UTC',
                },
              ],
              page_info: { page: 2, total_page: 2 },
            },
          })
        )
      );

    await expect(
      listTikTokAdsAccounts(
        { accessToken: 'token', appId: 'app', appSecret: 'secret' },
        fetchImpl
      )
    ).resolves.toEqual([
      {
        accountId: 'opaque-001',
        currencyCode: 'NGN',
        label: 'First account',
        timezoneName: 'Africa/Lagos',
      },
      {
        accountId: 'opaque-002',
        currencyCode: 'USD',
        label: 'Second account',
        timezoneName: 'UTC',
      },
    ]);

    const firstUrl = new URL(fetchImpl.mock.calls[0]?.[0].toString());
    const secondUrl = new URL(fetchImpl.mock.calls[1]?.[0].toString());
    expect(firstUrl.searchParams.get('page')).toBe('1');
    expect(firstUrl.searchParams.get('page_size')).toBe('100');
    expect(secondUrl.searchParams.get('page')).toBe('2');
    expect(secondUrl.searchParams.get('page_size')).toBe('100');
  });

  it('excludes advertisers that still lack required reporting metadata', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              list: [
                {
                  advertiser_id: 'opaque-001',
                  advertiser_name: 'Incomplete',
                },
              ],
              page_info: { page: 1, total_page: 1 },
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: { list: [] } }))
      );

    await expect(
      listTikTokAdsAccounts(
        { accessToken: 'token', appId: 'app', appSecret: 'secret' },
        fetchImpl
      )
    ).resolves.toEqual([]);
  });

  it('keeps async task states bounded and explicit', () => {
    expect(
      parseTikTokAdsAsyncTaskStatus({ data: { task_status: 'PROCESSING' } })
    ).toBe('PROCESSING');
    expect(
      parseTikTokAdsAsyncTaskStatus({ data: { task_status: 'unknown' } })
    ).toBeNull();
  });
});
