import { describe, expect, it, vi } from 'vitest';
import { fetchTikTokAdsDailyReport } from './report';

const throttled = () =>
  new Response(JSON.stringify({ code: 40100 }), {
    headers: { 'retry-after': '6' },
    status: 429,
  });

describe('TikTok daily report retry budget', () => {
  it('shares one wait budget across paginated report requests', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(throttled())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: { list: [], page_info: { page: 1, total_page: 2 } },
          })
        )
      )
      .mockResolvedValueOnce(throttled());
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchTikTokAdsDailyReport(
        {
          accessToken: 'token',
          accountId: 'opaque-001',
          endDate: '2026-08-20',
          startDate: '2026-08-20',
        },
        fetchImpl,
        sleep
      )
    ).rejects.toMatchObject({
      code: 'TIKTOK_ADS_THROTTLED',
      status: 429,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(6_000);
  });
});

describe('TikTok daily report pagination', () => {
  it('accepts a valid empty first page with total_page equal to zero', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: { list: [], page_info: { page: 1, total_page: 0 } },
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
    ).resolves.toEqual([]);
  });

  it('rejects nonempty reports that claim zero total pages', async () => {
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
            page_info: { page: 1, total_page: 0 },
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
});
