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

import { reconcilePendingPaystackCancellationRefunds } from './reconcile-pending-paystack-cancellation-refunds';

describe('pending Paystack cancellation refund reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provider.fetchRefund.mockResolvedValue({
      success: true,
      data: {
        id: 42,
        transaction: 123,
        amount: 10000,
        currency: 'NGN',
        status: 'processing',
      },
    });
    provider.verifyTransaction.mockResolvedValue({
      success: true,
      data: { id: 123, reference: 'PSK-1', amount: 10000, currency: 'NGN' },
    });
  });

  it('re-polls a provider-accepted refund_pending row', async () => {
    const refund = {
      id: 'refund-1',
      order_id: 'order-1',
      merchant_id: 'merchant-1',
      gateway_reference: '42',
      amount: 100,
      currency: 'NGN',
      status: 'refund_pending',
      metadata: {
        payment_transaction_id: '11111111-1111-4111-8111-111111111111',
        provider_payment_transaction_id: 123,
      },
    };
    const candidates = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      like: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [refund], error: null }),
    };
    const payment = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: '11111111-1111-4111-8111-111111111111',
          order_id: 'order-1',
          merchant_id: 'merchant-1',
          gateway_reference: 'PSK-1',
          amount: 100,
          currency: 'NGN',
          status: 'completed',
        },
        error: null,
      }),
    };
    const rpc = vi.fn().mockResolvedValue({ data: 'processing', error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(candidates)
      .mockReturnValueOnce(payment);

    await expect(
      reconcilePendingPaystackCancellationRefunds({ from, rpc } as never)
    ).resolves.toEqual({ checked: 1, failed: 0 });

    expect(candidates.in).toHaveBeenCalledWith('status', [
      'refund_pending',
      'pending',
    ]);
    expect(candidates.not).toHaveBeenCalledWith(
      'cancelled_order.cancelled_at',
      'is',
      null
    );
    expect(candidates.like).toHaveBeenCalledWith(
      'description',
      'Refund for cancelled order #%'
    );
    expect(rpc).toHaveBeenCalledWith(
      'record_verified_paystack_cancellation_refund_v1',
      expect.objectContaining({ p_provider_status: 'processing' })
    );
  });

  it('stops before the deadline so later phases keep their share', async () => {
    const candidates = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      like: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue({ data: [{ id: 'refund-1' }], error: null }),
    };
    const from = vi.fn().mockReturnValueOnce(candidates);

    await expect(
      reconcilePendingPaystackCancellationRefunds(
        { from } as never,
        25,
        Date.now() - 1
      )
    ).resolves.toEqual({ checked: 0, failed: 0 });

    expect(provider.fetchRefund).not.toHaveBeenCalled();
  });
});
