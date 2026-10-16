import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initiateRefund: vi.fn(),
}));

vi.mock('@/lib/orders/check-cancellation-refund-provider', () => ({
  checkCancellationRefundProvider: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: mocks.initiateRefund,
}));
vi.mock('@/lib/orders/build-order-cancellation-email-message', () => ({
  buildOrderCancellationEmailMessage: vi.fn(),
}));

import { executeOrderCancellationSideEffect } from './execute-order-cancellation-side-effect';
import { auditReviewsQuery } from './execute-order-cancellation-side-effect.test-support';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

const merchant = {
  business_name: 'Store',
  cac_rc_number: null,
  email: 'store@example.com',
  email_sender_name: null,
  id: 'merchant-1',
  slug: 'store',
  support_email: null,
  tax_identification_number: null,
};
const order = {
  amount_paid: 100,
  currency: 'NGN',
  customer_email: 'buyer@example.com',
  customer_id: null,
  customer_name: 'Buyer',
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_items: [],
  order_number: 'ORD-1',
  payment_status: 'paid',
  total: 100,
};

function transactionQuery(data: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn().mockReturnThis(),
  };
}

describe('cancellation refund preflight nested audit evidence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks legs named only by nested merged audit evidence', async () => {
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'PSK-1',
            id: 'payment-1',
            status: 'completed',
          },
        ])
      )
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce(
        auditReviewsQuery([
          {
            // Recovery merged into a review without the top-level
            // marker: the evidence lives only in the nested entry.
            candidates: [],
            issue_type: 'order_cancellation_refund_requires_review',
            metadata: {
              refund_evidence: {
                'provider:202': {
                  audit_record_failed: true,
                  payment_transaction_id: 'payment-1',
                },
              },
            },
            txn_id: null,
          },
        ])
      )
      .mockReturnValueOnce({ insert: reviewInsert });

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: { from } as never,
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);

    expect(mocks.initiateRefund).not.toHaveBeenCalled();
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({ txn_id: 'payment-1' })
    );
  });

  it('ignores nested evidence whose audit marker is not set', async () => {
    const refundInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'PSK-1',
            id: 'payment-1',
            status: 'completed',
          },
        ])
      )
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce(
        auditReviewsQuery([
          {
            candidates: [],
            issue_type: 'order_cancellation_refund_requires_review',
            metadata: {
              refund_evidence: {
                'provider:202': {
                  payment_transaction_id: 'payment-1',
                },
              },
            },
            txn_id: null,
          },
        ])
      )
      .mockReturnValueOnce({ insert: refundInsert });
    mocks.initiateRefund.mockResolvedValue({
      data: {
        id: 101,
        status: 'pending',
        transaction: { id: 55, reference: 'PSK-1' },
      },
      success: true,
    });

    const result = await executeOrderCancellationSideEffect({
      merchant,
      order,
      step: 'refund',
      supabase: { from } as never,
    });

    expect(result).toEqual({ refundIds: [101] });
    expect(mocks.initiateRefund).toHaveBeenCalledTimes(1);
  });
});
