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

const refund = {
  id: 'refund-1',
  order_id: 'order-1',
  merchant_id: 'merchant-1',
  gateway_reference: '42',
  amount: 100,
  currency: 'NGN',
  metadata: {
    payment_transaction_id: 'payment-1',
    provider_payment_transaction_id: 123,
  },
  status: 'refund_pending',
};

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
      ...refund,
      id: 'refund-2',
      gateway_reference: '43',
    };
    const paymentLookup = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'payment-1',
          order_id: 'order-1',
          merchant_id: 'merchant-1',
          gateway_reference: 'PSK-1',
          amount: 100,
          currency: 'NGN',
          status: 'completed',
        },
        error: null,
      }),
    };
    const paymentCandidates = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [
          { id: 'payment-1', order_id: 'order-1', merchant_id: 'merchant-1' },
        ],
        error: null,
      }),
    };
    const refundCandidates = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue({ data: [refund, refund2], error: null }),
    };
    const review = { insert: vi.fn().mockResolvedValue({ error: null }) };
    const from = vi
      .fn()
      .mockReturnValueOnce(paymentCandidates)
      .mockReturnValueOnce(refundCandidates)
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
    const paymentCandidates = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [
          { id: 'payment-1', order_id: 'order-1', merchant_id: 'merchant-1' },
        ],
        error: null,
      }),
    };
    const refundCandidates = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [refund], error: null }),
    };
    const paymentLookup = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'payment-1',
          gateway_reference: 'PSK-1',
          amount: 100,
          currency: 'NGN',
          status: 'completed',
        },
        error: null,
      }),
    };
    const review = {
      insert: vi.fn().mockResolvedValue({ error: { code: '23505' } }),
      update: vi.fn(),
    };
    const from = vi
      .fn()
      .mockReturnValueOnce(paymentCandidates)
      .mockReturnValueOnce(refundCandidates)
      .mockReturnValueOnce(paymentLookup)
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
});
