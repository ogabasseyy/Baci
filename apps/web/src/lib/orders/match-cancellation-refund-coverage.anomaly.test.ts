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

describe('matchCancellationRefundCoverage anomalies', () => {
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

  it('quarantines unverified manual rows declared as Paystack', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
      refundRows: [
        row({
          gateway: 'manual',
          metadata: {
            method: 'paystack',
            payment_transaction_id: 'payment-1',
          },
        }),
      ],
      transactions: [leg({})],
    });

    // A merchant claim about provider money is not coverage: the
    // executor must quarantine for review, never mark the leg
    // covered and finish without settlement reversal.
    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.mismatchedIds).toEqual(new Set(['payment-1']));
    expect(coverage.manualLinkedLegIds).toEqual(new Set(['payment-1']));
  });

  it('mismatches a covered leg that also carries an anomalous row', () => {
    const transactions = [leg({})];
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
      refundRows: [
        row({
          metadata: {
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
        }),
        row({
          gateway: 'manual',
          metadata: {
            method: 'paystack',
            payment_transaction_id: 'payment-1',
          },
        }),
      ],
      transactions,
    });

    // The verified row covers the leg, but the unverified manual
    // Paystack claim is anomalous terminal evidence: report both so
    // the step quarantines instead of completing past an anomaly the
    // SQL gate refuses to finalize.
    expect(coverage.refundedPaymentIds).toEqual(new Set(['payment-1']));
    expect(coverage.mismatchedTransactions).toEqual(transactions);
    expect(coverage.mismatchedIds).toEqual(new Set(['payment-1']));
  });

  it('mismatches a covered leg that also carries a foreign row', () => {
    const transactions = [leg({})];
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
      refundRows: [
        row({
          metadata: {
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
        }),
        row({
          currency: 'USD',
          metadata: {
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
        }),
      ],
      transactions,
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set(['payment-1']));
    expect(coverage.mismatchedTransactions).toEqual(transactions);
    expect(coverage.mismatchedIds).toEqual(new Set(['payment-1']));
  });
});
