import { beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
  fetchRefund: vi.fn(),
  verifyTransaction: vi.fn(),
}));
vi.mock('@/lib/verify-paystack-transaction', () => ({
  verifyTransaction: provider.verifyTransaction,
}));
vi.mock('./fetch-paystack-refund', () => ({
  fetchRefund: provider.fetchRefund,
}));

import { reconcilePaystackRefundEvent } from './reconcile-paystack-refund-event';
import {
  buildPaymentCandidates,
  buildPaymentLookup,
  buildRefundCandidates,
  buildReviewInsert,
  cancelledPaymentRow,
  REFUND_FIXTURE,
} from './reconcile-paystack-refund-event.test-helpers';

describe('Paystack cancellation refund mismatch evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provider.fetchRefund.mockResolvedValue({
      success: true,
      data: {
        id: 42,
        transaction: 123,
        amount: 10000,
        currency: 'NGN',
        status: 'processed',
      },
    });
    provider.verifyTransaction.mockResolvedValue({
      success: true,
      data: { id: 123, reference: 'PSK-1', amount: 10000, currency: 'NGN' },
    });
  });

  it('files a mismatched refund and continues to a second refund in one webhook', async () => {
    const refund2 = {
      ...REFUND_FIXTURE,
      id: 'refund-2',
      gateway_reference: '43',
    };
    const paymentLookup = buildPaymentLookup();
    const review = buildReviewInsert();
    const from = vi
      .fn()
      .mockReturnValueOnce(buildPaymentCandidates([cancelledPaymentRow()]))
      .mockReturnValueOnce(buildRefundCandidates([REFUND_FIXTURE, refund2]))
      .mockReturnValueOnce(paymentLookup)
      .mockReturnValueOnce(review)
      .mockReturnValueOnce(paymentLookup);
    const rpc = vi.fn((name: string) =>
      Promise.resolve({
        data:
          name === 'hold_paystack_cancellation_refund_for_review_v1'
            ? true
            : 'processed',
        error: null,
      })
    );
    provider.fetchRefund
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 42,
          transaction: 999,
          amount: 10000,
          currency: 'NGN',
          status: 'processed',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 43,
          transaction: 123,
          amount: 10000,
          currency: 'NGN',
          status: 'processed',
        },
      });
    await expect(
      reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1')
    ).resolves.toBeUndefined();
    expect(review.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        txn_id: 'refund-1',
        issue_type: 'order_cancellation_refund_requires_review',
      })
    );
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith(
      'hold_paystack_cancellation_refund_for_review_v1',
      { p_refund_id: 'refund-1', p_reason: 'paystack_refund_evidence_mismatch' }
    );
    expect(rpc).toHaveBeenCalledWith(
      'record_verified_paystack_cancellation_refund_v1',
      expect.objectContaining({ p_refund_id: 'refund-2' })
    );
  });

  it('merges duplicate mismatch evidence without replacing an existing review', async () => {
    const review = {
      ...buildReviewInsert({ code: '23505' }),
      update: vi.fn(),
    };
    const from = vi
      .fn()
      .mockReturnValueOnce(buildPaymentCandidates([cancelledPaymentRow()]))
      .mockReturnValueOnce(buildRefundCandidates([REFUND_FIXTURE]))
      .mockReturnValueOnce(buildPaymentLookup())
      .mockReturnValueOnce(review);
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    provider.fetchRefund.mockResolvedValueOnce({
      success: true,
      data: {
        id: 42,
        transaction: 999,
        amount: 10000,
        currency: 'NGN',
        status: 'processed',
      },
    });

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_review_v1',
      {
        p_order_id: 'order-1',
        p_merchant_id: 'merchant-1',
        p_refund_id: 'refund-1',
        p_reason: 'paystack_refund_evidence_mismatch',
      }
    );
    expect(review.update).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      'hold_paystack_cancellation_refund_for_review_v1',
      { p_refund_id: 'refund-1', p_reason: 'paystack_refund_evidence_mismatch' }
    );
  });

  it('reconciles references with dots and equals signs', async () => {
    const paymentCandidates = buildPaymentCandidates([]);
    const from = vi.fn().mockReturnValueOnce(paymentCandidates);
    const rpc = vi.fn();

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK.1=x');

    expect(from).toHaveBeenCalledWith('transactions');
    expect(paymentCandidates.eq).toHaveBeenCalledWith(
      'gateway_reference',
      'PSK.1=x'
    );
  });

  it.each([
    { cancelled_at: null, shipping_status: 'cancelled' },
    {
      cancelled_at: '2026-09-27T00:00:00Z',
      shipping_status: 'delivered',
    },
    null,
  ])('skips payments whose order is not cancelled (%s)', async (cancelOrder) => {
    const paymentCandidates = buildPaymentCandidates([
      cancelledPaymentRow({ cancel_order: cancelOrder }),
    ]);
    const from = vi.fn().mockReturnValueOnce(paymentCandidates);
    const rpc = vi.fn();

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    expect(from).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ignores references outside the shared alphabet', async () => {
    const from = vi.fn();
    const rpc = vi.fn();

    await reconcilePaystackRefundEvent(
      { from, rpc } as never,
      'bad reference!'
    );

    expect(from).not.toHaveBeenCalled();
  });
});
