vi.mock('./check-cancellation-refund-provider', () => ({
  checkCancellationRefundProvider: vi.fn().mockResolvedValue(undefined),
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ initiateRefund: vi.fn() }));

vi.mock('@/lib/paystack', () => ({ initiateRefund: mocks.initiateRefund }));
vi.mock('@/lib/orders/build-order-cancellation-email-message', () => ({
  buildOrderCancellationEmailMessage: vi.fn(),
}));

import { executeOrderCancellationSideEffect } from './execute-order-cancellation-side-effect';
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

  it('records a nonterminal Paystack refund as pending and files review', async () => {
    const refundInsert = vi.fn().mockResolvedValue({ error: null });
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
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce({ insert: refundInsert })
      .mockReturnValueOnce({ insert: reviewInsert });
    mocks.initiateRefund.mockResolvedValue({
      data: { id: 42, status: 'pending' },
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

    expect(refundInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway_reference: '42',
        metadata: expect.objectContaining({
          payment_transaction_id: 'payment-1',
          provider_refund_status: 'pending',
        }),
        status: 'pending',
      })
    );
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ provider_refund_id: 42 }),
        reason: expect.stringContaining('nonterminal status pending'),
      })
    );
  });
});
