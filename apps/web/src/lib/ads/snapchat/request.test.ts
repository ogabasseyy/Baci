import { describe, expect, it, vi } from 'vitest';
import { MAX_RETRY_WAIT_BUDGET_MS, requestSnapchatAdsJson } from './request';

describe('Snapchat Ads request boundary', () => {
  it('honors Retry-After with bounded retry and does not expose provider content', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'secret' }), {
          headers: { 'retry-after': '2' },
          status: 429,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ organizations: [] }))
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(
      requestSnapchatAdsJson(
        new URL('https://adsapi.snapchat.com/v1/me/organizations'),
        {},
        'FAILED',
        fetchImpl,
        { random: () => 0, sleep }
      )
    ).resolves.toEqual({ organizations: [] });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('stops before sleeping when Retry-After exceeds the whole request budget', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'secret' }), {
        headers: { 'retry-after': '300' },
        status: 429,
      })
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      requestSnapchatAdsJson(
        new URL('https://adsapi.snapchat.com/v1/me/organizations'),
        {},
        'FAILED',
        fetchImpl,
        { random: () => 0, sleep }
      )
    ).rejects.toMatchObject({
      code: 'SNAPCHAT_ADS_THROTTLED',
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
        new Response(JSON.stringify({ detail: 'secret' }), {
          headers: { 'retry-after': '6' },
          status: 429,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'secret' }), {
          headers: { 'retry-after': '6' },
          status: 429,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ organizations: [] }))
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      requestSnapchatAdsJson(
        new URL('https://adsapi.snapchat.com/v1/me/organizations'),
        {},
        'FAILED',
        fetchImpl,
        { random: () => 0, sleep }
      )
    ).rejects.toMatchObject({
      code: 'SNAPCHAT_ADS_THROTTLED',
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
        new Response(JSON.stringify({ organizations: [] }))
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      requestSnapchatAdsJson(
        new URL('https://adsapi.snapchat.com/v1/me/organizations'),
        {},
        'FAILED',
        fetchImpl,
        { random: () => 0, sleep }
      )
    ).resolves.toEqual({ organizations: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
  });

  it('does not mark a permission-denied response as a revoked token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'missing Reports role' }), {
        status: 403,
      })
    );

    await expect(
      requestSnapchatAdsJson(
        new URL('https://adsapi.snapchat.com/v1/me/organizations'),
        {},
        'SNAPCHAT_ADS_ACCOUNT_DISCOVERY_FAILED',
        fetchImpl
      )
    ).rejects.toMatchObject({
      code: 'SNAPCHAT_ADS_ACCOUNT_DISCOVERY_FAILED',
      status: 403,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
