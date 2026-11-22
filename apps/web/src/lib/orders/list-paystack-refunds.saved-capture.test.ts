import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { listPaystackRefunds } from './list-paystack-refunds';

const refund = {
  id: 1,
  amount: 100,
  currency: 'NGN',
  status: 'processed',
  transaction: { id: 5, reference: 'capture-1' },
};

function response(data: unknown) {
  return Response.json({ status: true, data });
}

describe('listPaystackRefunds for a saved capture', () => {
  beforeEach(() => vi.stubEnv('PAYSTACK_SECRET_KEY', 'test-secret'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    { id: 6 },
    { amount: 999 },
    { reference: 'other-payment' },
    { domain: 'test' },
    { status: 'reversed' },
    { currency: 'USD' },
  ])('rejects a changed saved capture before listing refunds (%j)', async (overrides) => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        id: 5,
        reference: 'capture-1',
        amount: 1000,
        domain: 'live',
        status: 'success',
        currency: 'NGN',
        ...overrides,
      })
    );
    vi.stubGlobal('fetch', fetcher);
    await expect(
      listPaystackRefunds('capture-1', {
        expectedCapture: { id: '5', domain: 'live', amountKobo: 1000 },
      })
    ).rejects.toThrow('Saved Paystack capture mismatch');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reads through a short refund page before finding the end of the history', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          id: 5,
          reference: 'capture-1',
          amount: 1000,
          domain: 'live',
          status: 'success',
          currency: 'NGN',
        })
      )
      .mockResolvedValueOnce(response([refund]))
      .mockResolvedValueOnce(response([{ ...refund, id: 2 }]))
      .mockResolvedValueOnce(response([]));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      listPaystackRefunds('capture-1', {
        expectedCapture: { id: '5', domain: 'live', amountKobo: 1000 },
      })
    ).resolves.toHaveLength(2);
    expect(
      fetcher.mock.calls.map(([, options]) => options.method ?? 'GET')
    ).toEqual(['GET', 'GET', 'GET', 'GET']);
    expect(fetcher.mock.calls[3]?.[0]).toContain('page=3');
  });
});
