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

// The candidate queries paginate every match in stable id order: the
// range terminal resolves one page per staged query.
function selectQuery(data: unknown, error: unknown = null) {
  return {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data, error }),
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

  it('files every order when matches span more than one page', async () => {
    const rpc = reviewRpc();
    const payments = Array.from({ length: 11 }, (_, index) =>
      payment(`pay-${index + 1}`, `order-${index + 1}`, `merchant-${index + 1}`)
    );
    const orders = Array.from({ length: 11 }, (_, index) =>
      cancelledOrder(`order-${index + 1}`)
    );
    const firstPage = selectQuery([]);
    const firstRange = vi
      .fn()
      .mockResolvedValue({ data: payments.slice(0, 10), error: null });
    firstPage.range = firstRange;
    const secondPage = selectQuery([]);
    const secondRange = vi
      .fn()
      .mockResolvedValue({ data: payments.slice(10), error: null });
    secondPage.range = secondRange;
    const from = vi
      .fn()
      .mockReturnValueOnce({ select: vi.fn(() => firstPage) })
      .mockReturnValueOnce({ select: vi.fn(() => secondPage) })
      .mockReturnValueOnce(selectQuery(orders))
      .mockReturnValueOnce(selectQuery(orders));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    // A corrupt reference shared past the response cap must still file
    // every order: truncating after the first page would drop the
    // eleventh order's verified evidence after acknowledgement.
    expect(firstRange).toHaveBeenCalledWith(0, 9);
    expect(secondRange).toHaveBeenCalledWith(10, 19);
    expect(rpc).toHaveBeenCalledTimes(11);
    for (let index = 1; index <= 11; index++) {
      expect(rpc).toHaveBeenCalledWith(
        'file_paystack_refund_recovery_review_v1',
        expect.objectContaining({ p_order_id: `order-${index}` })
      );
    }
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

  it('files every order when stalled matches span more than one page', async () => {
    const rpc = reviewRpc();
    const stalled = Array.from({ length: 11 }, (_, index) =>
      payment(
        `pay-stalled-${index + 1}`,
        `order-${index + 1}`,
        `merchant-${index + 1}`
      )
    );
    const orders = Array.from({ length: 11 }, (_, index) =>
      cancelledOrder(`order-${index + 1}`)
    );
    const firstStalled = selectQuery([]);
    const firstStalledRange = vi
      .fn()
      .mockResolvedValue({ data: stalled.slice(0, 10), error: null });
    firstStalled.range = firstStalledRange;
    const secondStalled = selectQuery([]);
    const secondStalledRange = vi
      .fn()
      .mockResolvedValue({ data: stalled.slice(10), error: null });
    secondStalled.range = secondStalledRange;
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce({ select: vi.fn(() => firstStalled) })
      .mockReturnValueOnce({ select: vi.fn(() => secondStalled) })
      .mockReturnValueOnce(selectQuery(orders))
      .mockReturnValueOnce(selectQuery(orders));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    // A legacy reference shared past the response cap must still file
    // every stalled order: the webhook is acknowledged, so a truncated
    // subset would permanently drop the omitted verified evidence.
    expect(firstStalledRange).toHaveBeenCalledWith(0, 9);
    expect(secondStalledRange).toHaveBeenCalledWith(10, 19);
    expect(rpc).toHaveBeenCalledTimes(11);
    for (let index = 1; index <= 11; index++) {
      expect(rpc).toHaveBeenCalledWith(
        'file_paystack_refund_recovery_review_v1',
        expect.objectContaining({ p_order_id: `order-${index}` })
      );
    }
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

  it('keeps every payment leg when one active order has several candidates', async () => {
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
      .mockReturnValueOnce(
        selectQuery([
          payment('pay-1', 'order-9', 'merchant-9'),
          payment('pay-2', 'order-9', 'merchant-9'),
        ])
      )
      .mockReturnValueOnce(selectQuery(active))
      .mockReturnValueOnce(selectQuery(active))
      .mockReturnValueOnce({ insert: reviewInsert });
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    // One review for the order, but both candidate legs retained: the
    // webhook is acknowledged, so a dropped leg would vanish from the
    // evidence ops uses to route the verified refund.
    expect(rpc).not.toHaveBeenCalled();
    expect(reviewInsert).toHaveBeenCalledTimes(1);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'provider_refund_outside_cancellation',
        order_id: 'order-9',
        candidates: [
          expect.objectContaining({ payment_transaction_id: 'pay-1' }),
          expect.objectContaining({ payment_transaction_id: 'pay-2' }),
        ],
        metadata: expect.objectContaining({
          provider_refund_id: 202,
          refund_evidence: expect.objectContaining({
            'provider:202': expect.objectContaining({
              candidate_payment_transaction_ids: ['pay-1', 'pay-2'],
            }),
          }),
        }),
      })
    );
  });
});
