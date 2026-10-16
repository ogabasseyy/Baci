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
      orderCurrency: 'NGN',
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
      orderCurrency: 'NGN',
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
      orderCurrency: 'NGN',
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
      orderCurrency: 'NGN',
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
      orderCurrency: 'NGN',
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

  it('mismatches a leg covered in foreign currency for its order', () => {
    // The USD row matches its USD leg, so the money counts as
    // returned — but the order prices in NGN, which the claim and
    // manager veto. The leg reports both so clean siblings initiate
    // first and the step then quarantines instead of completing
    // past evidence nothing finalizes.
    const transactions = [leg({ currency: 'USD' })];
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
      orderCurrency: 'NGN',
      refundRows: [
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

  it('defaults a blank order currency to NGN for the anomaly check', () => {
    const ngn = matchCancellationRefundCoverage({
      linkedPaymentId,
      orderCurrency: null,
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
    expect(ngn.refundedPaymentIds).toEqual(new Set(['payment-1']));
    expect(ngn.mismatchedTransactions).toEqual([]);

    const usd = matchCancellationRefundCoverage({
      linkedPaymentId,
      orderCurrency: '',
      refundRows: [
        row({
          currency: 'USD',
          metadata: {
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
        }),
      ],
      transactions: [leg({ currency: 'USD' })],
    });
    expect(usd.refundedPaymentIds).toEqual(new Set(['payment-1']));
    expect(usd.mismatchedIds).toEqual(new Set(['payment-1']));
  });

  it('mismatches an attributed foreign row beside sole-leg coverage', () => {
    // Unlinked rows attribute to the sole completed leg for
    // coverage, but the claim vetoes foreign terminal evidence over
    // the unfiltered universe — attribution must not launder the
    // currency anomaly.
    const transactions = [leg({ currency: 'USD' })];
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId: () => null,
      orderCurrency: 'NGN',
      refundRows: [
        row({
          amount: 100,
          currency: 'USD',
          metadata: { provider_refund_status: 'processed' },
        }),
      ],
      soleCompletedLegId: 'payment-1',
      transactions,
    });

    expect(coverage.refundedPaymentIds).toEqual(new Set(['payment-1']));
    expect(coverage.mismatchedIds).toEqual(new Set(['payment-1']));
  });

  it('mismatches a covered leg that also carries a foreign row', () => {
    const transactions = [leg({})];
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId,
      orderCurrency: 'NGN',
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
