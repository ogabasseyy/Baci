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
});
