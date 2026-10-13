import { describe, expect, it, vi } from 'vitest';
import { listTikTokAdsAccounts } from './account-discovery';

const throttled = () =>
  new Response(JSON.stringify({ code: 40100 }), {
    headers: { 'retry-after': '6' },
    status: 429,
  });

describe('TikTok advertiser discovery retry budget', () => {
  it('shares one wait budget across paginated advertiser requests', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(throttled())
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
      .mockResolvedValueOnce(throttled());
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      listTikTokAdsAccounts(
        { accessToken: 'token', appId: 'app', appSecret: 'secret' },
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

  it('shares the page budget with the follow-up metadata request', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(throttled())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              list: [
                {
                  advertiser_id: 'opaque-001',
                  advertiser_name: 'Incomplete account',
                },
              ],
              page_info: { page: 1, total_page: 1 },
            },
          })
        )
      )
      .mockResolvedValueOnce(throttled());
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      listTikTokAdsAccounts(
        { accessToken: 'token', appId: 'app', appSecret: 'secret' },
        fetchImpl,
        sleep
      )
    ).rejects.toMatchObject({
      code: 'TIKTOK_ADS_THROTTLED',
      status: 429,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledOnce();
  });
});
