import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchWithCsrf = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: mockFetchWithCsrf,
}));

import { submitUtilityCheckout } from './utility-checkout-submit';

function jsonResponse(
  body: Record<string, unknown>,
  init: { ok?: boolean; status?: number } = {}
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

const baseRequest = {
  payload: { amount: 100, type: 'airtime', phoneNumber: '08012345678' },
  merchantSlug: 'ogabassey',
  customerName: 'Test Customer',
  customerPhone: '08012345678',
  expectedUserId: 'user-1',
  getWalletIdempotencyKey: () => 'idem-key',
};

describe('submitUtilityCheckout', () => {
  beforeEach(() => {
    mockFetchWithCsrf.mockReset();
  });

  it('routes every purchase to wallet-only checkout with idempotency', async () => {
    mockFetchWithCsrf.mockResolvedValue(
      jsonResponse({ amount: 100, reference: 'REF1', status: 'successful' })
    );

    const result = await submitUtilityCheckout(baseRequest);

    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/vtu/checkout/wallet-only',
      expect.objectContaining({
        headers: { 'Idempotency-Key': 'idem-key' },
      })
    );
    expect(JSON.parse(String(mockFetchWithCsrf.mock.calls[0]?.[1]?.body))).toMatchObject({
      amount: 100,
      expectedUserId: 'user-1',
      merchantSlug: 'ogabassey',
      type: 'airtime',
      walletAmount: 100,
    });
    expect(result).toEqual({
      kind: 'wallet-success',
      reference: 'REF1',
      amount: 100,
      processing: false,
    });
  });

  it('derives the retry signature from intent fields, not cosmetic ones', async () => {
    mockFetchWithCsrf.mockResolvedValue(
      jsonResponse({ amount: 100, reference: 'REF1', status: 'successful' })
    );
    const seenSignatures: string[] = [];

    await submitUtilityCheckout({
      ...baseRequest,
      customerName: 'Customer',
      customerPhone: undefined,
      getWalletIdempotencyKey: (signature: string) => {
        seenSignatures.push(signature);
        return 'idem-key';
      },
    });
    await submitUtilityCheckout({
      ...baseRequest,
      customerName: 'Test Customer',
      customerPhone: '08012345678',
      getWalletIdempotencyKey: (signature: string) => {
        seenSignatures.push(signature);
        return 'idem-key';
      },
    });

    expect(seenSignatures).toHaveLength(2);
    // Same utility intent despite the hydration delta: same key slot.
    expect(seenSignatures[1]).toBe(seenSignatures[0]);
    expect(seenSignatures[0]).not.toContain('Test Customer');
  });

  it('carries the prepaid voucher PIN into the success result', async () => {
    mockFetchWithCsrf.mockResolvedValue(
      jsonResponse({
        amount: 100,
        reference: 'REF-PIN',
        status: 'successful',
        voucherPin: '1234-5678-9012',
      })
    );

    const result = await submitUtilityCheckout(baseRequest);

    expect(result).toEqual({
      kind: 'wallet-success',
      reference: 'REF-PIN',
      amount: 100,
      processing: false,
      voucherPin: '1234-5678-9012',
    });
  });

  it('rejects 2xx bodies missing the success contract (reference + status)', async () => {
    // A malformed 2xx must NOT finalize success: the hook would
    // forget the key and a retry would mint fresh and double-charge
    // a committed debit. Ambiguous error (no status) keeps the key.
    for (const body of [
      {},
      { amount: 100 },
      { amount: 100, reference: 'REF1' },
      { amount: 100, reference: 'REF1', status: 'weird' },
      { amount: 100, reference: '', status: 'successful' },
    ]) {
      mockFetchWithCsrf.mockResolvedValueOnce(jsonResponse(body));
      const result = await submitUtilityCheckout(baseRequest);
      expect(result).toEqual({
        kind: 'error',
        message: 'Payment checkout returned an invalid response',
      });
    }
  });

  it('reports a processing wallet purchase without failing', async () => {
    mockFetchWithCsrf.mockResolvedValue(
      jsonResponse({ amount: 100, reference: 'REF1', status: 'processing' })
    );

    const result = await submitUtilityCheckout(baseRequest);

    expect(result).toEqual({
      kind: 'wallet-success',
      reference: 'REF1',
      amount: 100,
      processing: true,
    });
  });

  it('returns an error result when the checkout call fails', async () => {
    mockFetchWithCsrf.mockResolvedValue(
      jsonResponse({ error: 'Insufficient funds' }, { ok: false, status: 400 })
    );

    const result = await submitUtilityCheckout(baseRequest);

    expect(result).toEqual({
      kind: 'error',
      message: 'Insufficient funds',
      status: 400,
    });
  });

  it('surfaces a status-coded error for a failed non-JSON response', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve('<html>Bad gateway</html>'),
    } as Response);

    const result = await submitUtilityCheckout(baseRequest);

    expect(result).toEqual({
      kind: 'error',
      message: 'Payment checkout failed (502)',
      status: 502,
    });
  });

  it('carries the cashback balance through a wallet success', async () => {
    mockFetchWithCsrf.mockResolvedValue(
      jsonResponse({
        amount: 100,
        cashback: { amount: 5, credited: true, newBalance: 4405 },
        reference: 'REF1',
        status: 'successful',
      })
    );

    const result = await submitUtilityCheckout(baseRequest);

    expect(result).toEqual({
      kind: 'wallet-success',
      reference: 'REF1',
      amount: 100,
      processing: false,
      cashback: { amount: 5, newBalance: 4405 },
    });
  });

  it('drops malformed cashback without failing the checkout', async () => {
    mockFetchWithCsrf.mockResolvedValue(
      jsonResponse({
        amount: 100,
        cashback: { amount: 'five', newBalance: null },
        reference: 'REF1',
        status: 'successful',
      })
    );

    const result = await submitUtilityCheckout(baseRequest);

    expect(result).toEqual({
      kind: 'wallet-success',
      reference: 'REF1',
      amount: 100,
      processing: false,
    });
  });

  it('omits expectedUserId from the body when no user was captured', async () => {
    mockFetchWithCsrf.mockResolvedValue(
      jsonResponse({ amount: 100, reference: 'REF1', status: 'successful' })
    );

    await submitUtilityCheckout({ ...baseRequest, expectedUserId: null });

    expect(
      JSON.parse(String(mockFetchWithCsrf.mock.calls[0]?.[1]?.body))
    ).not.toHaveProperty('expectedUserId');
  });

  it('fails closed on a schema-invalid success response', async () => {
    // response.ok but the body is not a valid checkout response (amount is not
    // a number): must error, never treat malformed data as a real checkout.
    mockFetchWithCsrf.mockResolvedValue(
      jsonResponse({ amount: 'not-a-number' })
    );

    const result = await submitUtilityCheckout(baseRequest);

    expect(result).toEqual({
      kind: 'error',
      message: 'Payment checkout returned an invalid response',
    });
  });

  it('times out a stalled checkout request without rotating the key', async () => {
    // Codex R81 P2: unbounded headers used to hold loading forever
    // even after the debit landed. The timeout error carries no
    // status, so the caller keeps the key and the retry replays.
    vi.useFakeTimers();
    try {
      mockFetchWithCsrf.mockImplementation(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          })
      );

      const pending = submitUtilityCheckout(baseRequest);
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await pending;

      expect(result).toEqual({
        kind: 'error',
        message: 'Request timed out. Please try again.',
      });
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);

  it('times out a stalled checkout body without rotating the key', async () => {
    // Headers arrived but the body never does: same shared
    // deadline, same key-retaining timeout error.
    vi.useFakeTimers();
    try {
      mockFetchWithCsrf.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => new Promise<string>(() => {}),
      } as Response);

      const pending = submitUtilityCheckout(baseRequest);
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await pending;

      expect(result).toEqual({
        kind: 'error',
        message: 'Request timed out. Please try again.',
      });
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);
});
