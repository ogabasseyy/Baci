import { getCancelRefundPlan } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import { collectAwaitingCancellationRefundLegs } from './collect-awaiting-cancellation-refund-legs';
import type { GatewayPaymentTransaction } from './gateway-payment-transaction';
import { matchCancellationRefundCoverage } from './match-cancellation-refund-coverage';

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

/**
 * Terminal rows: a completed refund with a zero or negative amount never
 * covers its leg for the worker (it is withheld as a coverage mismatch or
 * left pending for the merchant), so it can neither settle nor be summed.
 */
describe('cancel refund plan parity: terminal rows with unusable amounts', () => {
  const leg = {
    amount: 100,
    currency: 'NGN',
    gateway: 'paystack',
    gateway_reference: 'ref',
    id: 'pay-1',
    status: 'completed',
    transaction_type: 'payment',
  } as unknown as GatewayPaymentTransaction;

  it.each([
    ['negative manual', -20, 'manual'],
    ['zero manual', 0, 'manual'],
    ['zero verified Paystack', 0, 'paystack'],
    ['negative verified Paystack', -20, 'paystack'],
  ])('%s row', (_name, amount, gateway) => {
    const refundRows = [
      {
        amount,
        currency: 'NGN',
        gateway,
        gateway_reference: null,
        metadata: {
          method: gateway === 'manual' ? 'cash' : undefined,
          payment_transaction_id: 'pay-1',
          provider_refund_status: 'processed',
        },
        status: 'completed',
      },
    ];
    const match = matchCancellationRefundCoverage({
      linkedPaymentId: () => 'pay-1',
      orderCurrency: 'NGN',
      refundRows,
      soleCompletedLegId: 'pay-1',
      transactions: [leg],
    });
    expect(match.refundedPaymentIds.has('pay-1')).toBe(false);
    expect(
      match.mismatchedTransactions.length > 0 ||
        match.manualPendingLegIds.has('pay-1')
    ).toBe(true);
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
          amount,
          currency: 'NGN',
          gateway,
          id: 'r1',
          payment_transaction_id: 'pay-1',
          provider_refund_status: 'processed',
          status: 'completed',
          transaction_type: 'refund',
        },
      ],
    });
    expect(plan.ledgerKnown).toBe(false);
    expect(plan.amount).toBeLessThanOrEqual(100);
  });
});
