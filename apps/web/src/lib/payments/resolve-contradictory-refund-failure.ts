import type { SupabaseClient } from '@supabase/supabase-js';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import { DeliveryUncertainError } from '@/lib/orders/run-order-cancellation-side-effect';

interface ContradictionRow {
  created_at: string;
  merchant_id: string;
  order_id: string;
}

interface ContradictionOrder {
  currency: string | null;
  id: string;
  merchant_id: string;
  order_number: string | null;
}

interface FailedRefundRow {
  amount: number | string | null;
  currency: string | null;
  gateway: string | null;
  gateway_reference: string | null;
  id: string;
  metadata: { payment_transaction_id?: unknown } | null;
}

interface ReplacementRefundRow {
  amount: number | string | null;
  currency: string | null;
  gateway: string | null;
  metadata: { payment_transaction_id?: unknown } | null;
}

/**
 * A postdating completed refund belongs to a failed leg only when it
 * targets that same leg: identical payment leg, gateway, and currency.
 * Anything unmatchable fails closed so the contradiction is filed and
 * alerted.
 */
function replacementMatchesFailedLeg(
  replacement: ReplacementRefundRow,
  failed: FailedRefundRow
): boolean {
  const failedLeg = failed.metadata?.payment_transaction_id;
  if (typeof failedLeg !== 'string' || failedLeg.length === 0) return false;
  if (replacement.metadata?.payment_transaction_id !== failedLeg) return false;
  if (
    typeof replacement.gateway !== 'string' ||
    typeof failed.gateway !== 'string' ||
    replacement.gateway.toLowerCase() !== failed.gateway.toLowerCase()
  ) {
    return false;
  }
  if (
    typeof replacement.currency !== 'string' ||
    typeof failed.currency !== 'string' ||
    replacement.currency.toUpperCase() !== failed.currency.toUpperCase()
  ) {
    return false;
  }
  return true;
}

/**
 * A failed leg is covered only when its matching postdating replacements
 * sum to at least the failed refund's amount: a failed 100-unit refund
 * replaced by two completed 50-unit refunds on the same leg is fully
 * superseded. Malformed amounts fail closed.
 */
function failedLegCoveredByReplacements(
  failed: FailedRefundRow,
  replacements: ReplacementRefundRow[]
): boolean {
  const failedAmount = Number(failed.amount);
  if (!Number.isFinite(failedAmount)) return false;
  let covered = 0;
  for (const replacement of replacements) {
    if (!replacementMatchesFailedLeg(replacement, failed)) continue;
    const replacementAmount = Number(replacement.amount);
    if (!Number.isFinite(replacementAmount)) return false;
    covered += replacementAmount;
  }
  return covered >= failedAmount;
}

/**
 * Decide a failure alert on an order still marked refunded. Returns true
 * only when every failed refund row has a postdating completed refund
 * covering its own payment leg — durable evidence that later successful
 * replacement refunds superseded them all. Otherwise the failure is
 * fresh contradiction: file a falsely-refunded review and return false
 * so the caller still sends the merchant alert. Throws on lookup/file
 * failures so the notification retries instead of silently dropping the
 * contradiction.
 */
export async function resolveContradictoryRefundFailure(
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>,
  row: ContradictionRow,
  order: ContradictionOrder
): Promise<boolean> {
  const { data: refundRows, error: refundError } = await supabase
    .from('transactions')
    .select('id, gateway_reference, amount, currency, gateway, metadata')
    .eq('order_id', row.order_id)
    .eq('merchant_id', row.merchant_id)
    .eq('transaction_type', 'refund')
    .order('created_at', { ascending: false })
    .limit(50);
  if (refundError) {
    throw new Error('refund_notification_replacement_lookup_failed');
  }
  const failedRows = ((refundRows ?? []) as FailedRefundRow[]).filter(
    (refund) =>
      ['failed', 'needs-attention'].includes(
        (refund.metadata as { provider_refund_status?: unknown } | null)
          ?.provider_refund_status as string
      )
  );
  const { data: replacements, error: replacementError } = await supabase
    .from('transactions')
    .select('id, amount, currency, gateway, metadata')
    .eq('order_id', row.order_id)
    .eq('merchant_id', row.merchant_id)
    .eq('transaction_type', 'refund')
    .eq('status', 'completed')
    .gt('created_at', row.created_at)
    .order('created_at', { ascending: false })
    .limit(50);
  if (replacementError) {
    throw new Error('refund_notification_replacement_lookup_failed');
  }
  // Every failed leg needs its own later coverage: suppressing on any
  // single match would mark the order-level notification sent without
  // delivery while other failed legs get neither alert nor review.
  const replacementsList = (replacements ?? []) as ReplacementRefundRow[];
  const allLegsCovered =
    failedRows.length > 0 &&
    failedRows.every((failed) =>
      failedLegCoveredByReplacements(failed, replacementsList)
    );
  if (allLegsCovered) return true;

  const failedPaymentIds = [
    ...new Set(
      failedRows
        .map((refund) => refund.metadata?.payment_transaction_id)
        .filter(
          (paymentId): paymentId is string =>
            typeof paymentId === 'string' && paymentId.length > 0
        )
    ),
  ];
  let paymentLegs: GatewayPaymentTransaction[] = [];
  if (failedPaymentIds.length > 0) {
    const { data: legs, error: legsError } = await supabase
      .from('transactions')
      .select('id, amount, currency, gateway, gateway_reference')
      .eq('order_id', row.order_id)
      .eq('merchant_id', row.merchant_id)
      .eq('transaction_type', 'payment')
      .in('id', failedPaymentIds);
    if (legsError) {
      throw new Error('refund_notification_replacement_lookup_failed');
    }
    paymentLegs = (legs ?? []) as GatewayPaymentTransaction[];
  }
  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  try {
    await quarantineRefund({
      // Plural ID keys on purpose: the completion gate keeps reviews
      // with a lone failed_payment_transaction_id open as
      // legacy-ambiguous, while this contradiction must auto-close once
      // a replacement refund verifies.
      metadata: {
        contradictory_refund_failure: true,
        failed_payment_transaction_ids: failedPaymentIds,
        failed_refund_ids: failedRows.map((refund) => refund.id),
      },
      order: {
        currency: order.currency,
        id: order.id,
        merchant_id: order.merchant_id,
      },
      preflight: true,
      reason: `Paystack reports a failed cancellation refund for order #${orderNumber} still marked refunded`,
      supabase,
      transactions: paymentLegs,
    });
    // Reached only when the filer is mocked; production always throws
    // below, filed or not.
    return false;
  } catch (error) {
    // quarantineRefund signals a filed (or merged) review by throwing
    // DeliveryUncertainError; any other error means the evidence was
    // not persisted and the notification must retry.
    if (error instanceof DeliveryUncertainError) return false;
    throw error;
  }
}
