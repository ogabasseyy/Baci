import { getCancelRefundPlan } from '@baci/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { readPersistedCancellationRefundMode } from '@/lib/orders/read-persisted-cancellation-refund-mode';

export type CancellationRefundOutcome =
  | 'manual_required'
  | 'queued_if_required'
  | 'unknown';

export interface CancellationRefundDetails {
  currency: string | null;
  /** Provider refund already in flight: never to be refunded by hand. */
  inFlightAmount: number;
  /** What a cancel-only merchant still has to refund themselves. */
  remainingAmount: number;
}

export interface ResolvedCancellationRefund {
  details?: CancellationRefundDetails;
  outcome: CancellationRefundOutcome;
}

/**
 * What the cancel response tells clients about the refund. Never claims
 * `manual_required` unless it is certain: that wording tells a merchant to
 * repay by hand, which double-pays if an automatic refund is queued or in
 * flight. A persisted-mode read failure or an unreadable ledger reports
 * `unknown`. For a cancel-only order the ledger plan supplies authoritative
 * amounts: the part already being refunded by the provider and the part the
 * merchant must still refund; when nothing remains for the merchant the
 * outcome is `queued_if_required`.
 */
export async function resolveCancellationRefundOutcome({
  alreadyCancelled,
  merchantId,
  orderId,
  requested,
  supabase,
}: {
  alreadyCancelled: boolean;
  merchantId: string;
  orderId: string;
  requested: 'automatic' | 'manual';
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
}): Promise<ResolvedCancellationRefund> {
  let mode: 'automatic' | 'manual' = requested;
  if (alreadyCancelled) {
    const persisted = await readPersistedCancellationRefundMode({
      merchantId,
      orderId,
      supabase,
    });
    if (persisted === null) return { outcome: 'unknown' };
    mode = persisted;
  }
  if (mode === 'automatic') return { outcome: 'queued_if_required' };
  try {
    // Open provider-refund evidence means money may already have moved: never
    // confirm a manual repayment while it is unresolved (or unreadable).
    const { data: hasEvidence, error: evidenceError } = await supabase.rpc(
      'order_has_unresolved_refund_evidence',
      { p_order_id: orderId }
    );
    if (evidenceError || hasEvidence !== false) return { outcome: 'unknown' };
    // The order's own currency (explicit column, merchant-scoped): never infer
    // it from a capture, or a single foreign-currency capture would pass the
    // plan's currency check. A failed read reports unknown.
    const { data: orderRow, error: orderError } = await supabase
      .from('orders')
      .select('currency, amount_paid, payment_status, total')
      .eq('id', orderId)
      .eq('merchant_id', merchantId)
      .maybeSingle();
    if (orderError || !orderRow) return { outcome: 'unknown' };
    const { data, error } = await supabase
      .from('transactions')
      .select(
        'id, amount, currency, gateway, gateway_reference, status, transaction_type, payment_transaction_id:metadata->>payment_transaction_id, provider_refund_status:metadata->>provider_refund_status, provider_refund_id:metadata->>provider_refund_id, refund_method:metadata->>method'
      )
      .eq('order_id', orderId)
      .eq('merchant_id', merchantId)
      .in('transaction_type', ['payment', 'refund']);
    if (error || !data) {
      logger.warn({
        message: 'Could not read the ledger for a cancel-only order',
        orderId,
        merchantId,
        error,
      });
      return { outcome: 'unknown' };
    }
    const rows = data as unknown as Array<{
      amount: number | string;
      currency: string | null;
      gateway: string | null;
      gateway_reference: string | null;
      id: string;
      payment_transaction_id: string | null;
      provider_refund_id: string | null;
      provider_refund_status: string | null;
      refund_method: string | null;
      status: string;
      transaction_type: string;
    }>;
    const plan = getCancelRefundPlan({
      // A blank order currency defaults to NGN inside the plan, like the
      // worker's preflight gate.
      // Recorded paid amount: outstanding captures above it are unreconciled.
      amountPaid:
        orderRow.amount_paid === null || orderRow.amount_paid === undefined
          ? null
          : Number(orderRow.amount_paid),
      orderCurrency: orderRow.currency,
      // The order's real status and total (the plan reads them only when the
      // ledger is unknown, which this path never reaches).
      paymentStatus:
        String(orderRow.payment_status ?? '').toLowerCase() === 'paid'
          ? 'Paid'
          : String(orderRow.payment_status ?? ''),
      total: Number(orderRow.total) || 0,
      transactions: rows.map((row) => ({
        amount: Number(row.amount),
        currency: row.currency,
        gateway: row.gateway,
        gateway_reference: row.gateway_reference,
        id: row.id,
        payment_transaction_id: row.payment_transaction_id,
        provider_refund_id: row.provider_refund_id,
        provider_refund_status: row.provider_refund_status,
        refund_method: row.refund_method,
        status: row.status,
        transaction_type: row.transaction_type,
      })),
    });
    if (!plan.ledgerKnown) return { outcome: 'unknown' };
    // Label amounts with the ORDER's currency (trimmed + uppercased like the
    // worker; blank defaults to NGN as in the plan), never a capture's.
    const currency = orderRow.currency?.trim().toUpperCase() || 'NGN';
    return {
      details: {
        currency,
        inFlightAmount: plan.inFlightAmount,
        remainingAmount: plan.amount,
      },
      outcome: plan.amount > 0 ? 'manual_required' : 'queued_if_required',
    };
  } catch (error) {
    logger.warn({
      message: 'Ledger read failed for a cancel-only order',
      orderId,
      merchantId,
      error,
    });
    return { outcome: 'unknown' };
  }
}
