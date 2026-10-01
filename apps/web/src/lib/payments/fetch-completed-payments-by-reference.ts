import type { SupabaseClient } from '@supabase/supabase-js';

const RECOVERY_MATCH_PAGE_SIZE = 10;
// Full passes over the completed set before acknowledging: a webhook
// must terminate under pathological churn, and three passes close
// the behind-cursor window twice while the empty path still hands
// later completions to the recovery watch.
const RECOVERY_MATCH_MAX_PASSES = 3;

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
  const candidates = new Map<string, CompletedPaymentMatch>();
  // Keyset over the immutable id order: offsets over this
  // status-filtered set would shift when a lower-id payment completes
  // between page reads. The cursor alone still skips a payment that
  // completes behind it mid-scan, so the full scan repeats until a
  // pass adds nothing: the acknowledgement branches on a stable set
  // instead of a cursor over a mutable status filter.
  for (let pass = 0; pass < RECOVERY_MATCH_MAX_PASSES; pass++) {
    let added = 0;
    let lastId: string | null = null;
    for (;;) {
      const filtered = supabase
        .from('transactions')
        .select('id, order_id, merchant_id, gateway_reference, amount')
        .eq('gateway', 'paystack')
        .eq('gateway_reference', gatewayReference)
        .eq('transaction_type', 'payment')
        .eq('status', 'completed')
        .order('id', { ascending: true });
      const { data: payments, error: paymentError } = await (lastId === null
        ? filtered
        : filtered.gt('id', lastId)
      ).limit(RECOVERY_MATCH_PAGE_SIZE);
      if (paymentError) throw new Error('refund_event_payment_lookup_failed');
      const page = (payments ?? []) as CompletedPaymentMatch[];
      for (const row of page) {
        if (candidates.has(row.id)) continue;
        candidates.set(row.id, row);
        added++;
      }
      if (page.length < RECOVERY_MATCH_PAGE_SIZE) break;
      lastId = page[page.length - 1]?.id ?? null;
      if (lastId === null) break;
    }
    if (added === 0) break;
  }
  // Late completions merge out of cursor order: restore the stable id
  // order the ambiguity branch files in.
  return [...candidates.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
}
