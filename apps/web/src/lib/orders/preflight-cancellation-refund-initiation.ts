import type { SupabaseClient } from '@supabase/supabase-js';
import { checkCancellationRefundProvider } from '@/lib/orders/check-cancellation-refund-provider';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { normalizeRefundMoneyField } from '@/lib/orders/match-cancellation-refund-coverage';
import type { CancellationOrder } from '@/lib/orders/order-cancellation-side-effect-types';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import { DeliveryUncertainError } from '@/lib/orders/run-order-cancellation-side-effect';
import { normalizePaymentGateway } from '@/lib/payments/normalize-payment-gateway';

interface CancellationRefundLedgerRow {
  amount: number;
  currency?: string | null;
  gateway_reference?: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
}

/**
 * Build the initiation set and run the initiation-time preflights.
 * Withheld (mismatched, audit-blocked) and fully refunded legs need no
 * initiation, so the currency, amount-cap, and provider guards scope to
 * outstanding initiation legs only — a settled foreign-currency leg must
 * not strand the remaining legs. Throws (never returns partial sets).
 */
export async function preflightCancellationRefundInitiation({
  auditBlockedLegIds,
  linkedPaymentId,
  manualLinkedLegIds,
  mismatchedIds,
  order,
  refundedPaymentIds,
  refundRows,
  supabase,
  transactions,
}: {
  auditBlockedLegIds: Set<string>;
  linkedPaymentId: (row: { metadata: unknown }) => string | null;
  manualLinkedLegIds: Set<string>;
  mismatchedIds: Set<string>;
  order: CancellationOrder;
  refundedPaymentIds: Set<string>;
  refundRows: CancellationRefundLedgerRow[] | null;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  transactions: GatewayPaymentTransaction[];
}): Promise<{
  auditBlockedTransactions: GatewayPaymentTransaction[];
  initiationTransactions: GatewayPaymentTransaction[];
}> {
  const auditBlockedTransactions = transactions.filter(
    (transaction) =>
      auditBlockedLegIds.has(transaction.id) &&
      !refundedPaymentIds.has(transaction.id)
  );
  // Legs carrying manual rows never initiate: merchant-attested money
  // plus a provider refund would double-pay the customer.
  const initiationTransactions = transactions.filter(
    (transaction) =>
      !mismatchedIds.has(transaction.id) &&
      !auditBlockedLegIds.has(transaction.id) &&
      !manualLinkedLegIds.has(transaction.id)
  );
  // Fully refunded legs need no initiation: every gate below scopes to
  // the outstanding set so a settled leg cannot strand the rest.
  const outstandingTransactions = initiationTransactions.filter(
    (transaction) => !refundedPaymentIds.has(transaction.id)
  );
  const refundAmount = Number(order.amount_paid) || 0;
  // Currency is an initiation-time property like the kobo cap below:
  // legacy rows pad or re-case ISO codes, so compare normalized values
  // while still rejecting missing or genuinely different currencies.
  if (
    outstandingTransactions.some(
      (transaction) =>
        !normalizeRefundMoneyField(transaction.currency) ||
        normalizeRefundMoneyField(transaction.currency) !==
          normalizeRefundMoneyField(order.currency)
    )
  ) {
    throw new DeliveryUncertainError(
      'Payment currency requires review before refund'
    );
  }
  // Captures may legitimately exceed the recorded amount paid when
  // superseded legs exist (their completed refunds already cover them),
  // but the outstanding initiation itself must never exceed it. An
  // overfunded ledger cannot be repaired by retrying, so file it for
  // reconciliation instead of burning the attempt budget.
  const outstandingRefundKobo = outstandingTransactions.reduce(
    (sum, transaction) => sum + Math.round(Number(transaction.amount) * 100),
    0
  );
  if (outstandingRefundKobo > Math.round(refundAmount * 100)) {
    await quarantineRefund({
      metadata: {
        outstanding_refund_kobo: outstandingRefundKobo,
        recorded_amount_paid: refundAmount,
      },
      order,
      preflight: true,
      reason:
        'Completed captures exceed the recorded amount paid; reconcile the ledger before refunding',
      supabase,
      transactions: outstandingTransactions,
    });
  }
  // Pre-initiation provider guard: an existing Paystack refund the ledger
  // cannot account for must quarantine for review (delivery_uncertain)
  // instead of initiating a duplicate provider refund.
  for (const transaction of outstandingTransactions) {
    if (
      normalizePaymentGateway(transaction.gateway) !== 'PAYSTACK' ||
      !transaction.gateway_reference
    )
      continue;
    await checkCancellationRefundProvider({
      currency: transaction.currency || order.currency || 'NGN',
      knownRefunds: (refundRows ?? []).filter(
        (row) => linkedPaymentId(row) === transaction.id
      ),
      reference: transaction.gateway_reference,
    });
  }
  return { auditBlockedTransactions, initiationTransactions };
}
