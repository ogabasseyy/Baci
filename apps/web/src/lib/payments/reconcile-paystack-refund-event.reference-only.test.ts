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
} from './reconcile-paystack-refund-event.test-helpers';

describe('Paystack reference-only refund events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('files a review when a cancelled payment has no local refund row', async () => {
    const review = buildReviewInsert();
    const from = vi
      .fn()
      .mockReturnValueOnce(buildPaymentCandidates([cancelledPaymentRow()]))
      .mockReturnValueOnce(buildRefundCandidates([]))
      .mockReturnValueOnce(review);
    const rpc = vi.fn();

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    // Polling can never rediscover a provider refund with no local row,
    // so the signed event fails closed instead of acknowledging silently.
    expect(review.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        order_id: 'order-1',
        txn_id: 'payment-1',
      })
    );
  });

  it('files stalled matches when no completed payment carries the reference', async () => {
    const completed = buildPaymentCandidates([]);
    const stalled = buildPaymentCandidates([cancelledPaymentRow()]);
    const refunds = buildRefundCandidates([]);
    const review = buildReviewInsert();
    const from = vi
      .fn()
      .mockReturnValueOnce(completed)
      .mockReturnValueOnce(stalled)
      .mockReturnValueOnce(refunds)
      .mockReturnValueOnce(review);
    const rpc = vi.fn();

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    // The refund webhook may win the race with charge completion: a
    // pending payment that later completes would leave the refunded
    // order paid and fulfillable with no trace of this signed event.
    expect(stalled.in).toHaveBeenCalledWith('status', [
      'pending',
      'processing',
      'failed',
    ]);
    expect(review.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        order_id: 'order-1',
        txn_id: 'payment-1',
      })
    );
  });

  it('skips the stalled scan when a completed payment carries the reference', async () => {
    const completed = buildPaymentCandidates([cancelledPaymentRow()]);
    const review = buildReviewInsert();
    const from = vi
      .fn()
      .mockReturnValueOnce(completed)
      .mockReturnValueOnce(buildRefundCandidates([]))
      .mockReturnValueOnce(review);
    const rpc = vi.fn();

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    expect(completed.in).not.toHaveBeenCalled();
    expect(review.insert).toHaveBeenCalled();
  });

  it('preserves the failed verdict in the reference-only review', async () => {
    const review = buildReviewInsert();
    const from = vi
      .fn()
      .mockReturnValueOnce(buildPaymentCandidates([cancelledPaymentRow()]))
      .mockReturnValueOnce(buildRefundCandidates([]))
      .mockReturnValueOnce(review);
    const rpc = vi.fn();

    await reconcilePaystackRefundEvent(
      { from, rpc } as never,
      'PSK-1',
      'failed'
    );

    // A definitively failed provider refund moved no money: the nested
    // verdict lets audit blocking exclude this leg instead of
    // stranding a later genuine cancellation behind delivery_uncertain.
    expect(review.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          refund_evidence: {
            'reference:PSK-1': expect.objectContaining({
              provider_refund_status: 'failed',
            }),
          },
        }),
      })
    );
  });

  it('paginates past the first page of payments sharing a reference', async () => {
    // Orderless rows stay silent (nothing to file against); active
    // orders now file non-cancellation evidence instead of skipping.
    const skipped = Array.from({ length: 10 }, (_, index) =>
      cancelledPaymentRow({
        id: `payment-skip-${index}`,
        order_id: null,
      })
    );
    const page1 = buildPaymentCandidates(skipped);
    const page2 = buildPaymentCandidates([cancelledPaymentRow()]);
    const refunds = buildRefundCandidates([]);
    const review = buildReviewInsert();
    const from = vi
      .fn()
      .mockReturnValueOnce(page1)
      .mockReturnValueOnce(page2)
      .mockReturnValueOnce(refunds)
      .mockReturnValueOnce(review);
    const rpc = vi.fn();

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    expect(page1.limit).toHaveBeenCalledWith(10);
    expect(page2.gt).toHaveBeenCalledWith('id', 'payment-skip-9');
    // The cancelled payment on page 2 was reached, not truncated away
    // before the caller acknowledged the event.
    expect(refunds.eq).toHaveBeenCalledWith(
      'metadata->>payment_transaction_id',
      'payment-1'
    );
    expect(review.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        order_id: 'order-1',
      })
    );
    expect(from).toHaveBeenCalledTimes(4);
  });

  it('revisits every in-flight refund past the first page', async () => {
    provider.fetchRefund.mockResolvedValue({
      data: {
        amount: 10000,
        currency: 'NGN',
        id: 42,
        status: 'processed',
        transaction: 123,
      },
      success: true,
    });
    provider.verifyTransaction.mockResolvedValue({
      data: { amount: 10000, currency: 'NGN', id: 123, reference: 'PSK-1' },
      success: true,
    });
    const rows = Array.from({ length: 11 }, (_, index) => ({
      amount: 100,
      currency: 'NGN',
      gateway_reference: '42',
      id: `refund-${index}`,
      merchant_id: 'merchant-1',
      metadata: {
        payment_transaction_id: '11111111-1111-4111-8111-111111111111',
        provider_payment_transaction_id: 123,
      },
      order_id: 'order-1',
      status: 'refund_pending',
    }));
    const refundsPage1 = buildRefundCandidates(rows.slice(0, 10));
    const refundsPage2 = buildRefundCandidates(rows.slice(10));
    const from = vi
      .fn()
      .mockReturnValueOnce(buildPaymentCandidates([cancelledPaymentRow()]))
      .mockReturnValueOnce(refundsPage1);
    for (let index = 0; index < 10; index++) {
      from.mockReturnValueOnce(buildPaymentLookup());
    }
    from
      .mockReturnValueOnce(refundsPage2)
      .mockReturnValueOnce(buildPaymentLookup());
    const rpc = vi.fn().mockResolvedValue({ data: 'processed', error: null });

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    // Reconciling moves rows out of the in-flight statuses, so the
    // second page keys off the last seen id instead of an offset.
    expect(refundsPage2.gt).toHaveBeenCalledWith('id', 'refund-9');
    expect(rpc).toHaveBeenCalledTimes(11);
    expect(rpc).toHaveBeenCalledWith(
      'record_verified_paystack_cancellation_refund_v1',
      expect.objectContaining({ p_refund_id: 'refund-10' })
    );
  });

  it('merges redelivered active-order evidence instead of duplicating it', async () => {
    const review = buildReviewInsert({ code: '23505' });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        buildPaymentCandidates([
          cancelledPaymentRow({
            cancel_order: {
              cancelled_at: null,
              order_number: 'ORD-9',
              shipping_status: 'processing',
            },
          }),
        ])
      )
      .mockReturnValueOnce(review);
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    expect(rpc).toHaveBeenCalledWith(
      'merge_provider_refund_outside_cancellation_evidence_v1',
      expect.objectContaining({
        p_evidence_key: 'payment:payment-1:unknown',
        p_order_id: 'order-1',
      })
    );
  });

  it('files for an active payment even when settled rows exist', async () => {
    const review = buildReviewInsert();
    const from = vi
      .fn()
      .mockReturnValueOnce(
        buildPaymentCandidates([
          cancelledPaymentRow({
            cancel_order: {
              cancelled_at: null,
              shipping_status: 'processing',
            },
          }),
        ])
      )
      .mockReturnValueOnce(review);
    const rpc = vi.fn();

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    // No refund ID means the event can never be tied to a recorded
    // row, so settled rows no longer suppress the review — a second
    // manual refund would otherwise hide as a presumed duplicate.
    expect(review.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'provider_refund_outside_cancellation',
        order_id: 'order-1',
      })
    );
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('files for a cancelled payment even when settled rows exist', async () => {
    const review = buildReviewInsert();
    const from = vi
      .fn()
      .mockReturnValueOnce(buildPaymentCandidates([cancelledPaymentRow()]))
      .mockReturnValueOnce(buildRefundCandidates([]))
      .mockReturnValueOnce(review);
    const rpc = vi.fn();

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    expect(review.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        order_id: 'order-1',
      })
    );
    expect(from).toHaveBeenCalledTimes(3);
  });
});
