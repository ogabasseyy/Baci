import { beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
  fetchRefund: vi.fn(),
  verifyTransaction: vi.fn(),
}));
vi.mock('@/lib/paystack', () => ({
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
    payment_transaction_id: 'payment-1',
    provider_payment_transaction_id: 123,
  },
  status: 'refund_pending',
};

function database() {
  const payment = {
    id: 'payment-1',
    order_id: 'order-1',
    merchant_id: 'merchant-1',
    gateway_reference: 'PSK-1',
    amount: 100,
    currency: 'NGN',
    status: 'completed',
  };
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: payment, error: null }),
  };
  return {
    from: vi.fn(() => query),
    rpc: vi.fn().mockResolvedValue({ data: 'processed', error: null }),
  };
}

describe('Paystack cancellation refund reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provider.fetchRefund.mockResolvedValue({
      success: true,
      data: {
        id: 42,
        transaction: 123,
        amount: 10000,
        currency: 'NGN',
        status: 'processed',
      },
    });
    provider.verifyTransaction.mockResolvedValue({
      success: true,
      data: { id: 123, reference: 'PSK-1', amount: 10000, currency: 'NGN' },
    });
  });

  it('records a processed refund only after matching its original payment', async () => {
    const db = database();
    await expect(
      reconcilePaystackCancellationRefund(db as never, refund)
    ).resolves.toBe('updated');
    expect(db.rpc).toHaveBeenCalledWith(
      'record_verified_paystack_cancellation_refund_v1',
      expect.objectContaining({
        p_refund_id: 'refund-1',
        p_provider_status: 'processed',
        p_provider_transaction_id: 123,
        p_amount_kobo: 10000,
      })
    );
  });

  it('does not complete a refund linked to a different Paystack payment', async () => {
    const db = database();
    provider.fetchRefund.mockResolvedValueOnce({
      success: true,
      data: {
        id: 42,
        transaction: 999,
        amount: 10000,
        currency: 'NGN',
        status: 'processed',
      },
    });
    await expect(
      reconcilePaystackCancellationRefund(db as never, refund)
    ).rejects.toThrow('paystack_refund_evidence_mismatch');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('does not complete a refund whose amount changed', async () => {
    const db = database();
    provider.fetchRefund.mockResolvedValueOnce({
      success: true,
      data: {
        id: 42,
        transaction: 123,
        amount: 9000,
        currency: 'NGN',
        status: 'processed',
      },
    });
    await expect(
      reconcilePaystackCancellationRefund(db as never, refund)
    ).rejects.toThrow('paystack_refund_evidence_mismatch');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('does not complete a refund when the original capture amount differs', async () => {
    const db = database();
    provider.verifyTransaction.mockResolvedValueOnce({
      success: true,
      data: { id: 123, reference: 'PSK-1', amount: 9000, currency: 'NGN' },
    });

    await expect(
      reconcilePaystackCancellationRefund(db as never, refund)
    ).rejects.toThrow('paystack_refund_evidence_mismatch');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('correlates an unlinked legacy refund with the sole external payment', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'payment-1',
            gateway: 'paystack',
            gateway_reference: 'PSK-1',
            amount: 100,
            currency: 'NGN',
          },
        ],
        error: null,
      }),
    };
    const db = {
      from: vi.fn(() => query),
      rpc: vi.fn().mockResolvedValue({ data: 'processed', error: null }),
    };

    await expect(
      reconcilePaystackCancellationRefund(db as never, {
        ...refund,
        metadata: {},
      })
    ).resolves.toBe('updated');
    expect(db.rpc).toHaveBeenCalledWith(
      'record_verified_paystack_cancellation_refund_v1',
      expect.objectContaining({
        p_refund_id: 'refund-1',
        p_provider_status: 'processed',
      })
    );
  });

  it.each([
    [
      'two external payments',
      [
        {
          id: 'payment-1',
          gateway: 'paystack',
          gateway_reference: 'PSK-1',
          amount: 100,
          currency: 'NGN',
        },
        {
          id: 'payment-2',
          gateway: 'paystack',
          gateway_reference: 'PSK-2',
          amount: 100,
          currency: 'NGN',
        },
      ],
    ],
    [
      'only a wallet payment',
      [
        {
          id: 'payment-9',
          gateway: 'wallet',
          gateway_reference: 'WALLET-9',
          amount: 100,
          currency: 'NGN',
        },
      ],
    ],
    [
      'a sole non-Paystack payment',
      [
        {
          id: 'payment-7',
          gateway: 'korapay',
          gateway_reference: 'KOR-7',
          amount: 100,
          currency: 'NGN',
        },
      ],
    ],
  ])('holds an unlinked legacy refund for review with %s', async (_case, payments) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockResolvedValue({ data: payments, error: null }),
    };
    const db = {
      from: vi.fn(() => query),
      rpc: vi.fn().mockResolvedValue({ data: 'processed', error: null }),
    };

    await expect(
      reconcilePaystackCancellationRefund(db as never, {
        ...refund,
        metadata: {},
      })
    ).rejects.toThrow('refund_payment_link_mismatch');
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
