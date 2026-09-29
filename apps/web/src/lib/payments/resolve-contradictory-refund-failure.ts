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

/**
 * Decide a failure alert on an order still marked refunded. Returns true
 * only when a completed refund row postdates the failure — durable
 * evidence that a later successful replacement refund superseded it.
 * Otherwise the failure is fresh contradiction: file a falsely-refunded
 * review and return false so the caller still sends the merchant alert.
 * Throws on lookup/file failures so the notification retries instead of
 * silently dropping the contradiction.
 */
export async function resolveContradictoryRefundFailure(
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>,
  row: ContradictionRow,
  order: ContradictionOrder
): Promise<boolean> {
  const { data: replacements, error: replacementError } = await supabase
    .from('transactions')
    .select('id')
    .eq('order_id', row.order_id)
    .eq('merchant_id', row.merchant_id)
    .eq('transaction_type', 'refund')
    .eq('status', 'completed')
    .gt('created_at', row.created_at)
    .limit(1);
  if (replacementError) {
    throw new Error('refund_notification_replacement_lookup_failed');
  }
  if ((replacements ?? []).length > 0) return true;

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
