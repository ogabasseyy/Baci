import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { logger } from '@/lib/logger';
import { fetchOrderTransactions } from './fetch-order-transactions';

function transactionsQuery(result: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
    select: vi.fn().mockReturnThis(),
  };
}

describe('fetchOrderTransactions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns merchant-scoped ledger rows newest first', async () => {
    const rows = [
      { id: 'txn-2', transaction_type: 'refund' },
      { id: 'txn-1', transaction_type: 'payment' },
    ];
    const query = transactionsQuery({ data: rows, error: null });
    const from = vi.fn().mockReturnValue(query);

    const result = await fetchOrderTransactions({
      merchantId: 'merchant-1',
      orderId: 'order-1',
      supabase: { from } as never,
    });

    expect(from).toHaveBeenCalledWith('transactions');
    expect(query.select).toHaveBeenCalledWith(
      expect.stringContaining('transaction_type')
    );
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(query.eq).toHaveBeenCalledWith('order_id', 'order-1');
    expect(query.order).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
    expect(result).toEqual(rows);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('fails open with undefined on error', async () => {
    const error = new Error('db down');
    const from = vi
      .fn()
      .mockReturnValue(transactionsQuery({ data: null, error }));

    const result = await fetchOrderTransactions({
      merchantId: 'merchant-1',
      orderId: 'order-1',
      supabase: { from } as never,
    });

    expect(result).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        message: 'Error fetching order transactions',
        orderId: 'order-1',
      })
    );
  });
});
