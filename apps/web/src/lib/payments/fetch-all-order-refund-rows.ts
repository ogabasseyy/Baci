import type { SupabaseClient } from '@supabase/supabase-js';

const REFUND_SCAN_PAGE_SIZE = 50;

/**
 * Fetch every refund row for the order, newest or oldest first — the
 * caller matches in code, so only completeness matters. Keyset
 * pagination by id (never an offset or a newest-N cap): omitting an
 * older uncovered failed row would falsely report all legs covered
 * and mark the shared notification sent without delivery.
 */
export async function fetchAllOrderRefundRows(
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
