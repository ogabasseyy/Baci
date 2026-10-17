import type { SupabaseClient } from '@supabase/supabase-js';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import { DeliveryUncertainError } from '@/lib/orders/run-order-cancellation-side-effect';
import { fetchAllOrderRefundRows } from './fetch-all-order-refund-rows';
import {
  allFailedLegsCoveredByReplacements,
  type FailedRefundRow,
  type ReplacementRefundRow,
} from './match-contradictory-refund-replacement';

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

/**
 * Decide a failure alert on an order still marked refunded. Returns true
 * when no failed verdict is current (the queued failure was superseded
 * by a later non-failure verdict) or when every failed refund row has
 * postdating provider-verified completed refunds covering its own
 * payment leg, each replacement spent once — durable evidence that
 * later successful replacement refunds superseded them all. Otherwise
 * the failure is fresh contradiction: file a falsely-refunded review
 * and return false so the caller still sends the merchant alert. Throws
 * on lookup/file failures so the notification retries instead of
 * silently dropping the contradiction.
 */
export async function resolveContradictoryRefundFailure(
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>,
  row: ContradictionRow,
  order: ContradictionOrder
): Promise<boolean> {
  const refundRows = await fetchAllOrderRefundRows(supabase, {
    columns:
      'id, gateway_reference, amount, currency, gateway, metadata, created_at',
    completedOnly: false,
    merchantId: row.merchant_id,
    orderId: row.order_id,
  });
  const failedRows = (refundRows as unknown as FailedRefundRow[]).filter(
    (refund) =>
      ['failed', 'needs-attention'].includes(
        (refund.metadata as { provider_refund_status?: unknown } | null)
          ?.provider_refund_status as string
      )
  );
  // No shared timestamp floor: coverage timing is evaluated per failed
  // leg in code, since the shared notification row's timestamp resets
  // when any leg fails. Both terminal statuses count: a replacement
  // stored with the legacy refunded label is completed money, and a
  // completed-only scan would file a false contradiction for it.
  const replacementsList = (
    (await fetchAllOrderRefundRows(supabase, {
      columns: 'id, amount, currency, gateway, metadata, created_at, status',
      completedOnly: false,
      merchantId: row.merchant_id,
      orderId: row.order_id,
    })) as unknown as ReplacementRefundRow[]
  ).filter((refund) => ['completed', 'refunded'].includes(refund.status));
  // Every failed leg needs its own later coverage, and each
  // replacement is spent once: suppressing on any single match — or
  // reusing one replacement across two failed rows — would mark the
  // order-level notification sent without delivery while other failed
  // legs get neither alert nor review.
  const allLegsCovered = allFailedLegsCoveredByReplacements(
    failedRows,
    replacementsList
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
