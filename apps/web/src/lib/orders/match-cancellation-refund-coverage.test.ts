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

  it('requires exact gateway equality for attribution', () => {
    const coverage = matchCancellationRefundCoverage({
      linkedPaymentId: () => null,
      refundRows: [row({ gateway: 'PayPal' })],
      soleCompletedLegId: 'payment-1',
      transactions: [leg({ gateway: 'paypal' })],
    });

    // The claim gate compares gateways exactly: attributing here would
    // mark the leg refunded while the gate still sees it uncovered,
    // deferring forever instead of refunding or quarantining.
    expect(coverage.refundedPaymentIds).toEqual(new Set());
    expect(coverage.unattributedUnlinkedCount).toBe(1);
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
    // `refund.gateway = payment.gateway` never matches NULL — so
    // normalizing both sides to '' here would finish the side effect
    // as completed while the order stays paid and settlement
    // unreversed. Missing gateways mismatch into quarantine.
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

    // Exact `===` would equate two missing gateways where the SQL
    // `=` does not: attribution must not exceed the gate.
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
});
