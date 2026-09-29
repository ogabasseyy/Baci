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
  buildRefundCandidates,
  buildReviewInsert,
  buildSettledCandidates,
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
      .mockReturnValueOnce(buildSettledCandidates([]))
      .mockReturnValueOnce(
        buildSettledCandidates([
          { amount: 100, gateway: 'paystack' },
          { amount: 50, gateway: 'korapay' },
        ])
      )
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

  it('paginates past the first page of payments sharing a reference', async () => {
    const skipped = Array.from({ length: 10 }, (_, index) =>
      cancelledPaymentRow({
        cancel_order: { cancelled_at: null, shipping_status: 'processing' },
        id: `payment-skip-${index}`,
        order_id: `order-skip-${index}`,
      })
    );
    const page1 = buildPaymentCandidates(skipped);
    const page2 = buildPaymentCandidates([cancelledPaymentRow()]);
    const refunds = buildRefundCandidates([]);
    const from = vi
      .fn()
      .mockReturnValueOnce(page1)
      .mockReturnValueOnce(page2)
      .mockReturnValueOnce(refunds)
      .mockReturnValueOnce(
        buildSettledCandidates([
          {
            amount: 100,
            currency: 'NGN',
            metadata: { provider_refund_status: 'processed' },
          },
        ])
      );
    const rpc = vi.fn();

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    expect(page1.range).toHaveBeenCalledWith(0, 9);
    expect(page2.range).toHaveBeenCalledWith(10, 19);
    // The cancelled payment on page 2 was reached, not truncated away
    // before the caller acknowledged the event.
    expect(refunds.eq).toHaveBeenCalledWith(
      'metadata->>payment_transaction_id',
      'payment-1'
    );
    expect(from).toHaveBeenCalledTimes(4);
  });

  it('stays silent when a completed row already reconciled the payment', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(buildPaymentCandidates([cancelledPaymentRow()]))
      .mockReturnValueOnce(buildRefundCandidates([]))
      .mockReturnValueOnce(
        buildSettledCandidates([
          {
            amount: 100,
            currency: 'NGN',
            metadata: { provider_refund_status: 'processed' },
          },
        ])
      );
    const rpc = vi.fn();

    await reconcilePaystackRefundEvent({ from, rpc } as never, 'PSK-1');

    expect(from).toHaveBeenCalledTimes(3);
    expect(rpc).not.toHaveBeenCalled();
  });
});
