import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePaymentForCancelledOrder } from '@/lib/payments/handle-payment-for-cancelled-order';
import { reinstateTimeoutOrderPayment } from '@/lib/payments/reinstate-timeout-order-payment';
import { recoverKlumpTimeoutOrderPayment } from './recover-klump-timeout-order-payment';

vi.mock('@/lib/payments/reinstate-timeout-order-payment', () => ({
  reinstateTimeoutOrderPayment: vi.fn(),
}));
vi.mock('@/lib/payments/handle-payment-for-cancelled-order', () => ({
  handlePaymentForCancelledOrder: vi.fn(),
  isOrderClampedAsCancelled: (order: {
    cancelled_at?: string | null;
    shipping_status?: string | null;
  }) => order.cancelled_at != null || order.shipping_status === 'cancelled',
}));

const cancelledOrder = {
  id: 'order',
  merchant_id: 'merchant',
  payment_status: 'cancelled',
  shipping_status: 'cancelled',
};

function mockSupabase(data: unknown, error: unknown = null) {
  const query = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    select: vi.fn().mockReturnThis(),
  };
  return { from: vi.fn().mockReturnValue(query), query };
}

describe('recoverKlumpTimeoutOrderPayment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the fresh paid row for settlement and notifications', async () => {
    vi.mocked(reinstateTimeoutOrderPayment).mockResolvedValue('reinstated');
    const paidOrder = {
      ...cancelledOrder,
      payment_status: 'paid',
      shipping_status: 'processing',
    };
    const supabase = mockSupabase(paidOrder);

    await expect(
      recoverKlumpTimeoutOrderPayment({
        order: cancelledOrder,
        reference: 'ref',
        supabase: supabase as unknown as SupabaseClient,
        transaction: { id: 'transaction', merchant_id: 'merchant' },
      })
    ).resolves.toEqual({ kind: 'reinstated', order: paidOrder });
    expect(supabase.query.eq).toHaveBeenNthCalledWith(1, 'id', 'order');
    expect(supabase.query.eq).toHaveBeenNthCalledWith(
      2,
      'merchant_id',
      'merchant'
    );
    expect(handlePaymentForCancelledOrder).not.toHaveBeenCalled();
  });

  it('files a review when the recovery RPC blocks reopening', async () => {
    vi.mocked(reinstateTimeoutOrderPayment).mockResolvedValue('blocked');
    vi.mocked(handlePaymentForCancelledOrder).mockResolvedValue(true);
    const supabase = mockSupabase(null);

    await expect(
      recoverKlumpTimeoutOrderPayment({
        order: cancelledOrder,
        reference: 'ref',
        supabase: supabase as unknown as SupabaseClient,
        transaction: { id: 'transaction', merchant_id: 'merchant' },
      })
    ).resolves.toEqual({ kind: 'blocked', reviewFiled: true });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('files review when the order is no longer paid after recovery', async () => {
    vi.mocked(reinstateTimeoutOrderPayment).mockResolvedValue(
      'already_reinstated'
    );
    vi.mocked(handlePaymentForCancelledOrder).mockResolvedValue(true);
    const supabase = mockSupabase({
      ...cancelledOrder,
      payment_status: 'refunded',
    });

    await expect(
      recoverKlumpTimeoutOrderPayment({
        order: cancelledOrder,
        reference: 'ref',
        supabase: supabase as unknown as SupabaseClient,
        transaction: { id: 'transaction', merchant_id: 'merchant' },
      })
    ).resolves.toEqual({ kind: 'reviewed', reviewFiled: true });
    expect(handlePaymentForCancelledOrder).toHaveBeenCalledWith(
      expect.objectContaining({ issueType: 'payment_received_after_refund' })
    );
  });
});
