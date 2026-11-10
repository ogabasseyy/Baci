import { getCancelRefundPlan } from '@baci/shared/lib/cancel-refund-plan';
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
  supabase: Pick<SupabaseClient, 'from'>;
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
      // The order currency is not read here; the first payment leg's stands
      // in for it (the worker quarantines mixed-currency orders anyway).
      orderCurrency: rows.find((row) => row.transaction_type === 'payment')
        ?.currency,
      paymentStatus: 'Paid',
      total: 0,
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
    // Same trim + uppercase the worker applies to ISO codes.
    const currency =
      rows
        .find((row) => row.transaction_type === 'payment')
        ?.currency?.trim()
        .toUpperCase() || null;
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
