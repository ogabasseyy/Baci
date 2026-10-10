import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { listPaystackRefunds } from './list-paystack-refunds';

const refund = {
  id: 1,
  amount: 100,
  currency: 'NGN',
  status: 'processed',
  transaction: { reference: 'capture-1' },
};
function response(data: unknown, ok = true) {
  return { ok, json: async () => ({ status: true, data }) } as Response;
}
describe('listPaystackRefunds', () => {
  beforeEach(() => vi.stubEnv('PAYSTACK_SECRET_KEY', 'test-secret'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it('reads verified refunds and resolves numeric transaction identities', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response([{ ...refund, transaction: 5 }]))
      .mockResolvedValueOnce(response({ reference: 'capture-1' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await listPaystackRefunds('capture-1')).toEqual([
      { id: 1, amount: 100, currency: 'NGN', status: 'processed' },
    ]);
  });
  it('resolves several numeric transaction identities on one page', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response([
          { ...refund, id: 1, transaction: 5 },
          { ...refund, id: 2, transaction: 6 },
          { ...refund, id: 3, transaction: 7 },
        ])
      )
      .mockResolvedValue(response({ reference: 'capture-1' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await listPaystackRefunds('capture-1')).toEqual([
      { id: 1, amount: 100, currency: 'NGN', status: 'processed' },
      { id: 2, amount: 100, currency: 'NGN', status: 'processed' },
      { id: 3, amount: 100, currency: 'NGN', status: 'processed' },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('reads another page after a full page', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          Array.from({ length: 100 }, (_, i) => ({ ...refund, id: i + 1 }))
        )
      )
      .mockResolvedValueOnce(response([]));
    vi.stubGlobal('fetch', fetcher);
    expect(await listPaystackRefunds('capture-1')).toHaveLength(100);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('blocks mismatched and malformed provider records', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          response([{ ...refund, transaction: { reference: 'other' } }])
        )
    );
    await expect(listPaystackRefunds('capture-1')).rejects.toThrow('mismatch');
  });
  it('rejects failed transport and missing configuration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, false)));
    await expect(listPaystackRefunds('capture-1')).rejects.toThrow('failed');
    vi.stubEnv('PAYSTACK_SECRET_KEY', '');
    await expect(listPaystackRefunds('capture-1')).rejects.toThrow(
      'unavailable'
    );
  });
});
