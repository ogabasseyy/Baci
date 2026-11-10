import { type CancelRefundPlan, getCancelRefundPlan } from '@baci/shared';
import { supabase } from '@/lib/supabase';

/**
 * The refund plan a cancellation would face: outstanding external payment
 * legs and whether the worker can refund them automatically. Best effort —
 * undefined (unknown) keeps the cancel prompt on its safe default, since the
 * server remains the real gate.
 */
export async function fetchCancelRefundPlan({
  currency,
  merchantId,
  orderId,
  paymentStatus,
  total,
}: {
  currency?: string | null;
  merchantId: string;
  orderId: string;
  paymentStatus: string;
  total: number;
}): Promise<CancelRefundPlan | undefined> {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select(
        'id, amount, currency, gateway, gateway_reference, status, transaction_type, payment_transaction_id:metadata->>payment_transaction_id, provider_refund_status:metadata->>provider_refund_status, provider_refund_id:metadata->>provider_refund_id, refund_method:metadata->>method'
      )
      .eq('order_id', orderId)
      .eq('merchant_id', merchantId)
      .in('transaction_type', ['payment', 'refund']);
    if (error || !data) return undefined;
    // Open provider-refund evidence means money may already have moved: mark
    // the plan unresolved so no manual repayment is offered. An unreadable
    // check leaves the plan unknown for the same reason.
    const { data: hasEvidence, error: evidenceError } = await supabase.rpc(
      'order_has_unresolved_refund_evidence',
      { p_order_id: orderId }
    );
    if (evidenceError) return undefined;
    const plan = getCancelRefundPlan({
      orderCurrency: currency,
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
        refund_method: (row as { refund_method?: string | null }).refund_method,
        status: row.status,
        transaction_type: row.transaction_type,
      })),
    });
    return hasEvidence === false ? plan : { ...plan, ledgerKnown: false };
  } catch {
    // Best effort: an unreadable ledger leaves the plan unknown.
    return undefined;
  }
}
