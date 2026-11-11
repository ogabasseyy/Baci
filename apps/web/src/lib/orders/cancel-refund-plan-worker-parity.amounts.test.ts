import { getCancelRefundPlan } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import { classifyCancellationRefundLinks } from './classify-cancellation-refund-links';
import { collectAwaitingCancellationRefundLegs } from './collect-awaiting-cancellation-refund-legs';
import type { GatewayPaymentTransaction } from './gateway-payment-transaction';
import { isExternalPaymentGateway } from './is-external-payment-gateway';
import { matchCancellationRefundCoverage } from './match-cancellation-refund-coverage';
import { soleCompletedCancellationLeg } from './sole-completed-cancellation-leg';

interface Row {
  amount: number;
  currency: string;
  gateway: string;
  gateway_reference?: string | null;
  id: string;
  payment_transaction_id?: string | null;
  provider_refund_status?: string | null;
  status: string;
  transaction_type: 'payment' | 'refund';
}

/**
 * What the worker does with a non-quarantined ledger, from its own helpers:
 * `initiate` is the sum of the outstanding legs it would refund, `inFlight`
 * the legs it waits on (awaiting provider, or unverified Paystack rows), and
 * `automatic` whether every leg it would initiate is a Paystack leg with a
 * provider reference (others go to manual recovery). Quarantine itself is
 * covered by the ledgerKnown parity table; partially covered legs are
 * withheld by the worker, so the plan reports them as not automatic.
 */
function workerOutcome(rows: Row[]) {
  const payments = rows.filter(
    (r) => r.transaction_type === 'payment' && r.status !== 'refunded'
  ) as unknown as GatewayPaymentTransaction[];
  const legs = payments.filter((leg) => isExternalPaymentGateway(leg.gateway));
  const refundRows = rows
    .filter((r) => r.transaction_type === 'refund')
    .map((r) => ({
      amount: r.amount,
      currency: r.currency,
      gateway: r.gateway,
      gateway_reference: r.gateway_reference ?? null,
      metadata: {
        payment_transaction_id: r.payment_transaction_id,
        provider_refund_status: r.provider_refund_status,
      },
      status: r.status,
    }));
  const { linkedPaymentId } = classifyCancellationRefundLinks(
    refundRows,
    payments
  );
  const match = matchCancellationRefundCoverage({
    linkedPaymentId,
    orderCurrency: 'NGN',
    refundRows,
    soleCompletedLegId: soleCompletedCancellationLeg(legs)?.id ?? null,
    transactions: payments,
  });
  const { awaitingRefundPaymentIds } = collectAwaitingCancellationRefundLegs({
    linkedPaymentId,
    refundRows,
  });
  const waiting = (id: string) =>
    awaitingRefundPaymentIds.has(id) || match.unverifiedLinkedLegIds.has(id);
  const open = legs.filter(
    (leg) => !match.refundedPaymentIds.has(leg.id) && !waiting(leg.id)
  );
  const sum = (list: GatewayPaymentTransaction[]) =>
    list.reduce((total, leg) => total + Number(leg.amount), 0);
  return {
    automatic: open.every(
      (leg) =>
        String(leg.gateway).toUpperCase() === 'PAYSTACK' &&
        Boolean(leg.gateway_reference)
    ),
    inFlight: sum(legs.filter((leg) => waiting(leg.id))),
    initiate: sum(open),
  };
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
const refund = (over: Partial<Row> = {}): Row => ({
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  id: 'ref-1',
  payment_transaction_id: 'pay-1',
  provider_refund_status: 'processed',
  status: 'completed',
  transaction_type: 'refund',
  ...over,
});

const cases: [string, Row[]][] = [
  ['an uncovered Paystack leg', [pay()]],
  ['a fully refunded Paystack leg', [pay(), refund()]],
  [
    'a Paystack refund awaiting provider verification',
    [pay(), refund({ provider_refund_status: null })],
  ],
  [
    'a refund_pending row with a provider id',
    [pay(), refund({ gateway_reference: '123', status: 'refund_pending' })],
  ],
  ['a Korapay leg (manual recovery)', [pay({ gateway: 'korapay' })]],
  ['a Paystack leg with no reference', [pay({ gateway_reference: null })]],
  [
    'two uncovered legs, one already refunded',
    [pay(), pay({ id: 'pay-2' }), refund()],
  ],
];

describe('cancel refund plan parity: amounts the worker determines', () => {
  it.each(cases)('%s', (_name, rows) => {
    const worker = workerOutcome(rows);
    const plan = getCancelRefundPlan({
      amountPaid: 200,
      orderCurrency: 'NGN',
      paymentStatus: 'Paid',
      total: 200,
      transactions: rows,
    });
    expect(plan.ledgerKnown).toBe(true);
    expect(plan.amount).toBe(worker.initiate);
    expect(plan.inFlightAmount).toBe(worker.inFlight);
    expect(plan.automaticSupported).toBe(worker.automatic);
  });
});
