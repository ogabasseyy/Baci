import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./list-paystack-refunds', () => ({ listPaystackRefunds: vi.fn() }));

import { listPaystackRefunds } from './list-paystack-refunds';
import { reconcileCancellationRefunds } from './reconcile-cancellation-refunds';

function query(data: unknown, error: unknown = null) {
  const result = { data, error };
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    update: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase queries are intentionally awaitable.
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
}
const refund = {
  id: 'r1',
  order_id: 'o1',
  merchant_id: 'm1',
  amount: 100,
  currency: 'NGN',
  gateway_reference: '12',
  metadata: { payment_transaction_id: 'p1' },
};
describe('reconcileCancellationRefunds', () => {
  beforeEach(() => vi.clearAllMocks());
  it('confirms pending refunds only against the matching provider amount and currency', async () => {
    const update = query(null);
    const finish = query(null);
    const from = vi
      .fn()
      .mockReturnValueOnce(query([refund]))
      .mockReturnValueOnce(query({ gateway_reference: 'capture-1' }))
      .mockReturnValueOnce(update)
      .mockReturnValueOnce(query({ payment_status: 'refunded' }))
      .mockReturnValueOnce(finish);
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 12, amount: 10000, currency: 'NGN', status: 'processed' },
    ]);
    await reconcileCancellationRefunds({ from } as never);
    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
    expect(finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
  });
  it('requeues a definitively failed provider refund after checking no other refunds are pending', async () => {
    const update = query(null);
    const requeue = query(null);
    const from = vi
      .fn()
      .mockReturnValueOnce(query([refund]))
      .mockReturnValueOnce(query({ gateway_reference: 'capture-1' }))
      .mockReturnValueOnce(update)
      .mockReturnValueOnce(query({ payment_status: 'paid' }))
      .mockReturnValueOnce(query([]))
      .mockReturnValueOnce(requeue);
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 12, amount: 10000, currency: 'NGN', status: 'failed' },
    ]);
    await reconcileCancellationRefunds({ from } as never);
    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
    expect(requeue.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', attempts: 0 })
    );
    expect(requeue.like).toHaveBeenCalledWith(
      'error',
      'Paystack accepted refund%'
    );
  });

  it('does not confirm an amount mismatch or provider outage', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(query([refund]))
      .mockReturnValueOnce(query({ gateway_reference: 'capture-1' }));
    vi.mocked(listPaystackRefunds).mockResolvedValue([
      { id: 12, amount: 1, currency: 'NGN', status: 'processed' },
    ]);
    await reconcileCancellationRefunds({ from } as never);
    expect(from).toHaveBeenCalledTimes(2);
  });
  it('fails on database lookup errors', async () => {
    await expect(
      reconcileCancellationRefunds({
        from: vi.fn().mockReturnValue(query(null, new Error('db'))),
      } as never)
    ).rejects.toThrow('Unable to load');
  });
});
