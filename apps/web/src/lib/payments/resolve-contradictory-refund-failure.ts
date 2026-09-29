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
  created_at: string;
  currency: string | null;
  gateway: string | null;
  gateway_reference: string | null;
  id: string;
  metadata: { payment_transaction_id?: unknown } | null;
}

interface ReplacementRefundRow {
  amount: number | string | null;
  created_at: string;
  currency: string | null;
  gateway: string | null;
  id: string;
  metadata: {
    payment_transaction_id?: unknown;
    provider_refund_status?: unknown;
  } | null;
}

const REFUND_SCAN_PAGE_SIZE = 50;

/**
 * Fetch every refund row for the order, newest or oldest first — the
 * caller matches in code, so only completeness matters. Keyset
 * pagination by id (never an offset or a newest-N cap): omitting an
 * older uncovered failed row would falsely report all legs covered
 * and mark the shared notification sent without delivery.
 */
async function fetchAllOrderRefundRows(
  supabase: Pick<SupabaseClient, 'from'>,
  {
    columns,
    completedOnly,
    merchantId,
    orderId,
  }: {
    columns: string;
    completedOnly: boolean;
    merchantId: string;
    orderId: string;
  }
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const builder = supabase
      .from('transactions')
      .select(columns)
      .eq('order_id', orderId)
      .eq('merchant_id', merchantId)
      .eq('transaction_type', 'refund')
      .order('id', { ascending: true });
    if (completedOnly) builder.eq('status', 'completed');
    if (cursor !== null) builder.gt('id', cursor);
    const { data, error } = await builder.limit(REFUND_SCAN_PAGE_SIZE);
    if (error) {
      throw new Error('refund_notification_replacement_lookup_failed');
    }
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < REFUND_SCAN_PAGE_SIZE) break;
    const lastId = page[page.length - 1]?.id;
    // An id-less row cannot anchor the next page: retry the whole scan
    // rather than silently evaluating a partial set.
    if (typeof lastId !== 'string') {
      throw new Error('refund_notification_replacement_lookup_failed');
    }
    cursor = lastId;
  }
  return rows;
}

/**
 * A replacement suppresses a failed leg only when it both targets that
 * same leg (identical payment leg, gateway, and currency) and was
 * created after the failure itself. Timing is per leg, not per the
 * shared notification row: a later failure on another leg resets the
 * notification's timestamp, which would otherwise exclude an earlier
 * leg's valid replacement and alert falsely. A Paystack replacement
 * counts only after provider verification, mirroring the completion
 * ledger: a locally completed row Paystack later rejects must not
 * suppress the alert. Anything unmatchable or unparseable fails closed
 * so the contradiction is filed and alerted.
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
  // A locally completed Paystack refund counts only after it is
  // provider-verified; other gateways keep local-status trust.
  if (
    replacement.gateway.toLowerCase() === 'paystack' &&
    replacement.metadata?.provider_refund_status !== 'processed'
  ) {
    return false;
  }
  const replacedAt = Date.parse(replacement.created_at);
  const failedAt = Date.parse(failed.created_at);
  if (!Number.isFinite(replacedAt) || !Number.isFinite(failedAt)) {
    return false;
  }
  return replacedAt > failedAt;
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
 * only when every failed refund row has a postdating provider-verified
 * completed refund covering its own payment leg — durable evidence that
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
  // when any leg fails.
  const replacementsList = (await fetchAllOrderRefundRows(supabase, {
    columns: 'id, amount, currency, gateway, metadata, created_at',
    completedOnly: true,
    merchantId: row.merchant_id,
    orderId: row.order_id,
  })) as unknown as ReplacementRefundRow[];
  // Every failed leg needs its own later coverage: suppressing on any
  // single match would mark the order-level notification sent without
  // delivery while other failed legs get neither alert nor review.
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
