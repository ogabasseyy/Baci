import { type CancelRefundPlan, getCancelRefundPlan } from '@baci/shared';
import { supabase } from '@/lib/supabase';

/**
 * The refund plan a cancellation would face: outstanding external payment
 * legs and whether the worker can refund them automatically. Best effort —
 * undefined (unknown) keeps the cancel prompt on its safe default, since the
 * server remains the real gate.
 */
export async function fetchCancelRefundPlan({
  merchantId,
  orderId,
  paymentStatus,
  total,
}: {
  merchantId: string;
  orderId: string;
  paymentStatus: string;
  total: number;
}): Promise<CancelRefundPlan | undefined> {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select(
        'id, amount, currency, gateway, gateway_reference, status, transaction_type, payment_transaction_id:metadata->>payment_transaction_id, provider_refund_status:metadata->>provider_refund_status, provider_refund_id:metadata->>provider_refund_id'
      )
      .eq('order_id', orderId)
      .eq('merchant_id', merchantId)
      .in('transaction_type', ['payment', 'refund']);
    if (error || !data) return undefined;
    return getCancelRefundPlan({
      // Stored statuses vary in case; the plan expects the display form.
      paymentStatus:
        String(paymentStatus ?? '').toLowerCase() === 'paid'
          ? 'Paid'
          : paymentStatus,
      total,
      transactions: data.map((row) => ({
        amount: Number(row.amount),
        currency: row.currency,
        gateway: row.gateway,
        gateway_reference: row.gateway_reference,
        id: row.id,
        payment_transaction_id: (
          row as { payment_transaction_id?: string | null }
        ).payment_transaction_id,
        provider_refund_id: (row as { provider_refund_id?: string | null })
          .provider_refund_id,
        provider_refund_status: (
          row as { provider_refund_status?: string | null }
        ).provider_refund_status,
        status: row.status,
        transaction_type: row.transaction_type,
      })),
    });
  } catch {
    // Best effort: an unreadable ledger leaves the plan unknown.
    return undefined;
  }
}
