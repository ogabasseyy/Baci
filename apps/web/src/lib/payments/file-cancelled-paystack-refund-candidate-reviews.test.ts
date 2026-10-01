import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileCancelledPaystackRefundCandidateReviews } from './file-cancelled-paystack-refund-candidate-reviews';

function payment(id: string, orderId: string | null, merchantId: string) {
  return {
    amount: 100,
    gateway_reference: 'PSK-1',
    id,
    merchant_id: merchantId,
    order_id: orderId,
  };
}

function order(
  id: string,
  cancelledAt: string | null,
  shipping: string | null
) {
  return { cancelled_at: cancelledAt, id, shipping_status: shipping };
}

function cancelledOrder(id: string) {
  return order(id, '2026-09-27T00:00:00Z', 'cancelled');
}

// The orders lookup is a thenable builder: select().in() awaited directly.
function ordersQuery(data: unknown, error: unknown = null) {
  return {
    in: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
    then: (resolve: (value: unknown) => void) => resolve({ data, error }),
  };
}

const evidence = {
  providerPaymentTransactionId: 555,
  providerRefundId: 202,
  reference: 'PSK-1',
};

describe('fileCancelledPaystackRefundCandidateReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('files reviews only for candidates on cancelled orders', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'review-1', error: null });
    const from = vi.fn().mockReturnValueOnce(
      ordersQuery([
        cancelledOrder('order-1'),
        {
          cancelled_at: null,
          id: 'order-9',
          shipping_status: 'processing',
        },
      ])
    );
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await fileCancelledPaystackRefundCandidateReviews(
      supabase,
      [
        payment('pay-1', 'order-1', 'merchant-1'),
        payment('pay-9', 'order-9', 'merchant-9'),
      ],
      evidence,
      'reason'
    );

    expect(from).toHaveBeenCalledWith('orders');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({ p_order_id: 'order-1' })
    );
  });

  it('accepts the canceled spelling but requires cancelled_at', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'review-1', error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        ordersQuery([
          order('order-1', '2026-09-27T00:00:00Z', 'canceled'),
          order('order-2', null, 'cancelled'),
        ])
      );
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await fileCancelledPaystackRefundCandidateReviews(
      supabase,
      [
        payment('pay-1', 'order-1', 'merchant-1'),
        payment('pay-2', 'order-2', 'merchant-2'),
      ],
      evidence,
      'reason'
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({ p_order_id: 'order-1' })
    );
  });

  it('files nothing when no candidate is on a cancelled order', async () => {
    const rpc = vi.fn();
    const from = vi.fn().mockReturnValueOnce(
      ordersQuery([
        {
          cancelled_at: null,
          id: 'order-9',
          shipping_status: 'processing',
        },
      ])
    );
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await fileCancelledPaystackRefundCandidateReviews(
      supabase,
      [
        payment('pay-9', 'order-9', 'merchant-9'),
        payment('pay-orphan', null, 'merchant-9'),
      ],
      evidence,
      'reason'
    );

    expect(rpc).not.toHaveBeenCalled();
  });

  it('skips the order lookup entirely when no candidate has an order', async () => {
    const rpc = vi.fn();
    const from = vi.fn();
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await fileCancelledPaystackRefundCandidateReviews(
      supabase,
      [payment('pay-orphan', null, 'merchant-9')],
      evidence,
      'reason'
    );

    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('throws when the order lookup fails', async () => {
    const rpc = vi.fn();
    const from = vi
      .fn()
      .mockReturnValueOnce(ordersQuery(null, new Error('db down')));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await expect(
      fileCancelledPaystackRefundCandidateReviews(
        supabase,
        [payment('pay-1', 'order-1', 'merchant-1')],
        evidence,
        'reason'
      )
    ).rejects.toThrow('refund_event_order_lookup_failed');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('propagates review write failures for redelivery', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error('write failed') });
    const from = vi
      .fn()
      .mockReturnValueOnce(ordersQuery([cancelledOrder('order-1')]));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await expect(
      fileCancelledPaystackRefundCandidateReviews(
        supabase,
        [payment('pay-1', 'order-1', 'merchant-1')],
        evidence,
        'reason'
      )
    ).rejects.toThrow('refund_recovery_review_failed');
  });
});
