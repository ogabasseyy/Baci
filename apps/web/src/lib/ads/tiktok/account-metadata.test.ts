import { describe, expect, it, vi } from 'vitest';
import { resolveTikTokAdsAccountMetadata } from './account-metadata';
import {
  createTikTokAdsRetryBudget,
  MAX_RETRY_WAIT_BUDGET_MS,
} from './request';

describe('TikTok advertiser metadata', () => {
  it('returns only validated currency and timezone metadata', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
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
              {
                advertiser_id: 'opaque-002',
                currency: 'bad',
                timezone: 'Africa/Lagos',
              },
            ],
          },
        })
      )
    );

    await expect(
      resolveTikTokAdsAccountMetadata(
        { accessToken: 'token', advertiserIds: ['opaque-001', 'opaque-002'] },
        fetchImpl
      )
    ).resolves.toEqual(
      new Map([
        ['opaque-001', { currencyCode: 'NGN', timezoneName: 'Africa/Lagos' }],
      ])
    );
  });

  it('rejects a malformed advertiser-info response', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ code: 0, data: {} })));

    await expect(
      resolveTikTokAdsAccountMetadata(
        { accessToken: 'token', advertiserIds: ['opaque-001'] },
        fetchImpl
      )
    ).rejects.toMatchObject({ code: 'TIKTOK_ADS_ACCOUNT_METADATA_INVALID' });
  });

  it('honors the caller retry budget for metadata requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: 40100 }), {
        headers: { 'retry-after': '1' },
        status: 429,
      })
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      resolveTikTokAdsAccountMetadata(
        { accessToken: 'token', advertiserIds: ['opaque-001'] },
        fetchImpl,
        sleep,
        createTikTokAdsRetryBudget(0)
      )
    ).rejects.toMatchObject({ code: 'TIKTOK_ADS_THROTTLED' });
    expect(MAX_RETRY_WAIT_BUDGET_MS).toBe(10_000);
    expect(sleep).not.toHaveBeenCalled();
  });
});
