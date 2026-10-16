import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initiateRefund: vi.fn(),
}));

vi.mock('@/lib/orders/check-cancellation-refund-provider', () => ({
  checkCancellationRefundProvider: vi.fn().mockResolvedValue([]),
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

describe('cancellation refund preflight audit evidence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ignores cancellation reviews without audit-failed evidence', async () => {
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
            metadata: {},
            txn_id: 'payment-1',
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

  it('fails closed when the audit-evidence lookup fails', async () => {
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
      .mockReturnValueOnce({
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        is: vi
          .fn()
          .mockResolvedValue({ data: null, error: new Error('db down') }),
        select: vi.fn().mockReturnThis(),
      });

    const error = await executeOrderCancellationSideEffect({
      merchant,
      order,
      step: 'refund',
      supabase: { from } as never,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'Unable to verify refund evidence reviews'
    );
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
  });

  it('blocks legs with unresolved outside-cancellation refund evidence', async () => {
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
            // Verified while the order was active: no audit-failed
            // marker anywhere, but the provider refund may already
            // have reached the customer.
            candidates: [
              {
                amount: 100,
                gateway_reference: 'PSK-1',
                order_id: 'order-1',
                payment_transaction_id: 'payment-1',
              },
            ],
            issue_type: 'provider_refund_outside_cancellation',
            metadata: {
              payment_transaction_id: 'payment-1',
              provider_payment_transaction_id: 555,
              provider_refund_id: 202,
              refund_evidence: {
                'provider:202': {
                  payment_transaction_id: 'payment-1',
                  provider_payment_transaction_id: 555,
                  provider_refund_status: 'processed',
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
      expect.objectContaining({
        reason: expect.stringContaining('no verified local audit row'),
        txn_id: 'payment-1',
      })
    );
  });
});
