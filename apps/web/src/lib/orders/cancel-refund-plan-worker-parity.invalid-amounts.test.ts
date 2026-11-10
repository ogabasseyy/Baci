import { getCancelRefundPlan } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import { collectAwaitingCancellationRefundLegs } from './collect-awaiting-cancellation-refund-legs';

interface Refund {
  amount: number;
  gateway_reference: string | null;
  status: string;
}

/**
 * The worker pins a leg behind any linked non-terminal refund row whatever
 * its amount (collectAwaitingCancellationRefundLegs ignores amounts, and the
 * SQL pending gate counts a non-positive amount as pending), so it neither
 * re-refunds nor lets the merchant repay by hand.
 */
function workerPinsLeg(row: Refund): boolean {
  const { awaitingRefundPaymentIds, reviewRefundPaymentIds } =
    collectAwaitingCancellationRefundLegs({
      linkedPaymentId: () => 'pay-1',
      refundRows: [
        {
          gateway_reference: row.gateway_reference,
          metadata: {},
          status: row.status,
        },
      ],
    });
  return (
    awaitingRefundPaymentIds.has('pay-1') || reviewRefundPaymentIds.has('pay-1')
  );
}

const cases: [string, Refund][] = [
  [
    'zero-amount refund_pending',
    { amount: 0, gateway_reference: '123', status: 'refund_pending' },
  ],
  [
    'negative-amount refund_pending',
    { amount: -100, gateway_reference: '123', status: 'refund_pending' },
  ],
  [
    'NaN-amount pending',
    { amount: Number.NaN, gateway_reference: null, status: 'pending' },
  ],
  [
    'zero-amount processing',
    { amount: 0, gateway_reference: null, status: 'processing' },
  ],
];

describe('cancel refund plan parity: in-flight rows with unusable amounts', () => {
  it.each(cases)('%s', (_name, row) => {
    expect(workerPinsLeg(row)).toBe(true);
    const plan = getCancelRefundPlan({
      amountPaid: 100,
      orderCurrency: 'NGN',
      paymentStatus: 'Paid',
      total: 100,
      transactions: [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'paystack',
          gateway_reference: 'ref',
          id: 'pay-1',
          status: 'completed',
          transaction_type: 'payment',
        },
        {
          ...row,
          currency: 'NGN',
          gateway: 'paystack',
          id: 'r1',
          payment_transaction_id: 'pay-1',
          transaction_type: 'refund',
        },
      ],
    });
    expect(plan.ledgerKnown).toBe(false);
  });
});
