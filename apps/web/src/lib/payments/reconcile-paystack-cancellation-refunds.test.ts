import { beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
  fetchRefund: vi.fn(),
  verifyTransaction: vi.fn(),
}));
vi.mock('@/lib/paystack', () => provider);

import {
  reconcilePaystackCancellationRefund,
  reconcilePaystackRefundEvent,
} from './reconcile-paystack-cancellation-refunds';

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
  status: 'pending',
};

function database() {
  const payment = {
    id: 'payment-1',
    order_id: 'order-1',
    merchant_id: 'merchant-1',
    gateway_reference: 'PSK-1',
    amount: 100,
    currency: 'NGN',
    status: 'completed',
  };
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: payment, error: null }),
  };
  return {
    from: vi.fn(() => query),
    rpc: vi.fn().mockResolvedValue({ data: 'processed', error: null }),
  };
}

describe('Paystack cancellation refund reconciliation', () => {
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
      data: { id: 123, reference: 'PSK-1', currency: 'NGN' },
    });
  });

  it('records a processed refund only after matching its original payment', async () => {
    const db = database();
    await expect(
      reconcilePaystackCancellationRefund(db as never, refund)
    ).resolves.toBe('updated');
    expect(db.rpc).toHaveBeenCalledWith(
      'record_verified_paystack_cancellation_refund_v1',
      expect.objectContaining({
        p_refund_id: 'refund-1',
        p_provider_status: 'processed',
        p_provider_transaction_id: 123,
        p_amount_kobo: 10000,
      })
    );
  });

  it('does not complete a refund linked to a different Paystack payment', async () => {
    const db = database();
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
    await expect(
      reconcilePaystackCancellationRefund(db as never, refund)
    ).rejects.toThrow('paystack_refund_evidence_mismatch');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('does not complete a refund whose amount changed', async () => {
    const db = database();
    provider.fetchRefund.mockResolvedValueOnce({
      success: true,
      data: {
        id: 42,
        transaction: 123,
        amount: 9000,
        currency: 'NGN',
        status: 'processed',
      },
    });
    await expect(
      reconcilePaystackCancellationRefund(db as never, refund)
    ).rejects.toThrow('paystack_refund_evidence_mismatch');
    expect(db.rpc).not.toHaveBeenCalled();
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
});
