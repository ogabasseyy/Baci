import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revalidateFeedCache } from './revalidate-feed-cache';

describe('revalidateFeedCache', () => {
  const OLD_ENV = process.env['CRON_SECRET'];

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env['CRON_SECRET'] = 'test-secret';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (OLD_ENV === undefined) {
      delete process.env['CRON_SECRET'];
    } else {
      process.env['CRON_SECRET'] = OLD_ENV;
    }
  });

  it('posts the merchant id to the revalidate endpoint', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await revalidateFeedCache({
      storefrontBaseUrl: 'https://shop.example',
      merchantId: 'merchant-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://shop.example/api/feed/google-merchant/revalidate'
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer test-secret'
    );
    expect(init.body).toBe(JSON.stringify({ merchant_id: 'merchant-1' }));
  });

  it('skips the fetch when CRON_SECRET is missing', async () => {
    delete process.env['CRON_SECRET'];
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await revalidateFeedCache({
      storefrontBaseUrl: 'https://shop.example',
      merchantId: 'merchant-1',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves without throwing on non-2xx and rejected fetch', async () => {
    const failing = vi.fn(async () => ({ ok: false, status: 503 }));
    vi.stubGlobal('fetch', failing);
    await expect(
      revalidateFeedCache({
        storefrontBaseUrl: 'https://shop.example',
        merchantId: 'merchant-1',
      })
    ).resolves.toBeUndefined();

    const rejecting = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', rejecting);
    await expect(
      revalidateFeedCache({
        storefrontBaseUrl: 'https://shop.example',
        merchantId: 'merchant-1',
      })
    ).resolves.toBeUndefined();
  });
});
