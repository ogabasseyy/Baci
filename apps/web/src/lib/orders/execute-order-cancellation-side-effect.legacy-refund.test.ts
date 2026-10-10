import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ initiateRefund: vi.fn() }));
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
    order: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn().mockReturnThis(),
  };
}

describe('legacy cancellation refund preflight', () => {
  it.each([
    ['completed', {}],
    ['refund_pending', {}],
  ])('does not initiate again when an unlinked refund is %s', async (status, metadata) => {
    mocks.initiateRefund.mockReset();
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'paystack-ref',
            id: 'payment-1',
          },
        ])
      )
      .mockReturnValueOnce(
        transactionQuery([
          {
            gateway_reference: '42',
            metadata,
            status,
          },
        ])
      )
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
        reason: expect.stringContaining('cannot be linked'),
      })
    );
  });

  it('names the claimed target when a refund links outside the order legs', async () => {
    mocks.initiateRefund.mockReset();
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'paystack-ref',
            id: 'payment-1',
          },
        ])
      )
      .mockReturnValueOnce(
        transactionQuery([
          {
            gateway_reference: '42',
            metadata: { payment_transaction_id: 'another-payment' },
            status: 'completed',
          },
        ])
      )
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
    // A link naming a payment id outside this order's legs is
    // corruption, not a legacy unlinked refund: quarantine with the
    // claimed target named so operations verify the right row.
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        reason: expect.stringContaining(
          'links to payment legs outside this order (another-payment)'
        ),
      })
    );
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          invalid_link_claimed_payment_ids: ['another-payment'],
        }),
      })
    );
  });

  it('defers when an unlinked legacy refund covers the sole completed leg and another leg is in flight', async () => {
    mocks.initiateRefund.mockReset();
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paypal',
            gateway_reference: 'paypal-leg-1',
            id: 'payment-1',
            status: 'completed',
          },
          {
            amount: 50,
            currency: 'NGN',
            gateway: 'paypal',
            gateway_reference: 'paypal-leg-2',
            id: 'payment-2',
            status: 'refund_pending',
          },
        ])
      )
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paypal',
            gateway_reference: 'PP-1',
            metadata: {},
            status: 'completed',
          },
        ])
      )
      .mockReturnValueOnce(auditReviewsQuery([]))
      .mockReturnValueOnce({ insert: reviewInsert });

    // Terminalizing here would strand aggregate finalization: the drain
    // never reselects delivery_uncertain rows, so the pending leg's
    // completion could no longer resume the step. Defer instead — the
    // claim gate attributes the legacy refund and finalizes on resume.
    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: { from } as never,
      })
    ).rejects.toBeInstanceOf(DeferredError);
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
    expect(reviewInsert).not.toHaveBeenCalled();
  });

  it('quarantines when the unlinked legacy refund only partially covers the sole leg', async () => {
    mocks.initiateRefund.mockReset();
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paypal',
            gateway_reference: 'paypal-leg-1',
            id: 'payment-1',
            status: 'completed',
          },
        ])
      )
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 40,
            currency: 'NGN',
            gateway: 'paypal',
            gateway_reference: 'PP-1',
            metadata: {},
            status: 'completed',
          },
        ])
      )
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
        reason: expect.stringContaining('cannot be linked'),
      })
    );
  });
});
