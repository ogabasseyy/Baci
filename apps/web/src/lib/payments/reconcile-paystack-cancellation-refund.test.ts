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

import { isDeterministicRefundError } from './is-deterministic-paystack-refund-error';
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
  const payment = {
    id: '11111111-1111-4111-8111-111111111111',
    order_id: 'order-1',
    merchant_id: 'merchant-1',
    gateway: 'paystack',
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

  it('accepts a legacy padded currency copied from the payment', async () => {
    const db = database();
    await expect(
      reconcilePaystackCancellationRefund(db as never, {
        ...refund,
        currency: ' ngn ',
      })
    ).resolves.toBe('updated');
    expect(db.rpc).toHaveBeenCalledWith(
      'record_verified_paystack_cancellation_refund_v1',
      expect.objectContaining({ p_refund_id: 'refund-1' })
    );
  });

  it.each([
    ['missing', undefined],
    ['non-string', 42],
  ])('files a deterministic review when the provider status is %s', async (_label, status) => {
    const db = database();
    provider.fetchRefund.mockResolvedValueOnce({
      success: true,
      data: {
        id: 42,
        transaction: 123,
        amount: 10000,
        currency: 'NGN',
        status,
      },
    });

    // A TypeError here would only rotate the row forever: the
    // malformed status joins the deterministic evidence-review
    // path like any other unknown status.
    const failure = await reconcilePaystackCancellationRefund(
      db as never,
      refund
    ).then(
      () => {
        throw new Error('expected malformed status to throw');
      },
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('unknown_paystack_refund_status');
    expect(isDeterministicRefundError(failure)).toBe(true);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('files a deterministic rejection when the provider lookup 404s', async () => {
    provider.fetchRefund.mockResolvedValueOnce({
      code: 'HTTP_404',
      error: 'Refund not found',
      success: false,
    });
    const failure = await reconcilePaystackCancellationRefund(
      database() as never,
      refund
    ).then(
      () => {
        throw new Error('expected the lookup rejection to throw');
      },
      (error: unknown) => error
    );
    // A definitive rejection never heals: the worker must file and hold
    // instead of rotating the row forever as merely unavailable.
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('paystack_refund_lookup_rejected');
    expect(isDeterministicRefundError(failure)).toBe(true);
  });

  it('stays retryable when the provider lookup fails transiently', async () => {
    provider.fetchRefund.mockResolvedValueOnce({
      code: 'HTTP_503',
      error: 'upstream down',
      success: false,
    });
    const failure = await reconcilePaystackCancellationRefund(
      database() as never,
      refund
    ).then(
      () => {
        throw new Error('expected the outage to throw');
      },
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'paystack_refund_verification_unavailable'
    );
    expect(isDeterministicRefundError(failure)).toBe(false);
  });

  it('verifies a partial refund against its own row amount', async () => {
    const db = database();
    provider.fetchRefund.mockResolvedValueOnce({
      success: true,
      data: {
        id: 42,
        transaction: 123,
        amount: 4000,
        currency: 'NGN',
        status: 'processed',
      },
    });

    await expect(
      reconcilePaystackCancellationRefund(db as never, {
        ...refund,
        amount: 40,
      })
    ).resolves.toBe('updated');
    expect(db.rpc).toHaveBeenCalledWith(
      'record_verified_paystack_cancellation_refund_v1',
      expect.objectContaining({ p_amount_kobo: 4000 })
    );
  });

  it.each([
    120, 0, -5,
  ])('rejects a refund amount of %s against a 100 payment', async (amount) => {
    const db = database();

    await expect(
      reconcilePaystackCancellationRefund(db as never, {
        ...refund,
        amount,
      })
    ).rejects.toThrow('refund_payment_link_mismatch');
    expect(provider.fetchRefund).not.toHaveBeenCalled();
    expect(provider.verifyTransaction).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('keeps a failed payment lookup retryable instead of a mismatch', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: null, error: new Error('db down') }),
    };
    const db = { from: vi.fn(() => query), rpc: vi.fn() };

    // A transient read outage must not file a mismatch review and hold
    // a valid refund out of polling permanently.
    await expect(
      reconcilePaystackCancellationRefund(db as never, refund)
    ).rejects.toThrow('refund_event_lookup_failed');
    expect(provider.fetchRefund).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
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

  it.each([
    'Paystack',
    ' paystack ',
    'PAYSTACK',
  ])('accepts a linked payment stored as %s', async (gateway) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: '11111111-1111-4111-8111-111111111111',
          order_id: 'order-1',
          merchant_id: 'merchant-1',
          gateway,
          gateway_reference: 'PSK-1',
          amount: 100,
          currency: 'NGN',
          status: 'completed',
        },
        error: null,
      }),
    };
    const db = {
      from: vi.fn(() => query),
      rpc: vi.fn().mockResolvedValue({ data: 'processed', error: null }),
    };

    await expect(
      reconcilePaystackCancellationRefund(db as never, refund)
    ).resolves.toBe('updated');
    expect(db.rpc).toHaveBeenCalledWith(
      'record_verified_paystack_cancellation_refund_v1',
      expect.objectContaining({ p_refund_id: 'refund-1' })
    );
  });

  it.each([
    'korapay',
    '',
    null,
  ])('holds a linked payment with gateway %s for review', async (gateway) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: '11111111-1111-4111-8111-111111111111',
          order_id: 'order-1',
          merchant_id: 'merchant-1',
          gateway,
          gateway_reference: 'PSK-1',
          amount: 100,
          currency: 'NGN',
          status: 'completed',
        },
        error: null,
      }),
    };
    const db = {
      from: vi.fn(() => query),
      rpc: vi.fn().mockResolvedValue({ data: 'processed', error: null }),
    };

    await expect(
      reconcilePaystackCancellationRefund(db as never, refund)
    ).rejects.toThrow('refund_payment_link_mismatch');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('correlates an unlinked legacy refund with a padded sole Paystack leg', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'payment-1',
            gateway: ' Paystack ',
            gateway_reference: 'PSK-1',
            amount: 100,
            currency: 'NGN',
          },
          {
            id: 'payment-9',
            gateway: ' wallet ',
            gateway_reference: 'WALLET-9',
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
      expect.objectContaining({ p_refund_id: 'refund-1' })
    );
  });
});
