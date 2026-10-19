import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePaymentGateway } from './normalize-payment-gateway';

const PROVIDER_REFUND_LOOKUP_PAGE_SIZE = 10;
const MAX_PROVIDER_REFUND_MATCHES = 2;

/**
 * Find genuine Paystack refund rows for a provider refund id.
 * Corrupt gateway values containing `paystack` (e.g. `notpaystack`)
 * match the case-insensitive prefilter, so a bare limit(2) read can
 * return only corrupt rows — hiding the genuine row, or hiding a
 * real duplicate behind one genuine plus one corrupt row. The
 * keyset scan walks past corrupt rows and returns at most two
 * genuine matches: enough for callers to distinguish
 * none/one/ambiguous. The caller owns the projection; rows must
 * carry at least the gateway and id.
 */
export async function findPaystackRefundRowsByProviderId<
  T extends { gateway?: unknown; id: string },
>(supabase: SupabaseClient, refundId: number, columns: string): Promise<T[]> {
  const matches: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const query = supabase
      .from('transactions')
      .select(columns)
      .eq('transaction_type', 'refund')
      .ilike('gateway', '%paystack%')
      .eq('gateway_reference', String(refundId))
      .order('id', { ascending: true })
      .limit(PROVIDER_REFUND_LOOKUP_PAGE_SIZE);
    const { data, error } =
      cursor === null ? await query : await query.gt('id', cursor);
    if (error) throw new Error('refund_event_lookup_failed');
    const page = (data ?? []) as unknown as T[];
    for (const row of page) {
      if (normalizePaymentGateway(row.gateway) !== 'PAYSTACK') continue;
      matches.push(row);
      if (matches.length >= MAX_PROVIDER_REFUND_MATCHES) return matches;
    }
    if (page.length < PROVIDER_REFUND_LOOKUP_PAGE_SIZE) return matches;
    cursor = page[page.length - 1]?.id ?? null;
    if (cursor === null) return matches;
  }
}
