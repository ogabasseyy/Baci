import { describe, expect, it, vi } from 'vitest';
import { fetchMetaJson, MAX_RETRY_WAIT_BUDGET_MS } from './provider-http';

describe('Meta Ads provider HTTP boundary', () => {
  it('retries a throttled response without exposing the provider body', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 613, secret: 'nope' } }), {
          status: 400,
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchMetaJson(
        new URL('https://graph.facebook.com/v25.0/me'),
        'access',
        'META_ADS_FAILED',
        fetchImpl,
        sleep
      )
    ).resolves.toEqual({ data: [] });
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('stops before sleeping when Retry-After exceeds the whole request budget', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 613, secret: 'nope' } }), {
        headers: { 'retry-after': '300' },
        status: 429,
      })
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchMetaJson(
        new URL('https://graph.facebook.com/v25.0/me'),
        'access',
        'META_ADS_FAILED',
        fetchImpl,
        sleep
      )
    ).rejects.toMatchObject({
      code: 'META_ADS_THROTTLED',
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
        new Response(JSON.stringify({ error: { code: 613 } }), {
          headers: { 'retry-after': '6' },
          status: 429,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 613 } }), {
          headers: { 'retry-after': '6' },
          status: 429,
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchMetaJson(
        new URL('https://graph.facebook.com/v25.0/me'),
        'access',
        'META_ADS_FAILED',
        fetchImpl,
        sleep
      )
    ).rejects.toMatchObject({
      code: 'META_ADS_THROTTLED',
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchMetaJson(
        new URL('https://graph.facebook.com/v25.0/me'),
        'access',
        'META_ADS_FAILED',
        fetchImpl,
        sleep
      )
    ).resolves.toEqual({ data: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
  });
});
