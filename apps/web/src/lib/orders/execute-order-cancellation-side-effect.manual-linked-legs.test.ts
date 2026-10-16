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
import {
  auditReviewsQuery,
  merchant,
  order,
  transactionQuery,
} from './execute-order-cancellation-side-effect.test-support';
import {
  DeferredError,
  DeliveryUncertainError,
} from './run-order-cancellation-side-effect';

describe('cancellation refund manual-linked-leg deferral', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defers while a manual-linked leg still has an uncovered balance', async () => {
    const paymentQuery = transactionQuery([
      {
        amount: 100,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: 'PSK-1',
        id: 'payment-1',
        status: 'completed',
      },
    ]);
    const refundQuery = transactionQuery([
      {
        amount: 40,
        currency: 'NGN',
        gateway: 'manual',
        gateway_reference: 'split-1#1',
        id: 'refund-1',
        metadata: { payment_transaction_id: 'payment-1' },
        status: 'completed',
      },
    ]);
    const resetEq = vi.fn().mockReturnThis();
    const resetUpdate = vi.fn().mockReturnValue({ eq: resetEq });
    const from = vi
      .fn()
      .mockReturnValueOnce(paymentQuery)
      .mockReturnValueOnce(refundQuery)
      .mockReturnValueOnce(auditReviewsQuery([]))
      .mockReturnValueOnce({ update: resetUpdate });

    const error = await executeOrderCancellationSideEffect({
      merchant,
      order,
      step: 'refund',
      supabase: { from } as never,
    }).catch((reason: unknown) => reason);

    // Never complete under a pending manual: the final record would
    // land on a completed row no drain reselects, stranding the
    // trusted aggregate finalization. No quarantine either — the
    // merchant simply has not finished recording.
    expect(error).toBeInstanceOf(DeferredError);
    expect((error as Error).message).toBe(
      'cancellation_refund_awaiting_manual_completion'
    );
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
    expect(resetUpdate).toHaveBeenCalledWith({ attempts: 0 });
  });

  it('quarantines an internal-only order blocked by an unverified manual Paystack claim', async () => {
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'cash',
            gateway_reference: 'cash-1',
            id: 'cash-1',
            status: 'completed',
          },
        ])
      )
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'manual',
            gateway_reference: 'man-1',
            metadata: {
              method: 'paystack',
              payment_transaction_id: 'cash-1',
            },
            status: 'completed',
          },
        ])
      )
      .mockReturnValueOnce({ insert: reviewInsert });

    const error = await executeOrderCancellationSideEffect({
      merchant,
      order,
      step: 'refund',
      supabase: { from } as never,
    }).catch((reason: unknown) => reason);

    // No external leg exists to verify provider money against: the
    // run must file a reconciliation review and terminalize there,
    // not throw an ordinary failure the drain burns retries on.
    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        metadata: { unverified_manual_paystack_leg_ids: ['cash-1'] },
      })
    );
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
  });

  it('defers a partial manual on a non-Paystack leg instead of quarantining it', async () => {
    const paymentQuery = transactionQuery([
      {
        amount: 100,
        currency: 'NGN',
        gateway: 'korapay',
        gateway_reference: 'KPY-1',
        id: 'payment-1',
        status: 'completed',
      },
    ]);
    const refundQuery = transactionQuery([
      {
        amount: 40,
        currency: 'NGN',
        gateway: 'manual',
        gateway_reference: 'split-1#1',
        id: 'refund-1',
        metadata: { payment_transaction_id: 'payment-1' },
        status: 'completed',
      },
    ]);
    const resetEq = vi.fn().mockReturnThis();
    const resetUpdate = vi.fn().mockReturnValue({ eq: resetEq });
    const from = vi
      .fn()
      .mockReturnValueOnce(paymentQuery)
      .mockReturnValueOnce(refundQuery)
      .mockReturnValueOnce(auditReviewsQuery([]))
      .mockReturnValueOnce({ update: resetUpdate });

    const error = await executeOrderCancellationSideEffect({
      merchant,
      order,
      step: 'refund',
      supabase: { from } as never,
    }).catch((reason: unknown) => reason);

    // Quarantining here would terminalize the row as
    // delivery_uncertain and disable further recording; the merchant
    // simply has not finished, so the run must defer for completion.
    expect(error).toBeInstanceOf(DeferredError);
    expect((error as Error).message).toBe(
      'cancellation_refund_awaiting_manual_completion'
    );
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
    expect(resetUpdate).toHaveBeenCalledWith({ attempts: 0 });
  });
});
