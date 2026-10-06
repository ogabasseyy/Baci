import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { requestPiggyvestTransaction } from './transaction-reconciliation-request';

const configuration = {
  apiSecret: 'synthetic-secret',
  expectedBusinessId: 'business-test',
  timeoutMs: 50,
  maxResponseBytes: 1024,
};
const binding = {
  transactionId: 'transaction-test',
  walletId: 'wallet-test',
  customerId: 'customer-test',
  businessId: 'business-test',
};

afterEach(() => vi.useRealTimers());

describe('transaction GET through real shared transport', () => {
  it('uses the exact staging path, mandatory filter, GET and injected HTTP', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(Response.json({ status: true }));
    expect(
      await requestPiggyvestTransaction({
        configuration,
        binding,
        fetchImplementation,
      })
    ).toEqual({ status: true });
    expect(fetchImplementation).toHaveBeenCalledExactlyOnceWith(
      'https://staging.piggyvest.business/api/v1/transaction/transaction-test?wallet_id=wallet-test',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        headers: { Authorization: 'Bearer synthetic-secret' },
      })
    );
    expect(fetchImplementation.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it.each([
    '../other',
    '%2e%2e',
    'wallet?other=1',
    'wallet#fragment',
  ])('rejects unsafe input %s before HTTP', async (walletId) => {
    const fetchImplementation = vi.fn();
    await expect(
      requestPiggyvestTransaction({
        configuration,
        binding: { ...binding, walletId },
        fetchImplementation,
      })
    ).rejects.toThrow();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    302, 404, 500,
  ])('rejects HTTP %s without retry or body exposure', async (status) => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(new Response('private', { status }));
    await expect(
      requestPiggyvestTransaction({
        configuration,
        binding,
        fetchImplementation,
      })
    ).rejects.toMatchObject({ code: 'HTTP_STATUS' });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('rejects redirected successful responses', async () => {
    const response = Response.json({ status: true });
    Object.defineProperty(response, 'redirected', { value: true });
    await expect(
      requestPiggyvestTransaction({
        configuration,
        binding,
        fetchImplementation: vi.fn().mockResolvedValue(response),
      })
    ).rejects.toMatchObject({ code: 'HTTP_STATUS' });
  });

  it.each([
    ['not JSON', 'INVALID_RESPONSE'],
    ['x'.repeat(1025), 'RESPONSE_TOO_LARGE'],
  ])('rejects invalid or oversized body', async (body, code) => {
    await expect(
      requestPiggyvestTransaction({
        configuration,
        binding,
        fetchImplementation: vi.fn().mockResolvedValue(new Response(body)),
      })
    ).rejects.toMatchObject({ code });
  });

  it('rejects declared overflow and cancels unread body', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { 'content-length': '1025' },
    });
    await expect(
      requestPiggyvestTransaction({
        configuration,
        binding,
        fetchImplementation: vi.fn().mockResolvedValue(response),
      })
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    'fetch',
    'body',
  ])('bounds a stalled %s without waiting for cancellation', async (stage) => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const fetchImplementation = vi
      .fn()
      .mockImplementation(() =>
        stage === 'fetch'
          ? new Promise<Response>(() => {})
          : Promise.resolve(new Response(new ReadableStream({ cancel })))
      );
    const result = requestPiggyvestTransaction({
      configuration,
      binding,
      fetchImplementation,
    });
    const assertion = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(51);
    await assertion;
    expect(fetchImplementation.mock.calls[0][1].signal.aborted).toBe(true);
    if (stage === 'body') expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
