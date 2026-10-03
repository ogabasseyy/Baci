import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ initiateRefund: vi.fn() }));

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
    order: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn().mockReturnThis(),
  };
}

describe('cancellation refund safety', () => {
  beforeEach(() => vi.clearAllMocks());

  it('quarantines a completed payment with a missing gateway', async () => {
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 100,
            currency: 'NGN',
            gateway: null,
            gateway_reference: 'legacy-ref',
            id: 'payment-1',
          },
        ])
      )
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
        reason: expect.stringContaining('missing gateway'),
      })
    );
  });

  it('quarantines a completed payment with a corrupt amount', async () => {
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
          {
            amount: 'NaN',
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'paystack-ref-2',
            id: 'payment-2',
          },
        ])
      )
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

    // NaN would pass the old predicate and reach the provider as an
    // omitted amount — a full refund of a corrupt leg.
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        merchant_id: 'merchant-1',
        reason: expect.stringContaining('invalid amount'),
      })
    );
  });

  it('records an accepted pending refund without blocking initiation', async () => {
    const refundInsert = vi.fn().mockResolvedValue({ error: null });
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
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce(auditReviewsQuery([]))
      .mockReturnValueOnce({ insert: refundInsert });
    mocks.initiateRefund.mockResolvedValue({
      data: {
        id: 42,
        status: 'pending',
        transaction: { id: 123, reference: 'paystack-ref' },
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
    ).resolves.toEqual({ refundIds: [42] });

    expect(refundInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway_reference: '42',
        metadata: expect.objectContaining({
          payment_transaction_id: 'payment-1',
          provider_refund_status: 'pending',
        }),
        status: 'refund_pending',
      })
    );
    expect(from).toHaveBeenCalledTimes(4);
  });

  it('initiates every payment leg when an earlier accepted refund is pending', async () => {
    const refundInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 60,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'paystack-ref-1',
            id: 'payment-1',
          },
          {
            amount: 40,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'paystack-ref-2',
            id: 'payment-2',
          },
        ])
      )
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce(auditReviewsQuery([]))
      .mockReturnValue({ insert: refundInsert });
    mocks.initiateRefund
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 42,
          status: 'pending',
          transaction: { id: 123, reference: 'paystack-ref-1' },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 43,
          status: 'processed',
          transaction: { id: 124, reference: 'paystack-ref-2' },
        },
      });

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: { from } as never,
      })
    ).resolves.toEqual({ refundIds: [42, 43] });
    expect(mocks.initiateRefund).toHaveBeenNthCalledWith(
      1,
      'paystack-ref-1',
      6000,
      'Order cancelled',
      undefined
    );
    expect(mocks.initiateRefund).toHaveBeenNthCalledWith(
      2,
      'paystack-ref-2',
      4000,
      'Order cancelled',
      undefined
    );
    expect(refundInsert).toHaveBeenCalledTimes(2);
    expect(refundInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway_reference: '42',
        status: 'refund_pending',
      })
    );
    expect(refundInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway_reference: '43',
        status: 'refund_pending',
      })
    );
  });

  it('quarantines a later failed leg after an earlier refund was accepted', async () => {
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
            gateway_reference: 'paystack-ref-1',
            id: 'payment-1',
          },
          {
            amount: 40,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'paystack-ref-2',
            id: 'payment-2',
          },
        ])
      )
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce(auditReviewsQuery([]))
      .mockReturnValueOnce({ insert: refundInsert })
      .mockReturnValueOnce({ insert: reviewInsert });
    mocks.initiateRefund
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 42,
          status: 'pending',
          transaction: { id: 123, reference: 'paystack-ref-1' },
        },
      })
      .mockResolvedValueOnce({ success: false, error: 'declined' });

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: { from } as never,
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ accepted_refund_ids: [42] }),
      })
    );
  });
});
