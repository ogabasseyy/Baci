import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('verifyTransaction', () => {
  beforeEach(() => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_123');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('forwards verification abort to a pending Paystack fetch', async () => {
    const { verifyTransaction } = await import(
      '@/lib/verify-paystack-transaction'
    );
    const controller = new AbortController();
    const pendingFetch = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => reject(options.signal?.reason),
            { once: true }
          );
        })
    );
    vi.stubGlobal('fetch', pendingFetch);

    const resultPromise = verifyTransaction('BAC-OLD', controller.signal);
    controller.abort(new Error('deadline exceeded'));
    const result = await resultPromise;

    expect(pendingFetch).toHaveBeenCalledWith(
      expect.stringContaining('/transaction/verify/BAC-OLD'),
      expect.objectContaining({ signal: controller.signal })
    );
    expect(result).toMatchObject({ success: false, code: 'NETWORK_ERROR' });
  });
});
