import { describe, expect, it } from 'vitest';
import { matchCancellationRefundCoverage } from './match-cancellation-refund-coverage';

function leg(overrides: {
  amount?: number;
  currency?: string;
  gateway?: string;
  id?: string;
}) {
  return {
    amount: 100,
    currency: 'NGN',
    gateway: 'paystack',
    gateway_reference: 'PSK-1',
    id: 'payment-1',
    merchant_id: 'merchant-1',
    order_id: 'order-1',
    status: 'completed',
    ...overrides,
  } as never;
}

function row(overrides: Record<string, unknown>) {
  return {
    amount: 100,
    currency: 'NGN',
    gateway: 'paystack',
    metadata: {},
    status: 'completed',
    ...overrides,
  };
}

const linkedPaymentId = (candidate: { metadata: unknown }) =>
  (candidate.metadata as { payment_transaction_id?: unknown })
    ?.payment_transaction_id === 'payment-1'
    ? 'payment-1'
    : null;

describe('matchCancellationRefundCoverage manual rows', () => {
  it('covers legs with explicitly linked manual rows', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
      orderCurrency: 'NGN',
      refundRows: [
        row({
          amount: 100,
          gateway: 'manual',
          metadata: { payment_transaction_id: 'payment-1' },
        }),
      ],
      transactions: [leg({})],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set(['payment-1']));
    expect(coverage.manualLinkedLegIds).toEqual(new Set(['payment-1']));
    expect(coverage.manualPendingLegIds).toEqual(new Set());
    expect(coverage.mismatchedTransactions).toEqual([]);
  });

  it('waits on partial manual rows instead of mismatching them', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
      orderCurrency: 'NGN',
      refundRows: [
        row({
          amount: 20,
          gateway: 'manual',
          metadata: { payment_transaction_id: 'payment-1' },
        }),
      ],
      transactions: [leg({})],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.manualLinkedLegIds).toEqual(new Set(['payment-1']));
    expect(coverage.manualPendingLegIds).toEqual(new Set(['payment-1']));
    expect(coverage.mismatchedTransactions).toEqual([]);
  });

  it('mismatches manual rows in the wrong money', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
      orderCurrency: 'NGN',
      refundRows: [
        row({
          amount: 100,
          currency: 'USD',
          gateway: 'manual',
          metadata: { payment_transaction_id: 'payment-1' },
        }),
      ],
      transactions: [leg({})],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.manualLinkedLegIds).toEqual(new Set(['payment-1']));
    expect(coverage.manualPendingLegIds).toEqual(new Set());
    expect(coverage.mismatchedIds).toEqual(new Set(['payment-1']));
  });

  it('leaves unlinked manual rows unattributed', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId: () => null,
      orderCurrency: 'NGN',
      refundRows: [row({ gateway: 'manual' })],
      soleCompletedLegId: 'payment-1',
      transactions: [leg({})],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.manualLinkedLegIds).toEqual(new Set());
    expect(coverage.mismatchedTransactions).toEqual([]);
    expect(coverage.unattributedUnlinkedCount).toBe(1);
  });

  it('waits on partial manuals beside earlier provider coverage', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
      orderCurrency: 'NGN',
      refundRows: [
        row({
          amount: 30,
          metadata: {
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
        }),
        row({
          amount: 20,
          gateway: 'manual',
          metadata: { payment_transaction_id: 'payment-1' },
        }),
      ],
      transactions: [leg({})],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.manualPendingLegIds).toEqual(new Set(['payment-1']));
    expect(coverage.mismatchedTransactions).toEqual([]);
  });

  it('waits on a cash-like leg with no manual row yet', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId: () => null,
      orderCurrency: 'NGN',
      refundRows: [],
      transactions: [leg({ gateway: 'cash', id: 'cash-1' })],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.manualPendingLegIds).toEqual(new Set(['cash-1']));
    expect(coverage.mismatchedTransactions).toEqual([]);
  });

  it('waits on the bare cash leg of a mixed covered order', () => {
    const mixedLink = (candidate: { metadata: unknown }) =>
      (candidate.metadata as { payment_transaction_id?: unknown })
        ?.payment_transaction_id === 'payment-1'
        ? 'payment-1'
        : null;
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId: mixedLink,
      orderCurrency: 'NGN',
      refundRows: [
        row({
          amount: 100,
          metadata: {
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
        }),
      ],
      transactions: [leg({}), leg({ gateway: 'cash', id: 'cash-1' })],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set(['payment-1']));
    expect(coverage.manualPendingLegIds).toEqual(new Set(['cash-1']));
    expect(coverage.mismatchedTransactions).toEqual([]);
  });

  it('leaves bare wallet legs to their own ledgers', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId: () => null,
      orderCurrency: 'NGN',
      refundRows: [],
      transactions: [leg({ gateway: 'wallet', id: 'wallet-1' })],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.manualPendingLegIds).toEqual(new Set());
    expect(coverage.mismatchedTransactions).toEqual([]);
  });
});
