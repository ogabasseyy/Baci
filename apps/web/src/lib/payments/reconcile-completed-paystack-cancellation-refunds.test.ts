import { beforeEach, describe, expect, it, vi } from 'vitest';

const reconcile = vi.hoisted(() => vi.fn());
vi.mock('./reconcile-paystack-cancellation-refunds', () => ({
  reconcilePaystackCancellationRefund: reconcile,
}));

import { reconcileCompletedPaystackCancellationRefunds } from './reconcile-completed-paystack-cancellation-refunds';

describe('legacy completed Paystack cancellation refunds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcile.mockResolvedValue('updated');
  });

  it('re-verifies completed rows only for cancelled orders still awaiting a refund transition', async () => {
    const refund = {
      id: 'refund-1',
      order_id: 'order-1',
      merchant_id: 'merchant-1',
      gateway_reference: '42',
      amount: 100,
      currency: 'NGN',
      status: 'completed',
      metadata: { payment_transaction_id: 'payment-1' },
    };
    const query = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [refund], error: null }),
    };
    const from = vi.fn().mockReturnValue({ select: vi.fn(() => query) });
    const supabase = { from } as never;

    await expect(
      reconcileCompletedPaystackCancellationRefunds(supabase)
    ).resolves.toEqual({ checked: 1, failed: 0 });

    expect(query.eq).toHaveBeenCalledWith('status', 'completed');
    expect(query.in).toHaveBeenCalledWith('cancellation_order.payment_status', [
      'paid',
      'partially_paid',
    ]);
    expect(query.in).toHaveBeenCalledWith(
      'cancellation_order.shipping_status',
      ['cancelled', 'canceled']
    );
    expect(reconcile).toHaveBeenCalledWith(supabase, refund);
  });
});
