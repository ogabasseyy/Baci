import { describe, expect, it, vi } from 'vitest';
import { MAX_RETRY_WAIT_BUDGET_MS, requestTikTokAdsJson } from './request';

describe('TikTok Ads request boundary', () => {
  it('maps allow-listed structured invalid-token codes without retaining the body', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 40101, message: 'sensitive text' }))
      );
    await expect(
      requestTikTokAdsJson(
        new URL(
          'https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/'
        ),
        {},
        'FAILED',
        fetchImpl
      )
    ).rejects.toMatchObject({ code: 'TIKTOK_ADS_ACCESS_REVOKED' });
  });

  it('uses Retry-After before jittered bounded exponential backoff', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 40100 }), {
          headers: { 'retry-after': '2' },
          status: 429,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: {} }))
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    await requestTikTokAdsJson(
      new URL(
        'https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/'
      ),
      {},
      'FAILED',
      fetchImpl,
      { random: () => 0.5, sleep }
    );
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('stops before sleeping when Retry-After exceeds the whole request budget', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 40100 }), {
        headers: { 'retry-after': '300' },
        status: 429,
      })
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      requestTikTokAdsJson(
        new URL('https://business-api.tiktok.com/open_api/v1.3/test/'),
        {},
        'FAILED',
        fetchImpl,
        { random: () => 0, sleep }
      )
    ).rejects.toMatchObject({
      code: 'TIKTOK_ADS_THROTTLED',
      status: 429,
    });

    expect(MAX_RETRY_WAIT_BUDGET_MS).toBe(10_000);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not spend a second retry after cumulative waits exhaust the budget', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 40100 }), {
          headers: { 'retry-after': '6' },
          status: 429,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 40100 }), {
          headers: { 'retry-after': '6' },
          status: 429,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: {} }))
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      requestTikTokAdsJson(
        new URL('https://business-api.tiktok.com/open_api/v1.3/test/'),
        {},
        'FAILED',
        fetchImpl,
        { random: () => 0, sleep }
      )
    ).rejects.toMatchObject({
      code: 'TIKTOK_ADS_THROTTLED',
      status: 429,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(6_000);
  });

  it('keeps normal exponential retries inside the cumulative budget', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: {} }))
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      requestTikTokAdsJson(
        new URL('https://business-api.tiktok.com/open_api/v1.3/test/'),
        {},
        'FAILED',
        fetchImpl,
        { random: () => 0, sleep }
      )
    ).resolves.toEqual({ code: 0, data: {} });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
  });
});
