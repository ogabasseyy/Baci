import { beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
  fetchRefund: vi.fn(),
  verifyTransaction: vi.fn(),
}));
vi.mock('@/lib/verify-paystack-transaction', () => ({
  verifyTransaction: provider.verifyTransaction,
}));
vi.mock('./fetch-paystack-refund', () => ({
  fetchRefund: provider.fetchRefund,
}));

import { reconcilePaystackCancellationRefund } from './reconcile-paystack-cancellation-refund';

const refund = {
  id: 'refund-1',
  order_id: 'order-1',
  merchant_id: 'merchant-1',
  gateway_reference: '42',
  amount: 100,
  currency: 'NGN',
  metadata: {
    payment_transaction_id: '11111111-1111-4111-8111-111111111111',
    provider_payment_transaction_id: 123,
  },
  status: 'refund_pending',
};

function database() {
  const query = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    select: vi.fn().mockReturnThis(),
  };
  return {
    from: vi.fn(() => query),
    query,
    rpc: vi.fn(),
  };
}

describe('Paystack cancellation refund link validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    '',
    'payment-1',
    'not-a-uuid',
    '12345',
  ])('rejects a malformed payment link %s without querying the UUID column', async (paymentId) => {
    const db = database();

    await expect(
      reconcilePaystackCancellationRefund(db as never, {
        ...refund,
        metadata: { ...refund.metadata, payment_transaction_id: paymentId },
      })
    ).rejects.toThrow('invalid_local_refund_link');
    // The malformed value must never reach the UUID transactions.id
    // filter, whose invalid-UUID error would look retryable and rotate
    // the row forever instead of filing the bad-link review and hold.
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(provider.fetchRefund).not.toHaveBeenCalled();
    expect(provider.verifyTransaction).not.toHaveBeenCalled();
  });

  it('accepts a well-formed UUID link and resolves the payment', async () => {
    const db = database();
    db.query.maybeSingle.mockResolvedValue({
      data: {
        amount: 100,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: 'PSK-1',
        id: '11111111-1111-4111-8111-111111111111',
        merchant_id: 'merchant-1',
        order_id: 'order-1',
        status: 'completed',
      },
      error: null,
    });
    provider.fetchRefund.mockResolvedValue({
      data: {
        amount: 10000,
        currency: 'NGN',
        id: 42,
        status: 'processed',
        transaction: 123,
      },
      success: true,
    });
    provider.verifyTransaction.mockResolvedValue({
      data: { amount: 10000, currency: 'NGN', id: 123, reference: 'PSK-1' },
      success: true,
    });
    db.rpc.mockResolvedValue({ data: 'processed', error: null });

    await expect(
      reconcilePaystackCancellationRefund(db as never, refund)
    ).resolves.toBe('updated');
    expect(db.from).toHaveBeenCalled();
  });
});
