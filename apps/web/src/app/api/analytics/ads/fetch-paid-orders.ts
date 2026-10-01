import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

const PAGE_SIZE = 500;
const MAX_PAGES = 1000;

export type AnalyticsPaidOrder = Pick<
  Database['public']['Tables']['orders']['Row'],
  'ad_tracking' | 'created_at' | 'id' | 'payment_status' | 'total'
>;

interface FetchPaidOrdersResult {
  data: AnalyticsPaidOrder[];
  error: unknown;
}

interface PaidOrderCursor {
  createdAt: string;
  id: string;
}

function quotePostgrestFilterValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function buildPaidOrderCursorFilter(cursor: PaidOrderCursor): string {
  const createdAt = quotePostgrestFilterValue(cursor.createdAt);
  const id = quotePostgrestFilterValue(cursor.id);

  return `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`;
}

/**
 * Reads paid orders in bounded keyset pages so PostgREST's default row limit
 * cannot silently undercount attribution metrics for a busy merchant. The
 * first descending page fixes the scan's upper boundary; later pages only read
 * tuples strictly before their last row, so membership changes cannot shift an
 * offset and duplicate or skip orders.
 */
export async function fetchPaidOrdersForAnalytics(
  supabase: SupabaseClient<Database>,
  merchantId: string,
  orderStart: string,
  orderEnd: string
): Promise<FetchPaidOrdersResult> {
  const orders: AnalyticsPaidOrder[] = [];
  let cursor: PaidOrderCursor | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = supabase
      .from('orders')
      .select('id, total, ad_tracking, created_at, payment_status')
      .eq('merchant_id', merchantId)
      .eq('payment_status', 'paid')
      .gte('created_at', orderStart)
      .lte('created_at', orderEnd)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });

    if (cursor) {
      query = query.or(buildPaidOrderCursorFilter(cursor));
    }

    const { data, error } = await query.limit(PAGE_SIZE);

    if (error) {
      return { data: [], error };
    }

    const pageOrders = (data ?? []) as AnalyticsPaidOrder[];
    orders.push(...pageOrders);

    if (pageOrders.length < PAGE_SIZE) {
      return { data: orders, error: null };
    }

    const lastOrder = pageOrders.at(-1);
    if (!lastOrder) {
      return { data: orders, error: null };
    }
    if (!lastOrder.created_at) {
      return {
        data: [],
        error: new Error('ANALYTICS_ORDER_CURSOR_INVALID'),
      };
    }
    cursor = { createdAt: lastOrder.created_at, id: lastOrder.id };
  }

  return {
    data: [],
    error: new Error('ANALYTICS_ORDER_PAGINATION_LIMIT'),
  };
}
