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

  it('accepts references with dots and equals signs', async () => {
    const { verifyTransaction } = await import(
      '@/lib/verify-paystack-transaction'
    );
    const failingFetch = vi.fn().mockRejectedValue(new Error('socket closed'));
    vi.stubGlobal('fetch', failingFetch);

    const result = await verifyTransaction('PSK.1=x');

    expect(failingFetch).toHaveBeenCalledWith(
      expect.stringContaining('/transaction/verify/PSK.1%3Dx'),
      expect.anything()
    );
    expect(result).toMatchObject({ success: false, code: 'NETWORK_ERROR' });
  });

  it('rejects references outside the shared alphabet', async () => {
    const { verifyTransaction } = await import(
      '@/lib/verify-paystack-transaction'
    );
    const neverFetch = vi.fn();
    vi.stubGlobal('fetch', neverFetch);

    const result = await verifyTransaction('bad reference!');

    expect(neverFetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      code: 'VALIDATION_ERROR',
    });
  });

  it('keeps numeric ids by default', async () => {
    const { verifyTransaction } = await import(
      '@/lib/verify-paystack-transaction'
    );
    const raw = JSON.stringify({
      data: {
        amount: 10000,
        channel: 'card',
        created_at: '2026-08-05T08:29:00Z',
        currency: 'NGN',
        customer: {
          customer_code: 'CUS-1',
          email: 'customer@example.com',
          first_name: null,
          id: 7,
          last_name: null,
          phone: null,
        },
        fees: 100,
        fees_split: null,
        id: 555,
        metadata: null,
        paid_at: '2026-08-05T08:30:00Z',
        reference: 'PSK-1',
        status: 'success',
      },
      message: 'ok',
      status: true,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => JSON.parse(raw),
        text: async () => raw,
      })
    );

    const result = await verifyTransaction('PSK-1');

    expect(result).toMatchObject({ success: true });
    if (result.success) expect(result.data.id).toBe(555);
  });

  it('returns decimal-text ids with textIds without numeric rounding', async () => {
    const { verifyTransaction } = await import(
      '@/lib/verify-paystack-transaction'
    );
    const big = '9007199254740993';
    const raw =
      `{"status":true,"message":"ok","data":{"id":${big},` +
      `"reference":"PSK-1","amount":10000,"currency":"NGN",` +
      `"channel":"card","status":"success","paid_at":null,` +
      `"created_at":"2026-08-05T08:29:00Z",` +
      `"customer":{"id":7,"email":"c@example.com",` +
      `"customer_code":"CUS-1","first_name":null,` +
      `"last_name":null,"phone":null},` +
      `"metadata":null,"fees":100,"fees_split":null}}`;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => JSON.parse(raw),
        text: async () => raw,
      })
    );

    const result = await verifyTransaction('PSK-1', undefined, {
      textIds: true,
    });

    expect(result).toMatchObject({ success: true });
    if (result.success) expect(result.data.id).toBe(big);
  });
});
