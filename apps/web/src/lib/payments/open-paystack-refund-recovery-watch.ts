import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompletedPaymentMatch } from './fetch-completed-payments-by-reference';

export interface RefundRecoveryWatchEvidence {
  amount_minor: number;
  currency: string;
  provider_payment_transaction_id: number;
  provider_refund_status: string;
}

/**
 * Open (or refresh) the recovery watch for a verified refund and
 * return every completed local payment for its reference. The insert
 * and the confirming scan share one database transaction under the
 * reference advisory lock the completion path claims under, so the
 * empty handoff is atomic: rows returned mean the payment landed
 * first and the caller handles it; an empty set leaves the watch
 * open for the completion to claim. Throws on lookup failure like
 * the plain scan it replaces.
 */
export async function openPaystackRefundRecoveryWatch(
  supabase: SupabaseClient,
  {
    evidence,
    providerRefundId,
    reference,
  }: {
    evidence: RefundRecoveryWatchEvidence;
    providerRefundId: number;
    reference: string;
  }
): Promise<CompletedPaymentMatch[]> {
  const { data, error } = await supabase.rpc(
    'open_paystack_refund_recovery_watch_v1',
    {
      p_evidence: evidence,
      p_paystack_ref: reference,
      p_provider_refund_id: providerRefundId,
    }
  );
  if (error) throw new Error('refund_event_payment_lookup_failed');
  return (data ?? []) as CompletedPaymentMatch[];
}
