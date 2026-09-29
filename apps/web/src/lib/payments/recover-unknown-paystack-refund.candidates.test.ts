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
    const from = vi
      .fn()
      .mockReturnValueOnce(
        selectQuery([
          payment('pay-1', 'order-1', 'merchant-1'),
          payment('pay-2', 'order-2', 'merchant-2'),
          payment('pay-9', 'order-9', 'merchant-9'),
        ])
      )
      .mockReturnValueOnce(
        selectQuery([
          cancelledOrder('order-1'),
          cancelledOrder('order-2'),
          {
            cancelled_at: null,
            id: 'order-9',
            shipping_status: 'processing',
          },
        ])
      );
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

  it('withholds stalled matches on active orders from the cancellation queue', async () => {
    const rpc = reviewRpc();
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(
        selectQuery([payment('pay-stalled', 'order-9', 'merchant-9')])
      )
      .mockReturnValueOnce(
        selectQuery([
          { cancelled_at: null, id: 'order-9', shipping_status: 'processing' },
        ])
      );
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ refundId: 202 })
    );
  });
});
