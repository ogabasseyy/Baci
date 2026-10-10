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

describe('matchCancellationRefundCoverage', () => {
  it('marks a leg refunded when verified rows cover it', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
      refundRows: [
        row({
          metadata: {
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
        }),
      ],
      transactions: [leg({})],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set(['payment-1']));
    expect(coverage.mismatchedTransactions).toEqual([]);
  });

  it('withholds unverified paystack rows for the verification workers', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
      refundRows: [row({ metadata: { payment_transaction_id: 'payment-1' } })],
      transactions: [leg({})],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.unverifiedLinkedLegIds).toEqual(new Set(['payment-1']));
    expect(coverage.mismatchedTransactions.map((leg) => leg.id)).toEqual([
      'payment-1',
    ]);
  });

  it('quarantines partial and foreign rows instead of skipping the balance', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
      refundRows: [
        row({
          amount: 40,
          metadata: {
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
        }),
      ],
      transactions: [leg({})],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.mismatchedIds).toEqual(new Set(['payment-1']));
  });

  it('attributes an unlinked legacy refund to the sole completed leg', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId: () => null,
      refundRows: [
        row({ gateway: 'paypal', metadata: { provider_refund_status: 'x' } }),
      ],
      soleCompletedLegId: 'payment-1',
      transactions: [leg({ gateway: 'paypal' })],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set(['payment-1']));
    expect(coverage.unattributedUnlinkedCount).toBe(0);
    expect(coverage.mismatchedIds).toEqual(new Set());
  });

  it('leaves unlinked rows unattributed without a sole leg', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId: () => null,
      refundRows: [row({})],
      transactions: [leg({}), leg({ id: 'payment-2' })],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.unattributedUnlinkedCount).toBe(1);
  });

  it('normalizes gateway casing for attribution like the claim gate', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId: () => null,
      refundRows: [row({ gateway: 'PayPal' })],
      soleCompletedLegId: 'payment-1',
      transactions: [leg({ gateway: 'paypal' })],
    });

    // The claim gate trims and uppercases both gateways: exact
    // equality here would quarantine a covered legacy leg as
    // delivery_uncertain while the gate still sees it covered.
    expect(coverage.refundedPaymentIds).toEqual(new Set(['payment-1']));
    expect(coverage.unattributedUnlinkedCount).toBe(0);
  });

  it('attributes a padded legacy refund to its completed leg', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId: () => null,
      refundRows: [
        row({
          gateway: 'paystack',
          metadata: { provider_refund_status: 'processed' },
        }),
      ],
      soleCompletedLegId: 'payment-1',
      transactions: [leg({ gateway: ' Paystack ' })],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set(['payment-1']));
    expect(coverage.unattributedUnlinkedCount).toBe(0);
    expect(coverage.mismatchedIds).toEqual(new Set());
  });

  it('waits on attributed unverified paystack rows instead of covering', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId: () => null,
      refundRows: [row({ metadata: {} })],
      soleCompletedLegId: 'payment-1',
      transactions: [leg({})],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.unverifiedLinkedLegIds).toEqual(new Set(['payment-1']));
    expect(coverage.unattributedUnlinkedCount).toBe(0);
  });

  it('mismatches null gateways instead of covering them', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
      refundRows: [
        row({
          gateway: null,
          metadata: { payment_transaction_id: 'payment-1' },
        }),
      ],
      transactions: [leg({ gateway: null as never })],
    });

    // The gateway column permits null, but the aggregate claim's
    // NULLIF-normalized equality never matches missing gateways — so
    // equating them here would finish the side effect as completed
    // while the order stays paid and settlement unreversed. Missing
    // gateways mismatch into quarantine.
    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.mismatchedIds).toEqual(new Set(['payment-1']));
  });

  it('leaves null-gateway attributions unattributed', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId: () => null,
      refundRows: [row({ gateway: null })],
      soleCompletedLegId: 'payment-1',
      transactions: [leg({ gateway: null as never })],
    });

    // Missing gateways never match the claim gate's NULLIF
    // equality, so attribution must leave them unattributed too.
    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.unattributedUnlinkedCount).toBe(1);
  });

  it('counts a partial attribution as a mismatch for quarantine', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId: () => null,
      refundRows: [row({ amount: 40, gateway: 'paypal' })],
      soleCompletedLegId: 'payment-1',
      transactions: [leg({ gateway: 'paypal' })],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.mismatchedIds).toEqual(new Set(['payment-1']));
    expect(coverage.unattributedUnlinkedCount).toBe(0);
  });

  it('covers legs with explicitly linked manual rows', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
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

  it('counts legacy refunded rows as terminal coverage', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
      refundRows: [
        row({
          metadata: {
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
          status: 'refunded',
        }),
      ],
      transactions: [leg({})],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set(['payment-1']));
    expect(coverage.mismatchedTransactions).toEqual([]);
  });

  it('leaves unlinked manual rows unattributed', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId: () => null,
      refundRows: [row({ gateway: 'manual' })],
      soleCompletedLegId: 'payment-1',
      transactions: [leg({})],
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.manualLinkedLegIds).toEqual(new Set());
    expect(coverage.mismatchedTransactions).toEqual([]);
    expect(coverage.unattributedUnlinkedCount).toBe(1);
  });
});
