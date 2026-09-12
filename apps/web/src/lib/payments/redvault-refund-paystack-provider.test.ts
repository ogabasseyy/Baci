import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createRedvaultPaystackRefundProvider,
  createTestRedvaultPaystackRefundProvider,
} from './redvault-refund-paystack-provider';

const input = { amountKobo: 9500, originalCaptureReference: 'RV-capture' };
const data = {
  id: 123,
  status: 'pending',
  amount: 9500,
  currency: 'NGN',
  transaction: { reference: 'RV-capture' },
};
function setup(body: unknown, status = 200) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  return {
    fetcher,
    provider: createRedvaultPaystackRefundProvider({
      fetcher,
      getSecret: () => 'test-secret',
    }),
  };
}

describe('isolated REDVAULT Paystack refund transport', () => {
  it('accepts only a test key for the recovery runner transport', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: true, data }), { status: 200 })
      );
    const provider = createTestRedvaultPaystackRefundProvider({
      fetcher,
      providerKey: 'sk_test_refund_runner',
    });

    await expect(provider.submit(input)).resolves.toMatchObject({
      kind: 'accepted_pending',
    });
    expect(() =>
      createTestRedvaultPaystackRefundProvider({
        providerKey: 'sk_live_not_allowed',
      })
    ).toThrow('requires a Paystack test key');
  });

  it.each([
    false,
    null,
    {},
    { status: false, message: 'private body' },
    { status: true },
    { status: true, data: {} },
  ])('holds ambiguous envelope %j', async (body) => {
    const { provider, fetcher } = setup(body);
    expect(await provider.submit(input)).toEqual({ kind: 'indeterminate' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    400, 401, 422, 429, 500,
  ])('holds HTTP %s without retry', async (status) => {
    const { provider, fetcher } = setup({ status: false }, status);
    expect(await provider.submit(input)).toEqual({ kind: 'indeterminate' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('holds response loss and suppresses transport error detail', async () => {
    const { provider, fetcher } = setup(null);
    fetcher.mockRejectedValue(new Error('secret provider detail'));
    expect(await provider.submit(input)).toEqual({ kind: 'indeterminate' });
    await expect(provider.lookup({ providerReference: '123' })).rejects.toThrow(
      'REDVAULT refund lookup unverified'
    );
  });
  it('holds malformed JSON', async () => {
    const { provider, fetcher } = setup(null);
    fetcher.mockResolvedValue(new Response('not-json'));
    expect(await provider.submit(input)).toEqual({ kind: 'indeterminate' });
  });
  it.each([
    'pending',
    'processing',
    'needs-attention',
    'failed',
    'future-status',
  ])('retains known id for %s', async (status) => {
    const { provider } = setup({ status: true, data: { ...data, status } });
    expect(await provider.submit(input)).toEqual({
      kind: 'accepted_pending',
      providerReference: '123',
      providerStatus: status === 'future-status' ? 'unknown' : status,
    });
  });
  it('accepts a bound processed submission', async () => {
    const { provider } = setup({
      status: true,
      data: { ...data, status: 'processed' },
    });
    expect(await provider.submit(input)).toEqual({
      kind: 'processed',
      providerReference: '123',
      providerStatus: 'processed',
    });
  });
  it.each([
    { id: '123' },
    { amount: 1 },
    { currency: 'USD' },
    { transaction: { reference: 'other' } },
  ])('rejects unbound submission %j', async (changes) => {
    const { provider } = setup({ status: true, data: { ...data, ...changes } });
    expect(await provider.submit(input)).toEqual({ kind: 'indeterminate' });
  });
  it.each([
    'processed',
    'failed',
    'pending',
    'processing',
    'needs-attention',
  ])('reads bound status %s with GET only', async (status) => {
    const { provider, fetcher } = setup({
      status: true,
      data: { id: 123, status },
    });
    const expected = ['processed', 'failed'].includes(status)
      ? status
      : 'pending';
    expect(await provider.lookup({ providerReference: '123' })).toEqual({
      kind: expected,
      providerStatus: expected,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.paystack.co/refund/123',
      expect.objectContaining({
        method: 'GET',
        body: undefined,
        redirect: 'error',
        cache: 'no-store',
      })
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { id: 124, status: 'processed' },
    { id: '123', status: 'failed' },
    { id: 123 },
    { id: 123, status: 'unknown' },
  ])('rejects untrusted lookup %j', async (response) => {
    const { provider } = setup({ status: true, data: response });
    await expect(provider.lookup({ providerReference: '123' })).rejects.toThrow(
      /REDVAULT refund lookup/
    );
  });
  it('rejects path injection before requesting', async () => {
    const { provider, fetcher } = setup(null);
    await expect(
      provider.lookup({ providerReference: '../123' })
    ).rejects.toThrow('invalid identifier');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not send without credentials', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = createRedvaultPaystackRefundProvider({
      fetcher,
      getSecret: () => undefined,
    });
    expect(await provider.submit(input)).toEqual({ kind: 'indeterminate' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
