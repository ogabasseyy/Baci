import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initiateRefund: vi.fn(),
}));

vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: mocks.initiateRefund,
}));
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

  it('quarantines a mixed order whose other leg is refund-pending', async () => {
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
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
    const from = vi
      .fn()
      .mockReturnValueOnce(paymentQuery)
      .mockReturnValueOnce({ insert: reviewInsert });

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: { from } as never,
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    // The leg scan mirrors the completion gate: refund-state legs must be
    // visible so they quarantine instead of slipping to false completion.
    expect(paymentQuery.in).toHaveBeenCalledWith('status', [
      'completed',
      'refund_pending',
    ]);
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        order_id: 'order-1',
        reason: expect.stringContaining('paypal'),
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
});
