import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/orders/check-cancellation-refund-provider', () => ({
  checkCancellationRefundProvider: vi.fn().mockResolvedValue(undefined),
}));

import { checkCancellationRefundProvider } from '@/lib/orders/check-cancellation-refund-provider';
import {
  merchant,
  order,
  paystackPayment,
} from './execute-order-cancellation-side-effect.test-support';
import { preflightCancellationRefundInitiation } from './preflight-cancellation-refund-initiation';
import {
  DeferredError,
  DeliveryUncertainError,
} from './run-order-cancellation-side-effect';

const linkedPaymentId = (row: { metadata: unknown }): string | null => {
  const claimed = (row.metadata as { payment_transaction_id?: unknown } | null)
    ?.payment_transaction_id;
  return typeof claimed === 'string' ? claimed : null;
};
function supabase() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  return {
    from: vi.fn().mockReturnValue({ insert }),
    insert,
    rpc: vi.fn(),
  };
}
function input(overrides: Record<string, unknown> = {}) {
  return {
    auditBlockedLegIds: new Set<string>(),
    linkedPaymentId,
    manualLinkedLegIds: new Set<string>(),
    mismatchedIds: new Set<string>(),
    order: order as never,
    refundedPaymentIds: new Set<string>(),
    refundRows: [],
    supabase: supabase() as never,
    transactions: [paystackPayment as never],
    ...overrides,
  };
}

describe('preflightCancellationRefundInitiation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the initiation set and guards each Paystack leg', async () => {
    const first = { ...paystackPayment, amount: 60 };
    const other = {
      ...paystackPayment,
      amount: 40,
      id: 'payment-2',
      gateway_reference: 'ref-2',
    };
    const result = await preflightCancellationRefundInitiation(
      input({ transactions: [first, other] })
    );
    expect(result.initiationTransactions).toHaveLength(2);
    expect(result.auditBlockedTransactions).toHaveLength(0);
    expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(2);
    expect(checkCancellationRefundProvider).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'ref-1' })
    );
  });

  it('withholds mismatched and audit-blocked legs from initiation', async () => {
    const result = await preflightCancellationRefundInitiation(
      input({
        auditBlockedLegIds: new Set(['payment-2']),
        mismatchedIds: new Set(['payment-3']),
        transactions: [
          paystackPayment,
          { ...paystackPayment, id: 'payment-2', gateway_reference: 'ref-2' },
          { ...paystackPayment, id: 'payment-3', gateway_reference: 'ref-3' },
        ],
      })
    );
    expect(result.initiationTransactions.map((leg) => leg.id)).toEqual([
      'payment-1',
    ]);
    expect(result.auditBlockedTransactions.map((leg) => leg.id)).toEqual([
      'payment-2',
    ]);
  });

  it('ignores settled foreign-currency legs but guards outstanding ones', async () => {
    const client = supabase();
    // A fully refunded USD leg plus an outstanding NGN leg proceeds, and
    // the provider guard runs for the outstanding leg only.
    await expect(
      preflightCancellationRefundInitiation(
        input({
          refundedPaymentIds: new Set(['payment-usd']),
          supabase: client as never,
          transactions: [
            {
              ...paystackPayment,
              currency: 'USD',
              gateway_reference: 'ref-usd',
              id: 'payment-usd',
            },
            paystackPayment,
          ],
        })
      )
    ).resolves.toBeDefined();
    expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(1);
    expect(checkCancellationRefundProvider).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'ref-1' })
    );
    // An outstanding USD leg quarantines instead.
    await expect(
      preflightCancellationRefundInitiation(
        input({
          supabase: client as never,
          transactions: [{ ...paystackPayment, currency: 'USD' }],
        })
      )
    ).rejects.toThrow('Payment currency requires review before refund');
    expect(client.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        reason: 'Payment currency requires review before refund',
      })
    );
    expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(1);
  });

  it('accepts legacy casing but rejects missing leg currencies', async () => {
    await expect(
      preflightCancellationRefundInitiation(
        input({
          transactions: [{ ...paystackPayment, currency: ' ngn ' }],
        })
      )
    ).resolves.toBeDefined();
    await expect(
      preflightCancellationRefundInitiation(
        input({
          transactions: [{ ...paystackPayment, currency: null }],
        })
      )
    ).rejects.toThrow('Payment currency requires review before refund');
  });

  it('quarantines overfunded ledgers instead of retrying them', async () => {
    const client = supabase();
    await expect(
      preflightCancellationRefundInitiation(
        input({
          supabase: client as never,
          transactions: [{ ...paystackPayment, amount: 101 }],
        })
      )
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(client.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        merchant_id: merchant.id,
        order_id: order.id,
      })
    );
    expect(checkCancellationRefundProvider).not.toHaveBeenCalled();
  });

  it('withholds manual-linked legs from initiation without review', async () => {
    const result = await preflightCancellationRefundInitiation(
      input({
        manualLinkedLegIds: new Set(['payment-1']),
      })
    );
    expect(result.initiationTransactions).toHaveLength(0);
    expect(checkCancellationRefundProvider).not.toHaveBeenCalled();
  });
  it('skips the provider guard for non-Paystack and reference-less legs', async () => {
    await preflightCancellationRefundInitiation(
      input({
        transactions: [
          { ...paystackPayment, amount: 60, gateway: 'korapay' },
          {
            ...paystackPayment,
            amount: 40,
            id: 'payment-2',
            gateway_reference: null,
          },
        ],
      })
    );
    expect(checkCancellationRefundProvider).not.toHaveBeenCalled();
  });
  it('defers instead of burning a short budget on the provider guard', async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
    });
    const from = vi.fn().mockReturnValue({ update });
    const error = await preflightCancellationRefundInitiation(
      input({
        deadlineMs: Date.now() + 10_000,
        supabase: { from } as never,
      })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect((error as Error).message).toBe(
      'cancellation_refund_preflight_deferred_for_budget'
    );
    expect(checkCancellationRefundProvider).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ attempts: 0 });
  });
  it('defers when the window fits verification but not initiation', async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
    });
    const from = vi.fn().mockReturnValue({ update });
    // 60s covers the 30s verification alone, but initiation needs its
    // own 38s leg after it: starting verification would burn the
    // attempt when initiation deadline-exceeds with no refund sent.
    const error = await preflightCancellationRefundInitiation(
      input({
        deadlineMs: Date.now() + 60_000,
        supabase: { from } as never,
      })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect((error as Error).message).toBe(
      'cancellation_refund_preflight_deferred_for_budget'
    );
    expect(checkCancellationRefundProvider).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ attempts: 0 });
  });
  it('caps the provider guard listing by the preflight worst case', async () => {
    const before = Date.now();
    await preflightCancellationRefundInitiation(
      input({ deadlineMs: before + 120_000 })
    );
    const forwarded = vi.mocked(checkCancellationRefundProvider).mock
      .calls[0][0].deadlineMs as number;
    expect(forwarded).toBeGreaterThan(before + 29_000);
    expect(forwarded).toBeLessThanOrEqual(Date.now() + 30_000);
  });
  it('resets attempts when the provider guard defers on budget', async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
    });
    const from = vi.fn().mockReturnValue({ update });
    vi.mocked(checkCancellationRefundProvider).mockRejectedValueOnce(
      new DeferredError('cancellation_refund_provider_verification_deferred')
    );
    const error = await preflightCancellationRefundInitiation(
      input({
        deadlineMs: Date.now() + 120_000,
        supabase: { from } as never,
      })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect(update).toHaveBeenCalledWith({ attempts: 0 });
  });
});
