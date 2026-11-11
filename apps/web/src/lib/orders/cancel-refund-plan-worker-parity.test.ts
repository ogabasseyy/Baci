import { getCancelRefundPlan } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import { classifyCancellationRefundLinks } from './classify-cancellation-refund-links';
import type { GatewayPaymentTransaction } from './gateway-payment-transaction';
import { isExternalPaymentGateway } from './is-external-payment-gateway';
import { matchCancellationRefundCoverage } from './match-cancellation-refund-coverage';
import { soleCompletedCancellationLeg } from './sole-completed-cancellation-leg';

interface Row {
  amount: number;
  currency?: string | null;
  gateway: string | null;
  gateway_reference?: string | null;
  id: string;
  payment_transaction_id?: string | null;
  provider_refund_status?: string | null;
  refund_method?: string | null;
  status: string;
  transaction_type: 'payment' | 'refund';
}

const FUNDED = new Set(['completed', 'refund_pending', 'refunded']);

/**
 * The quarantine decision the cancellation worker makes for unattributable or
 * unreconcilable refund evidence, assembled exactly like
 * executeOrderCancellationSideEffect + preflightCancellationRefundCoverage.
 */
function workerQuarantines(rows: Row[], orderCurrency: string): boolean {
  const payments = rows.filter(
    (row) => row.transaction_type === 'payment' && FUNDED.has(row.status)
  ) as unknown as GatewayPaymentTransaction[];
  const allLegs = payments.filter((leg) => leg.status !== 'refunded');
  const transactions = allLegs.filter((leg) =>
    isExternalPaymentGateway(leg.gateway)
  );
  const sole = soleCompletedCancellationLeg(transactions);
  const refundRows = rows
    .filter((row) => row.transaction_type === 'refund')
    .map((row) => ({
      amount: row.amount,
      currency: row.currency,
      gateway: row.gateway,
      gateway_reference: row.gateway_reference,
      metadata: {
        method: row.refund_method,
        payment_transaction_id: row.payment_transaction_id,
        provider_refund_status: row.provider_refund_status,
      },
      status: row.status,
    }));
  const { invalidLinkReason, linkedPaymentId, unlinkedRefunds } =
    classifyCancellationRefundLinks(refundRows, payments);
  const match = matchCancellationRefundCoverage({
    linkedPaymentId,
    orderCurrency,
    refundRows,
    soleCompletedLegId: sole?.id ?? null,
    transactions: allLegs,
  });
  const soleCovered =
    sole !== null &&
    (match.refundedPaymentIds.has(sole.id) ||
      match.unverifiedLinkedLegIds.has(sole.id));
  const mismatched = match.mismatchedTransactions.filter(
    (leg) => !match.unverifiedLinkedLegIds.has(leg.id)
  );
  // preflightCancellationRefundInitiation: open initiation legs whose
  // currency is blank or differs from the order's quarantine for review.
  const mismatchedIds = new Set(match.mismatchedTransactions.map((l) => l.id));
  const orderCcy = String(orderCurrency).trim().toUpperCase() || 'NGN';
  const currencyQuarantine = transactions.some(
    (leg) =>
      !match.refundedPaymentIds.has(leg.id) &&
      !mismatchedIds.has(leg.id) &&
      !match.manualLinkedLegIds.has(leg.id) &&
      (String(leg.currency ?? '')
        .trim()
        .toUpperCase() === '' ||
        String(leg.currency ?? '')
          .trim()
          .toUpperCase() !== orderCcy)
  );
  return (
    currencyQuarantine ||
    invalidLinkReason !== null ||
    match.unattributedUnlinkedCount > 0 ||
    (unlinkedRefunds.length > 0 && !soleCovered) ||
    mismatched.length > 0
  );
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
const unlinked = (over: Partial<Row> = {}) =>
  refund({ payment_transaction_id: null, ...over });

const cases: [string, Row[], boolean][] = [
  ['no refunds', [pay()], false],
  ['full linked processed Paystack refund', [pay(), refund()], false],
  ['partial linked processed refund', [pay(), refund({ amount: 20 })], true],
  [
    'partial unverified linked Paystack refund (the worker waits for verification)',
    [pay(), refund({ amount: 20, provider_refund_status: null })],
    false,
  ],
  [
    'unverified unlinked Paystack refund on the sole leg',
    [pay(), unlinked({ provider_refund_status: null })],
    false,
  ],
  [
    'unverified linked Paystack refund',
    [pay(), refund({ provider_refund_status: null })],
    false,
  ],
  [
    'linked pending refund row',
    [pay(), refund({ status: 'refund_pending' })],
    false,
  ],
  ['linked zero-amount completed refund', [pay(), refund({ amount: 0 })], true],
  [
    'stale-link completed refund',
    [pay(), refund({ payment_transaction_id: 'gone' })],
    true,
  ],
  [
    'stale-link pending refund',
    [pay(), refund({ payment_transaction_id: 'gone', status: 'pending' })],
    true,
  ],
  ['unlinked full refund on the sole leg', [pay(), unlinked()], false],
  [
    'unlinked partial refund on the sole leg',
    [pay(), unlinked({ amount: 20 })],
    true,
  ],
  [
    'unlinked refund with two completed legs',
    [pay(), pay({ id: 'pay-2' }), unlinked()],
    true,
  ],
  [
    'unlinked processing refund',
    [pay(), unlinked({ status: 'processing' })],
    true,
  ],
  [
    'unlinked recoverable failed refund',
    [
      pay(),
      unlinked({
        gateway_reference: '4242',
        provider_refund_status: 'failed',
        status: 'failed',
      }),
    ],
    true,
  ],
  [
    'unlinked dead failed refund',
    [pay(), unlinked({ provider_refund_status: 'failed', status: 'failed' })],
    true,
  ],
  [
    'unlinked refund in another gateway (Korapay) on a Paystack leg',
    [pay(), unlinked({ gateway: 'korapay' })],
    true,
  ],
  [
    'unlinked refund in another currency',
    [pay(), unlinked({ currency: 'USD' })],
    true,
  ],
  [
    'Korapay leg with a linked Korapay refund',
    [
      pay({ gateway: 'korapay' }),
      refund({ gateway: 'korapay', provider_refund_status: null }),
    ],
    false,
  ],
  [
    'Korapay leg with an unlinked Korapay refund',
    [
      pay({ gateway: 'korapay' }),
      unlinked({ gateway: 'korapay', provider_refund_status: null }),
    ],
    false,
  ],
  [
    'Korapay refund linked to a Paystack leg',
    [pay(), refund({ gateway: 'korapay' })],
    true,
  ],
  [
    'linked refund in another currency than its leg',
    [pay(), refund({ currency: 'USD' })],
    true,
  ],
  [
    'linked refund outside the order currency on a matching USD leg',
    [pay({ currency: 'USD' }), refund({ currency: 'USD' })],
    true,
  ],
  [
    'linked manual refund covering the leg',
    [pay(), refund({ gateway: 'manual', provider_refund_status: null })],
    false,
  ],
  [
    'linked manual refund in another currency',
    [pay(), refund({ currency: 'USD', gateway: 'manual' })],
    true,
  ],
  [
    'linked unverified manual Paystack declaration',
    [
      pay(),
      refund({
        gateway: 'manual',
        provider_refund_status: null,
        refund_method: 'paystack',
      }),
    ],
    true,
  ],
  ['unlinked manual refund', [pay(), unlinked({ gateway: 'manual' })], true],
  [
    'a second open leg in another currency',
    [pay(), pay({ currency: 'USD', id: 'pay-2' })],
    true,
  ],
  ['an open leg with no currency', [pay({ currency: null })], true],
  [
    'an open leg in another currency than the order',
    [pay({ currency: 'USD' })],
    true,
  ],
  [
    'unlinked refund covering the completed leg beside a refunded sibling',
    [pay(), pay({ id: 'pay-2', status: 'refunded' }), unlinked()],
    false,
  ],
  [
    'unlinked refund covering the completed leg beside a refund_pending sibling',
    [pay(), pay({ id: 'pay-2', status: 'refund_pending' }), unlinked()],
    false,
  ],
  [
    'refund linked to an already-refunded leg',
    [pay({ status: 'refunded' }), pay({ id: 'pay-2' }), refund()],
    false,
  ],
];

describe('cancel refund plan parity with the cancellation worker', () => {
  it.each(cases)('%s', (_name, rows, quarantines) => {
    expect(workerQuarantines(rows, 'NGN')).toBe(quarantines);
    const plan = getCancelRefundPlan({
      orderCurrency: 'NGN',
      paymentStatus: 'Paid',
      total: 100,
      transactions: rows,
    });
    expect(plan.ledgerKnown).toBe(!quarantines);
  });
});
