import type { SupabaseClient } from '@supabase/supabase-js';

const RECOVERY_MATCH_PAGE_SIZE = 10;

export interface CompletedPaymentMatch {
  amount: number;
  gateway_reference: string | null;
  id: string;
  merchant_id: string;
  order_id: string | null;
}

/**
 * Fetch every completed local payment for a verified reference. A
 * corrupt reference can be shared by more completed payments than the
 * PostgREST response cap, so the whole match set is paginated in
 * stable id order before branching — the ambiguity path must file
 * every order instead of silently dropping truncated matches after
 * acknowledgement.
 */
export async function fetchCompletedPaymentsByReference(
  supabase: SupabaseClient,
  gatewayReference: string
): Promise<CompletedPaymentMatch[]> {
  const candidates: CompletedPaymentMatch[] = [];
  for (let offset = 0; ; offset += RECOVERY_MATCH_PAGE_SIZE) {
    const { data: payments, error: paymentError } = await supabase
      .from('transactions')
      .select('id, order_id, merchant_id, gateway_reference, amount')
      .eq('gateway', 'paystack')
      .eq('gateway_reference', gatewayReference)
      .eq('transaction_type', 'payment')
      .eq('status', 'completed')
      .order('id', { ascending: true })
      .range(offset, offset + RECOVERY_MATCH_PAGE_SIZE - 1);
    if (paymentError) throw new Error('refund_event_payment_lookup_failed');
    const page = (payments ?? []) as CompletedPaymentMatch[];
    candidates.push(...page);
    if (page.length < RECOVERY_MATCH_PAGE_SIZE) break;
  }
  return candidates;
}
