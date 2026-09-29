import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverUnknownPaystackRefund } from './recover-unknown-paystack-refund';

const mocks = vi.hoisted(() => ({
  fetchPaystackPaymentById: vi.fn(),
  fetchRefund: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('./fetch-paystack-payment-by-id', () => ({
  fetchPaystackPaymentById: mocks.fetchPaystackPaymentById,
}));
vi.mock('./fetch-paystack-refund', () => ({
  fetchRefund: mocks.fetchRefund,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: mocks.loggerInfo, warn: vi.fn() },
}));

function payment(id: string, orderId: string, merchantId: string) {
  return {
    amount: 100,
    gateway_reference: 'PSK-1',
    id,
    merchant_id: merchantId,
    order_id: orderId,
  };
}

function cancelledOrder(id: string) {
  return {
    cancelled_at: '2026-09-27T00:00:00Z',
    id,
    shipping_status: 'cancelled',
  };
}

// The candidate queries fetch every match (no LIMIT): the builder itself
// is the terminal the double awaits.
function selectQuery(data: unknown, error: unknown = null) {
  return {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    select: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
    then: (resolve: (value: unknown) => void) => resolve({ data, error }),
  };
}

describe('recoverUnknownPaystackRefund ambiguous candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchRefund.mockResolvedValue({
      data: {
        amount: 10000,
        currency: 'NGN',
        id: 202,
        status: 'processed',
        transaction: 555,
      },
      success: true,
    });
    mocks.fetchPaystackPaymentById.mockResolvedValue({
      data: { id: 555, reference: 'PSK-1' },
      success: true,
    });
  });

  function reviewRpc(error: unknown = null) {
    return vi.fn().mockResolvedValue({ data: 'review-1', error });
  }

  it('files ambiguous reviews only for cancelled orders', async () => {
    const rpc = reviewRpc();
    const orders = [
      cancelledOrder('order-1'),
      cancelledOrder('order-2'),
      {
        cancelled_at: null,
        id: 'order-9',
        shipping_status: 'processing',
      },
    ];
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        selectQuery([
          payment('pay-1', 'order-1', 'merchant-1'),
          payment('pay-2', 'order-2', 'merchant-2'),
          payment('pay-9', 'order-9', 'merchant-9'),
        ])
      )
      .mockReturnValueOnce(selectQuery(orders))
      .mockReturnValueOnce(selectQuery(orders))
      .mockReturnValueOnce({ insert: reviewInsert });
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith(
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({ p_order_id: 'order-1' })
    );
    expect(rpc).toHaveBeenCalledWith(
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({ p_order_id: 'order-2' })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({ p_order_id: 'order-9' })
    );
    // The active match stays out of the cancellation queue but files
    // into the non-cancellation queue instead of being discarded.
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'provider_refund_outside_cancellation',
        order_id: 'order-9',
        metadata: expect.objectContaining({ provider_refund_id: 202 }),
      })
    );
  });

  it('files one review per order when three payments share the reference', async () => {
    const rpc = reviewRpc();
    const from = vi
      .fn()
      .mockReturnValueOnce(
        selectQuery([
          payment('pay-1', 'order-1', 'merchant-1'),
          payment('pay-2', 'order-2', 'merchant-2'),
          payment('pay-3', 'order-3', 'merchant-3'),
        ])
      )
      .mockReturnValueOnce(
        selectQuery([
          cancelledOrder('order-1'),
          cancelledOrder('order-2'),
          cancelledOrder('order-3'),
        ])
      )
      // Active-candidate partition finds no active orders to file.
      .mockReturnValueOnce(
        selectQuery([
          cancelledOrder('order-1'),
          cancelledOrder('order-2'),
          cancelledOrder('order-3'),
        ])
      );
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({
        p_order_id: 'order-3',
        p_merchant_id: 'merchant-3',
      })
    );
  });

  it('files every stalled match when the reference repeats on cancelled orders', async () => {
    const rpc = reviewRpc();
    const cancelled = [
      cancelledOrder('order-1'),
      cancelledOrder('order-2'),
      cancelledOrder('order-3'),
    ];
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(
        selectQuery([
          payment('pay-stalled-1', 'order-1', 'merchant-1'),
          payment('pay-stalled-2', 'order-2', 'merchant-2'),
          payment('pay-stalled-3', 'order-3', 'merchant-3'),
        ])
      )
      .mockReturnValueOnce(selectQuery(cancelled))
      .mockReturnValueOnce(selectQuery(cancelled));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('files mismatched refund evidence for review and throws for redelivery', async () => {
    mocks.fetchRefund.mockResolvedValue({
      data: {
        amount: 10000,
        currency: 'NGN',
        id: 203,
        status: 'processed',
        transaction: 555,
      },
      success: true,
    });
    const rpc = reviewRpc();
    const from = vi
      .fn()
      .mockReturnValueOnce(
        selectQuery([payment('pay-1', 'order-1', 'merchant-1')])
      )
      .mockReturnValueOnce(selectQuery([cancelledOrder('order-1')]))
      // Active-queue lookup: the order is cancelled, so the
      // non-cancellation queue files nothing.
      .mockReturnValueOnce(selectQuery([cancelledOrder('order-1')]));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await expect(
      recoverUnknownPaystackRefund(supabase, 202, 'PSK-1')
    ).rejects.toThrow('paystack_refund_evidence_invalid');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({ p_order_id: 'order-1' })
    );
  });

  it('files malformed evidence for active orders before throwing for redelivery', async () => {
    mocks.fetchRefund.mockResolvedValue({
      data: {
        amount: 12.5,
        currency: 'NGN',
        id: 202,
        status: 'processed',
        transaction: 555,
      },
      success: true,
    });
    const active = [
      {
        cancelled_at: null,
        id: 'order-9',
        order_number: 'ORD-9',
        shipping_status: 'processing',
      },
    ];
    const rpc = reviewRpc();
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        selectQuery([payment('pay-9', 'order-9', 'merchant-9')])
      )
      .mockReturnValueOnce(selectQuery(active))
      .mockReturnValueOnce(selectQuery(active))
      .mockReturnValueOnce({ insert: reviewInsert });
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await expect(
      recoverUnknownPaystackRefund(supabase, 202, 'PSK-1')
    ).rejects.toThrow('paystack_refund_evidence_invalid');

    // The cancellation queue drops the active order, so without the
    // non-cancellation filing the evidence would vanish with the last
    // provider retry while the order stays paid and fulfillable.
    expect(rpc).not.toHaveBeenCalled();
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'provider_refund_outside_cancellation',
        merchant_id: 'merchant-9',
        order_id: 'order-9',
        metadata: expect.objectContaining({ provider_refund_id: 202 }),
        reason: expect.stringContaining('unusable provider evidence'),
      })
    );
  });

  it('throws when malformed evidence matches no local payment', async () => {
    mocks.fetchRefund.mockResolvedValue({
      data: {
        amount: 12.5,
        currency: 'NGN',
        id: 202,
        status: 'processed',
        transaction: 555,
      },
      success: true,
    });
    const rpc = reviewRpc();
    const from = vi.fn().mockReturnValueOnce(selectQuery([]));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await expect(
      recoverUnknownPaystackRefund(supabase, 202, 'PSK-1')
    ).rejects.toThrow('paystack_refund_evidence_unmatched');

    expect(rpc).not.toHaveBeenCalled();
  });

  it('files stalled matches on active orders into the non-cancellation queue', async () => {
    const rpc = reviewRpc();
    const active = [
      {
        cancelled_at: null,
        id: 'order-9',
        order_number: 'ORD-9',
        shipping_status: 'processing',
      },
    ];
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(
        selectQuery([payment('pay-stalled', 'order-9', 'merchant-9')])
      )
      .mockReturnValueOnce(selectQuery(active))
      .mockReturnValueOnce(selectQuery(active))
      .mockReturnValueOnce({ insert: reviewInsert });
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    // Withheld from the cancellation queue so it cannot absorb a future
    // genuine cancellation's evidence — but retained for operations, or
    // a later charge recovery could mark the refunded order paid.
    expect(rpc).not.toHaveBeenCalled();
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'provider_refund_outside_cancellation',
        merchant_id: 'merchant-9',
        order_id: 'order-9',
        metadata: expect.objectContaining({ provider_refund_id: 202 }),
      })
    );
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ refundId: 202 })
    );
  });
});
