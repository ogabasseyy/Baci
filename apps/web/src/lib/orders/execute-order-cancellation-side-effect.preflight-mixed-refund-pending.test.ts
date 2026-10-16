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

import { executeOrderCancellationSideEffect } from './execute-order-cancellation-side-effect';
import { auditReviewsQuery } from './execute-order-cancellation-side-effect.test-support';
import { DeferredError } from './run-order-cancellation-side-effect';

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
describe('cancellation refund preflight mixed refund-pending', () => {
  beforeEach(() => vi.clearAllMocks());

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
      'refunded',
    ]);
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
    // No terminal review: payments lookup, the empty refund lookup, the
    // audit lookup, plus the attempt-budget reset behind the defer.
    expect(from).toHaveBeenCalledTimes(4);
    expect(resetUpdate).toHaveBeenCalledWith({ attempts: 0 });
  });
});
