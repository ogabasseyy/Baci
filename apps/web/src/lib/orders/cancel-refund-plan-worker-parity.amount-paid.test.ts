import { getCancelRefundPlan } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import { classifyCancellationRefundLinks } from './classify-cancellation-refund-links';
import type { GatewayPaymentTransaction } from './gateway-payment-transaction';
import { isExternalPaymentGateway } from './is-external-payment-gateway';
import { matchCancellationRefundCoverage } from './match-cancellation-refund-coverage';

interface Row {
  amount: number;
  currency: string;
  gateway: string;
  gateway_reference?: string;
  id: string;
  status: string;
  transaction_type: 'payment';
}

/**
 * preflightCancellationRefundInitiation's overfunded-ledger quarantine: the
 * outstanding (not refunded) captures must not exceed the recorded paid
 * amount, where a zero total derives from the funded legs.
 */
function workerQuarantinesOverfunded(rows: Row[], amountPaid: number) {
  const payments = rows as unknown as GatewayPaymentTransaction[];
  const legs = payments.filter((leg) => isExternalPaymentGateway(leg.gateway));
  const { linkedPaymentId } = classifyCancellationRefundLinks([], payments);
  const match = matchCancellationRefundCoverage({
    linkedPaymentId,
    orderCurrency: 'NGN',
    refundRows: [],
    soleCompletedLegId: null,
    transactions: legs,
  });
  const outstandingKobo = legs
    .filter((leg) => !match.refundedPaymentIds.has(leg.id))
    .reduce((sum, leg) => sum + Math.round(Number(leg.amount) * 100), 0);
  const derived = rows.reduce((sum, row) => sum + row.amount, 0);
  const paid = amountPaid === 0 ? derived : amountPaid;
  return outstandingKobo > Math.round(paid * 100);
}

const pay = (over: Partial<Row> = {}): Row => ({
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'ref',
  id: 'pay-1',
  status: 'completed',
  transaction_type: 'payment',
  ...over,
});

const cases: [string, Row[], number, boolean][] = [
  ['one capture within the recorded amount', [pay()], 100, false],
  [
    'two uncovered captures above the recorded amount',
    [pay(), pay({ id: 'pay-2' })],
    100,
    true,
  ],
  [
    'two captures within a larger recorded amount',
    [pay(), pay({ id: 'pay-2' })],
    200,
    false,
  ],
  [
    'a never-stamped zero amount derived from the funded legs',
    [pay(), pay({ id: 'pay-2' })],
    0,
    false,
  ],
];

describe('cancel refund plan parity: recorded amount paid', () => {
  it.each(cases)('%s', (_name, rows, amountPaid, quarantines) => {
    expect(workerQuarantinesOverfunded(rows, amountPaid)).toBe(quarantines);
    const plan = getCancelRefundPlan({
      amountPaid,
      orderCurrency: 'NGN',
      paymentStatus: 'Paid',
      total: 100,
      transactions: rows,
    });
    expect(plan.ledgerKnown).toBe(!quarantines);
  });
});
