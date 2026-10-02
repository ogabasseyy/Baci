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
      // Default empty page: the trailing stalled-states pass runs after
      // every completed pass; staged pages take precedence.
      .mockReturnValue(buildPaymentCandidates([]))
      .mockReturnValueOnce(buildPaymentCandidates([cancelledPaymentRow()]))
      .mockReturnValueOnce(buildRefundCandidates([]))
      .mockReturnValueOnce(review);
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

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

  it('reconciles a shared-reference payment stored with legacy casing', async () => {
    const candidates = buildPaymentCandidates([
      cancelledPaymentRow({ gateway: ' Paystack ' }),
    ]);
    const review = buildReviewInsert();
    const from = vi
      .fn()
      .mockReturnValue(buildPaymentCandidates([]))
      .mockReturnValueOnce(candidates)
      .mockReturnValueOnce(buildRefundCandidates([]))
      .mockReturnValueOnce(review);
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    expect(candidates.ilike).toHaveBeenCalledWith('gateway', '%paystack%');
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
      // Default empty page: the trailing stalled-states pass runs after
      // every completed pass; staged pages take precedence.
      .mockReturnValue(buildPaymentCandidates([]))
      .mockReturnValueOnce(completed)
      .mockReturnValueOnce(stalled)
      .mockReturnValueOnce(refunds)
      .mockReturnValueOnce(review);
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

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

  it('opens the reference watch when both passes find nothing actionable', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const from = vi.fn().mockReturnValue(buildPaymentCandidates([]));
    const supabase = { from, rpc } as never;

    await reconcilePaystackRefundEvent(supabase, 'PSK-1', 'processed');

    // A payment pending during the completed scan may have completed
    // before the stalled scan ran: the atomic open-plus-rescan hands
    // the race to the completion path instead of acknowledging with
    // no durable trace. The watch stays open on an empty rescan.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'open_paystack_refund_reference_watch_v1',
      {
        p_evidence: {
          provider_refund_status: 'processed',
          reference_only: true,
        },
        p_paystack_ref: 'PSK-1',
      }
    );
  });

  it('files late rows from the confirming rescan and resolves the watch', async () => {
    const review = buildReviewInsert();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [cancelledPaymentRow()],
        error: null,
      })
      .mockResolvedValue({ data: true, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(buildPaymentCandidates([]))
      .mockReturnValueOnce(buildPaymentCandidates([]))
      .mockReturnValueOnce(buildRefundCandidates([]))
      .mockReturnValueOnce(review);
    const supabase = { from, rpc } as never;

    await reconcilePaystackRefundEvent(supabase, 'PSK-1', 'processed');

    // The payment completed between the passes: the confirming
    // rescan caught it, its evidence is filed, and the watch
    // resolves so a later completion cannot claim it.
    expect(review.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        order_id: 'order-1',
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'resolve_paystack_refund_reference_watch_v1',
      { p_paystack_ref: 'PSK-1' }
    );
  });

  it('rescans under the lock even when the passes handled matches', async () => {
    const completed = buildPaymentCandidates([cancelledPaymentRow()]);
    const completedReview = buildReviewInsert();
    const lateReview = buildReviewInsert();
    const lateRow = cancelledPaymentRow({
      id: 'payment-9',
      order_id: 'order-9',
    });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [cancelledPaymentRow(), lateRow],
        error: null,
      })
      .mockResolvedValue({ data: true, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(completed)
      .mockReturnValueOnce(buildRefundCandidates([]))
      .mockReturnValueOnce(completedReview)
      .mockReturnValueOnce(buildPaymentCandidates([]))
      .mockReturnValueOnce(buildRefundCandidates([]))
      .mockReturnValueOnce(lateReview);
    const supabase = { from, rpc } as never;

    await reconcilePaystackRefundEvent(supabase, 'PSK-1', 'processed');

    // The completed pass handled payment-1, but a second payment may
    // have completed between the passes: the locked rescan still
    // runs, skips the handled row, files the fresh one, and resolves.
    expect(rpc).toHaveBeenCalledWith(
      'open_paystack_refund_reference_watch_v1',
      expect.objectContaining({ p_paystack_ref: 'PSK-1' })
    );
    expect(completedReview.insert).toHaveBeenCalledTimes(1);
    expect(lateReview.insert).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'order-9' })
    );
    expect(rpc).toHaveBeenCalledWith(
      'resolve_paystack_refund_reference_watch_v1',
      { p_paystack_ref: 'PSK-1' }
    );
  });

  it('runs the stalled pass alongside completed matches', async () => {
    const completed = buildPaymentCandidates([cancelledPaymentRow()]);
    const stalled = buildPaymentCandidates([
      cancelledPaymentRow({ id: 'payment-2', order_id: 'order-2' }),
    ]);
    const completedReview = buildReviewInsert();
    const stalledReview = buildReviewInsert();
    const from = vi
      .fn()
      .mockReturnValueOnce(completed)
      .mockReturnValueOnce(buildRefundCandidates([]))
      .mockReturnValueOnce(completedReview)
      .mockReturnValueOnce(stalled)
      .mockReturnValueOnce(buildRefundCandidates([]))
      .mockReturnValueOnce(stalledReview);
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    // A completed match does not prove there are no additional
    // in-flight matches: the stalled row gets its own durable
    // evidence instead of being skipped behind the completed pass.
    expect(stalled.in).toHaveBeenCalledWith('status', [
      'pending',
      'processing',
      'failed',
    ]);
    expect(completedReview.insert).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'order-1' })
    );
    expect(stalledReview.insert).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'order-2' })
    );
  });

  it('preserves the failed verdict in the reference-only review', async () => {
    const review = buildReviewInsert();
    const from = vi
      .fn()
      // Default empty page: the trailing stalled-states pass runs after
      // every completed pass; staged pages take precedence.
      .mockReturnValue(buildPaymentCandidates([]))
      .mockReturnValueOnce(buildPaymentCandidates([cancelledPaymentRow()]))
      .mockReturnValueOnce(buildRefundCandidates([]))
      .mockReturnValueOnce(review);
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

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
      // Default empty page: the trailing stalled-states pass runs after
      // every completed pass; staged pages take precedence.
      .mockReturnValue(buildPaymentCandidates([]))
      .mockReturnValueOnce(page1)
      .mockReturnValueOnce(page2)
      .mockReturnValueOnce(refunds)
      .mockReturnValueOnce(review);
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

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
    expect(from).toHaveBeenCalledTimes(5);
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
      // Default empty page: the trailing stalled-states pass runs after
      // every completed pass; staged pages take precedence.
      .mockReturnValue(buildPaymentCandidates([]))
      .mockReturnValueOnce(buildPaymentCandidates([cancelledPaymentRow()]))
      .mockReturnValueOnce(refundsPage1);
    for (let index = 0; index < 10; index++) {
      from.mockReturnValueOnce(buildPaymentLookup());
    }
    from
      .mockReturnValueOnce(refundsPage2)
      .mockReturnValueOnce(buildPaymentLookup());
    const rpc = vi.fn((name: string) =>
      Promise.resolve({
        data:
          name === 'open_paystack_refund_reference_watch_v1' ? [] : 'processed',
        error: null,
      })
    );

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    // Reconciling moves rows out of the in-flight statuses, so the
    // second page keys off the last seen id instead of an offset.
    expect(refundsPage2.gt).toHaveBeenCalledWith('id', 'refund-9');
    // Ten verifications plus the trailing atomic open-and-rescan,
    // which runs even when the passes handled matches.
    expect(rpc).toHaveBeenCalledTimes(12);
    expect(rpc).toHaveBeenCalledWith(
      'record_verified_paystack_cancellation_refund_v1',
      expect.objectContaining({ p_refund_id: 'refund-10' })
    );
  });

  it('merges redelivered active-order evidence instead of duplicating it', async () => {
    const review = buildReviewInsert({ code: '23505' });
    const from = vi
      .fn()
      // Default empty page: the trailing stalled-states pass runs after
      // every completed pass; staged pages take precedence.
      .mockReturnValue(buildPaymentCandidates([]))
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
    const rpc = vi.fn((name: string) =>
      Promise.resolve({
        data: name === 'open_paystack_refund_reference_watch_v1' ? [] : true,
        error: null,
      })
    );

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
      // Default empty page: the trailing stalled-states pass runs after
      // every completed pass; staged pages take precedence.
      .mockReturnValue(buildPaymentCandidates([]))
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
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

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
    expect(from).toHaveBeenCalledTimes(3);
  });

  it('files for a cancelled payment even when settled rows exist', async () => {
    const review = buildReviewInsert();
    const from = vi
      .fn()
      // Default empty page: the trailing stalled-states pass runs after
      // every completed pass; staged pages take precedence.
      .mockReturnValue(buildPaymentCandidates([]))
      .mockReturnValueOnce(buildPaymentCandidates([cancelledPaymentRow()]))
      .mockReturnValueOnce(buildRefundCandidates([]))
      .mockReturnValueOnce(review);
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    expect(review.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        order_id: 'order-1',
      })
    );
    expect(from).toHaveBeenCalledTimes(4);
  });
});
