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
});
