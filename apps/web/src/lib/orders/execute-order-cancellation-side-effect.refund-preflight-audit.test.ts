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

describe('cancellation refund preflight audit matching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('withholds audit-blocked legs while clean legs still initiate', async () => {
    const auditSelect = vi.fn().mockReturnThis();
    const auditEq = vi.fn().mockReturnThis();
    const auditIn = vi.fn().mockReturnThis();
    const auditIs = vi.fn().mockResolvedValue({
      data: [
        {
          candidates: [
            {
              gatewayReference: 'PSK-1',
              paymentTransactionId: 'payment-1',
            },
          ],
          issue_type: 'order_cancellation_refund_requires_review',
          metadata: {
            audit_record_failed: true,
            payment_transaction_id: 'payment-1',
            reference_only_refund_event: true,
          },
          txn_id: 'payment-1',
        },
      ],
      error: null,
    });
    const refundInsert = vi.fn().mockResolvedValue({ error: null });
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 60,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'PSK-1',
            id: 'payment-1',
            status: 'completed',
          },
          {
            amount: 40,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'PSK-2',
            id: 'payment-2',
            status: 'completed',
          },
        ])
      )
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce({
        eq: auditEq,
        in: auditIn,
        is: auditIs,
        select: auditSelect,
      })
      .mockReturnValueOnce({ insert: refundInsert })
      .mockReturnValueOnce({ insert: reviewInsert });
    mocks.initiateRefund.mockResolvedValue({
      data: {
        id: 101,
        status: 'pending',
        transaction: { id: 55, reference: 'PSK-2' },
      },
      success: true,
    });

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: { from } as never,
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);

    // Only unresolved cancellation and outside-cancellation reviews for
    // this order gate initiation.
    expect(auditSelect).toHaveBeenCalledWith(
      'candidates, issue_type, metadata, txn_id'
    );
    expect(auditIn).toHaveBeenCalledWith('issue_type', [
      'order_cancellation_refund_requires_review',
      'provider_refund_outside_cancellation',
    ]);
    expect(auditEq).toHaveBeenCalledWith('order_id', 'order-1');
    expect(auditEq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(auditIs).toHaveBeenCalledWith('resolved_at', null);
    // The blocked leg never reaches the provider; the clean leg does.
    expect(mocks.initiateRefund).toHaveBeenCalledTimes(1);
    expect(mocks.initiateRefund).toHaveBeenCalledWith(
      'PSK-2',
      4000,
      expect.any(String),
      undefined
    );
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ audit_blocked_leg_count: 1 }),
        reason: expect.stringContaining('no verified local audit row'),
        txn_id: 'payment-1',
      })
    );
  });

  it('matches audit-blocked legs by merged candidate evidence', async () => {
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
            candidates: [{ paymentTransactionId: 'payment-1' }],
            issue_type: 'order_cancellation_refund_requires_review',
            metadata: { audit_record_failed: true },
            txn_id: 'unrelated-txn',
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

  it('matches audit-blocked legs by snake-case recovery candidates', async () => {
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
            // Recovery reviews leave txn_id unset and store
            // candidates in snake_case.
            candidates: [
              {
                amount: 100,
                gateway_reference: 'PSK-1',
                order_id: 'order-1',
                payment_transaction_id: 'payment-1',
              },
            ],
            issue_type: 'order_cancellation_refund_requires_review',
            metadata: {
              audit_record_failed: true,
              provider_refund_id: 202,
              recovered_from_provider_event: true,
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
