import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revalidateFeedCache } from './revalidate-feed-cache';

describe('revalidateFeedCache', () => {
  const OLD_ENV = {
    CRON_SECRET: process.env['CRON_SECRET'],
    NEXT_PUBLIC_APP_URL: process.env['NEXT_PUBLIC_APP_URL'],
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env['CRON_SECRET'] = 'test-secret';
    process.env['NEXT_PUBLIC_APP_URL'] = 'https://app.example';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(OLD_ENV)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('posts the merchant id to the trusted app origin', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await revalidateFeedCache({ merchantId: 'merchant-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://app.example/api/feed/google-merchant/revalidate');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer test-secret'
    );
    expect(init.body).toBe(JSON.stringify({ merchant_id: 'merchant-1' }));
  });

  it('skips the fetch when secrets or the app origin are missing', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    delete process.env['CRON_SECRET'];
    await revalidateFeedCache({ merchantId: 'merchant-1' });
    process.env['CRON_SECRET'] = 'test-secret';
    delete process.env['NEXT_PUBLIC_APP_URL'];
    await revalidateFeedCache({ merchantId: 'merchant-1' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves without throwing on non-2xx and rejected fetch', async () => {
    const failing = vi.fn(async () => ({ ok: false, status: 503 }));
    vi.stubGlobal('fetch', failing);
    await expect(revalidateFeedCache({ merchantId: 'merchant-1' })).resolves
      .toBeUndefined();

    const rejecting = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', rejecting);
    await expect(revalidateFeedCache({ merchantId: 'merchant-1' })).resolves
      .toBeUndefined();
  });
});
