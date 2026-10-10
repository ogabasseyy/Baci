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

function payment(id: string, amount: number, reference: string) {
  return {
    amount,
    currency: 'NGN',
    gateway: 'paystack',
    gateway_reference: reference,
    id,
  };
}

function completedRefund(
  paymentId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    amount: 100,
    currency: 'NGN',
    gateway: 'paystack',
    gateway_reference: '42',
    metadata: {
      payment_transaction_id: paymentId,
      provider_refund_status: 'processed',
    },
    status: 'completed',
    ...overrides,
  };
}

function transactionQuery(data: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn().mockReturnThis(),
  };
}

describe('cancellation refund leg matching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('quarantines a leg whose completed refund is partial', async () => {
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([payment('payment-1', 100, 'paystack-ref')])
      )
      .mockReturnValueOnce(
        transactionQuery([completedRefund('payment-1', { amount: 40 })])
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
        reason: expect.stringContaining('do not cover their payment legs'),
        metadata: expect.objectContaining({ mismatched_leg_count: 1 }),
      })
    );
  });

  it('quarantines a leg whose completed refund is the wrong currency', async () => {
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([payment('payment-1', 100, 'paystack-ref')])
      )
      .mockReturnValueOnce(
        transactionQuery([completedRefund('payment-1', { currency: 'USD' })])
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
        reason: expect.stringContaining('do not cover their payment legs'),
      })
    );
  });

  it('quarantines a leg whose completed refund is another gateway', async () => {
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([payment('payment-1', 100, 'paystack-ref')])
      )
      .mockReturnValueOnce(
        transactionQuery([
          completedRefund('payment-1', { gateway: 'juicyway' }),
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
  });

  it('skips legs whose partial refunds sum to the full amount', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([payment('payment-1', 100, 'paystack-ref')])
      )
      .mockReturnValueOnce(
        transactionQuery([
          completedRefund('payment-1', {
            amount: 40,
            gateway_reference: '42',
          }),
          completedRefund('payment-1', {
            amount: 60,
            gateway_reference: '43',
          }),
        ])
      )
      .mockReturnValueOnce(auditReviewsQuery([]));

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: { from } as never,
      })
    ).resolves.toEqual({ refundIds: [] });

    expect(mocks.initiateRefund).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(3);
  });

  it('initiates clean legs before quarantining mismatched ones', async () => {
    const refundInsert = vi.fn().mockResolvedValue({ error: null });
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          payment('payment-1', 60, 'paystack-ref-1'),
          payment('payment-2', 40, 'paystack-ref-2'),
        ])
      )
      .mockReturnValueOnce(
        transactionQuery([completedRefund('payment-2', { amount: 10 })])
      )
      .mockReturnValueOnce(auditReviewsQuery([]))
      .mockReturnValueOnce({ insert: refundInsert })
      .mockReturnValueOnce({ insert: reviewInsert });
    mocks.initiateRefund.mockResolvedValue({
      success: true,
      data: {
        id: 42,
        status: 'pending',
        transaction: { id: 123, reference: 'paystack-ref-1' },
      },
    });

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: { from } as never,
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);

    expect(mocks.initiateRefund).toHaveBeenCalledTimes(1);
    expect(mocks.initiateRefund).toHaveBeenCalledWith(
      'paystack-ref-1',
      6000,
      'Order cancelled',
      undefined
    );
    expect(refundInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway_reference: '42',
        status: 'refund_pending',
      })
    );
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining('do not cover their payment legs'),
      })
    );
  });

  it('lets an in-flight remainder take precedence over mismatch quarantine', async () => {
    const eq = vi.fn().mockReturnThis();
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([payment('payment-1', 100, 'paystack-ref')])
      )
      .mockReturnValueOnce(
        transactionQuery([
          completedRefund('payment-1', { amount: 40 }),
          {
            amount: 60,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: '42',
            metadata: { payment_transaction_id: 'payment-1' },
            status: 'refund_pending',
          },
        ])
      )
      .mockReturnValueOnce(auditReviewsQuery([]))
      .mockReturnValueOnce({ update });

    const error = await executeOrderCancellationSideEffect({
      merchant,
      order,
      step: 'refund',
      supabase: { from } as never,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DeliveryUncertainError);
    expect((error as Error).message).toBe(
      'cancellation_refund_awaiting_provider_completion'
    );
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
    // The order-level budget was consumed before these legs settled:
    // reset it so the resumed run retries the outstanding legs fresh
    // instead of mistaking their first failure for exhaustion.
    expect(from).toHaveBeenCalledTimes(4);
    expect(update).toHaveBeenCalledWith({ attempts: 0 });
    expect(eq).toHaveBeenCalledWith('order_id', 'order-1');
    expect(eq).toHaveBeenCalledWith('step', 'refund');
  });
});
