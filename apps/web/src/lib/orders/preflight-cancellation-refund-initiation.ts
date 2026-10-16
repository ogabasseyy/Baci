import type { SupabaseClient } from '@supabase/supabase-js';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { isUnverifiedManualPaystackRefund } from '@/lib/orders/is-unverified-manual-paystack-refund';
import { normalizeRefundMoneyField } from '@/lib/orders/normalize-refund-money-field';
import type { CancellationOrder } from '@/lib/orders/order-cancellation-side-effect-types';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import { schedulePreflightProviderVerification } from '@/lib/orders/schedule-preflight-provider-verification';
import { stampVerifiedManualPaystackRefunds } from '@/lib/orders/stamp-verified-manual-paystack-refunds';
import { normalizePaymentGateway } from '@/lib/payments/normalize-payment-gateway';

export interface CancellationRefundLedgerRow {
  amount: number;
  currency?: string | null;
  gateway?: unknown;
  gateway_reference?: string | null;
  id: string;
  metadata: Record<string, unknown> | null;
  status: string;
}

/**
 * Build the initiation set and run the initiation-time preflights.
 * Withheld (mismatched, audit-blocked) and fully refunded legs need no
 * initiation, so the currency, amount-cap, and provider guards scope to
 * outstanding initiation legs only — a settled foreign-currency leg must
 * not strand the remaining legs. Manual Paystack claims verify in a
 * separate set: they never initiate (merchant money plus a provider
 * refund would double-pay), but provider confirmation converts the
 * claim into stamped coverage instead of a blind quarantine.
 * When the window fits some verifications but not all, returns the
 * verified prefix with budgetDeferred so the run initiates it and
 * resumes the remainder next tick; only a window too short for any
 * verification throws. Initiated refunds persist per leg, so every
 * budget-deferred run still converges.
 */
export async function preflightCancellationRefundInitiation({
  auditBlockedLegIds,
  deadlineMs,
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
  deadlineMs?: number;
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
  budgetDeferred: boolean;
  budgetSkippedManualLegIds: string[];
  initiationTransactions: GatewayPaymentTransaction[];
  verifiedManualPaystackLegIds: string[];
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
  // A direct throw would terminalize the step without evidence, so
  // file the reconciliation review first like the other terminal
  // preflight paths.
  // Legacy orders may carry a null or blank currency while their
  // legs price in NGN: default the order side exactly like the
  // manager, or every automatic retry quarantines a perfectly
  // ordinary NGN order. Legs keep strict matching — a blank leg
  // currency is genuinely unevaluable, not legacy.
  const orderCurrency = normalizeRefundMoneyField(order.currency) || 'NGN';
  const mismatchedCurrencyLegs = outstandingTransactions.filter(
    (transaction) =>
      !normalizeRefundMoneyField(transaction.currency) ||
      normalizeRefundMoneyField(transaction.currency) !== orderCurrency
  );
  if (mismatchedCurrencyLegs.length > 0) {
    await quarantineRefund({
      order,
      preflight: true,
      reason: 'Payment currency requires review before refund',
      supabase,
      transactions: mismatchedCurrencyLegs,
    });
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
  const paystackLegs = outstandingTransactions.filter(
    (
      transaction
    ): transaction is GatewayPaymentTransaction & {
      gateway_reference: string;
    } =>
      normalizePaymentGateway(transaction.gateway) === 'PAYSTACK' &&
      transaction.gateway_reference !== null &&
      transaction.gateway_reference !== ''
  );
  // Manual Paystack claims verify like provider legs: a merchant record
  // against an external Paystack leg carries the merchant reference,
  // not the provider ID, so the check pairs it by exact amount. Manual
  // legs never initiate, so without this set the leg skips the check
  // and the withheld handling quarantines it even when the provider
  // holds an exactly matching processed refund. Reference-less and
  // non-Paystack manual legs stay out: with nothing to list, no
  // provider proof can confirm them. A leg stays in even when other
  // rows already cover it: the claim itself still needs provider
  // proof, or settlement completes while the manager reports the
  // claim pending and no drain revisits it.
  const manualVerifyLegs = transactions.filter(
    (
      transaction
    ): transaction is GatewayPaymentTransaction & {
      gateway_reference: string;
    } =>
      manualLinkedLegIds.has(transaction.id) &&
      normalizePaymentGateway(transaction.gateway) === 'PAYSTACK' &&
      transaction.gateway_reference !== null &&
      transaction.gateway_reference !== '' &&
      (refundRows ?? []).some(
        (row) =>
          (row.status === 'completed' || row.status === 'refunded') &&
          linkedPaymentId(row) === transaction.id &&
          isUnverifiedManualPaystackRefund(row)
      )
  );
  const verifiedPaystackLegIds = new Set<string>();
  const verifiedManualPaystackLegIds: string[] = [];
  let budgetShortfall = false;
  const hasVerifiedPrefix = () =>
    verifiedPaystackLegIds.size > 0 || verifiedManualPaystackLegIds.length > 0;
  const verifyLeg = async (
    transaction: GatewayPaymentTransaction & { gateway_reference: string },
    reserveInitiation: boolean
  ): Promise<boolean> => {
    const verified = await schedulePreflightProviderVerification({
      deadlineMs,
      hasVerifiedPrefix: hasVerifiedPrefix(),
      linkedPaymentId,
      order,
      refundRows: refundRows ?? [],
      reserveInitiation,
      supabase,
      transaction,
    });
    if (!verified) budgetShortfall = true;
    return verified;
  };
  // Provider legs initiate in this run, so their verification
  // reserves an initiation leg; manual legs only stamp proof.
  for (const transaction of paystackLegs) {
    if (!(await verifyLeg(transaction, true))) break;
    verifiedPaystackLegIds.add(transaction.id);
  }
  // A verified manual claim persists its proof before the caller
  // quarantines withheld legs: the stamp converts the merchant claim
  // into coverage, and the returned ids keep provider-confirmed legs
  // out of the blind quarantine. Check failures quarantine with
  // provider-specific evidence inside the check itself. Legs past a
  // budget shortfall are named so the caller defers (not
  // quarantines) their unverified claims next run.
  const budgetSkippedManualLegIds: string[] = [];
  for (const [manualIndex, transaction] of manualVerifyLegs.entries()) {
    if (!(await verifyLeg(transaction, false))) {
      budgetSkippedManualLegIds.push(
        ...manualVerifyLegs.slice(manualIndex).map((skipped) => skipped.id)
      );
      break;
    }
    await stampVerifiedManualPaystackRefunds({
      linkedPaymentId,
      refundRows: refundRows ?? [],
      supabase,
      transactionId: transaction.id,
    });
    verifiedManualPaystackLegIds.push(transaction.id);
  }
  // Without a shortfall every paystack leg verified and the filter
  // below is identity; with one, unverified legs wait for the resume
  // instead of initiating unchecked. Non-paystack legs never needed
  // verification, so they ride along either way.
  const paystackLegIds = new Set(paystackLegs.map((leg) => leg.id));
  return {
    auditBlockedTransactions,
    budgetDeferred: budgetShortfall,
    budgetSkippedManualLegIds,
    initiationTransactions: initiationTransactions.filter(
      (transaction) =>
        !paystackLegIds.has(transaction.id) ||
        verifiedPaystackLegIds.has(transaction.id)
    ),
    verifiedManualPaystackLegIds,
  };
}
