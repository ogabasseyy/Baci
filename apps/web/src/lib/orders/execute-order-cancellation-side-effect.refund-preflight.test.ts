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
import {
  DeferredError,
  DeliveryUncertainError,
} from './run-order-cancellation-side-effect';

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

describe('cancellation refund preflight quarantine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('files unsupported gateways for manual reconciliation without retries', async () => {
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const paymentQuery = transactionQuery([
      {
        amount: 75,
        currency: 'NGN',
        gateway: 'korapay',
        gateway_reference: 'kora-ref',
        id: 'payment-2',
      },
    ]);
    const from = vi
      .fn()
      .mockReturnValueOnce(paymentQuery)
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce(auditReviewsQuery([]))
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
        issue_type: 'order_cancellation_refund_requires_review',
        merchant_id: 'merchant-1',
        order_id: 'order-1',
        txn_id: 'payment-2',
      })
    );
  });

  it('defers a mixed order whose other leg is refund-pending', async () => {
    const paymentQuery = transactionQuery([
      {
        amount: 100,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: 'PSK-1',
        id: 'payment-1',
        status: 'completed',
      },
      {
        amount: 50,
        currency: 'NGN',
        gateway: 'paypal',
        gateway_reference: 'PP-1',
        id: 'payment-2',
        status: 'refund_pending',
      },
    ]);
    const resetEq = vi.fn().mockReturnThis();
    const resetUpdate = vi.fn().mockReturnValue({ eq: resetEq });
    const from = vi
      .fn()
      .mockReturnValueOnce(paymentQuery)
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce(auditReviewsQuery([]))
      .mockReturnValueOnce({ update: resetUpdate });

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: { from } as never,
      })
    ).rejects.toBeInstanceOf(DeferredError);
    // The leg scan mirrors the completion gate: refund-state legs stay
    // visible so they defer instead of slipping to false completion — and
    // quarantining them terminally would strand the remaining Paystack leg
    // instead of resuming after the provider refund completes.
    expect(paymentQuery.in).toHaveBeenCalledWith('status', [
      'completed',
      'refund_pending',
    ]);
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
    // No terminal review: payments lookup, the empty refund lookup, the
    // audit lookup, plus the attempt-budget reset behind the defer.
    expect(from).toHaveBeenCalledTimes(4);
    expect(resetUpdate).toHaveBeenCalledWith({ attempts: 0 });
  });

  it('quarantines a refund-pending leg with no reference to track', async () => {
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const paymentQuery = transactionQuery([
      {
        amount: 50,
        currency: 'NGN',
        gateway: 'paypal',
        gateway_reference: null,
        id: 'payment-2',
        status: 'refund_pending',
      },
    ]);
    const from = vi
      .fn()
      .mockReturnValueOnce(paymentQuery)
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce(auditReviewsQuery([]))
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
        issue_type: 'order_cancellation_refund_requires_review',
        order_id: 'order-1',
      })
    );
  });

  it('retries when the preflight manual-refund review cannot be persisted', async () => {
    const reviewInsert = vi.fn().mockResolvedValue({
      error: { code: 'XX000', message: 'database unavailable' },
    });
    const paymentQuery = transactionQuery([
      {
        amount: 75,
        currency: 'NGN',
        gateway: 'korapay',
        gateway_reference: 'kora-ref',
        id: 'payment-2',
      },
    ]);
    const from = vi
      .fn()
      .mockReturnValueOnce(paymentQuery)
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce(auditReviewsQuery([]))
      .mockReturnValueOnce({ insert: reviewInsert });

    const error = await executeOrderCancellationSideEffect({
      merchant,
      order,
      step: 'refund',
      supabase: { from } as never,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DeliveryUncertainError);
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
  });

  it('initiates the uncovered leg when the unsupported leg is already refunded', async () => {
    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 60,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'PSK-1',
            id: 'payment-p',
            status: 'completed',
          },
          {
            amount: 40,
            currency: 'NGN',
            gateway: 'korapay',
            gateway_reference: 'KORA-1',
            id: 'payment-k',
            status: 'completed',
          },
        ])
      )
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 40,
            currency: 'NGN',
            gateway: 'korapay',
            metadata: { payment_transaction_id: 'payment-k' },
            status: 'completed',
          },
        ])
      )
      .mockReturnValueOnce(auditReviewsQuery([]))
      .mockReturnValueOnce({ insert: auditInsert });
    mocks.initiateRefund.mockResolvedValue({
      data: {
        id: 101,
        status: 'queued',
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

    // The korapay leg needs no further action, so it must not
    // terminalize the row and strand the uncovered Paystack leg.
    expect(result).toEqual({ refundIds: [101] });
    expect(mocks.initiateRefund).toHaveBeenCalledTimes(1);
    expect(mocks.initiateRefund).toHaveBeenCalledWith(
      'PSK-1',
      6000,
      expect.any(String),
      undefined
    );
    expect(from).toHaveBeenCalledTimes(4);
  });

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
