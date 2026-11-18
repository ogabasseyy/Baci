import type { SupabaseClient } from '@supabase/supabase-js';

export interface FallbackEventRow {
  event_data: unknown;
  event_type: string;
}

export async function fetchFallbackAnalyticsEvents(
  supabase: SupabaseClient,
  merchantId: string,
  startDate: string,
  endDate: string,
  maxRows: number
): Promise<
  { rows: FallbackEventRow[]; truncated: boolean } | { error: string }
> {
  const eventRows: FallbackEventRow[] = [];
  const pageSize = 1000;
  let truncated = false;
  let from = 0;

  while (from < maxRows) {
    const remaining = maxRows - from;
    // Keep the final probe <= 501 rows (< PostgREST's 1,000-row cap) so
    // `fetched.length > remaining` reliably detects >10,000 matching rows.
    const chunkLimit =
      remaining <= 500 ? remaining : Math.min(pageSize, remaining - 500);
    const isFinalPage = remaining <= 500;
    const pageEnd = isFinalPage ? from + remaining : from + chunkLimit - 1;
    const { data: page, error: pageError } = await supabase
      .from('analytics_events')
      .select('event_type, event_data')
      .eq('merchant_id', merchantId)
      .gte('event_timestamp', startDate)
      .lte('event_timestamp', endDate)
      .in('event_type', ['search', 'product_view', 'purchase', 'add_to_cart'])
      .order('event_timestamp', { ascending: false })
      .order('id', { ascending: false })
      .range(from, pageEnd);

    if (pageError) {
      return { error: 'Failed to aggregate events' };
    }
    const fetched = page ?? [];
    if (isFinalPage && fetched.length > remaining) {
      truncated = true;
    }
    eventRows.push(...fetched.slice(0, remaining));
    if (isFinalPage || fetched.length < chunkLimit) break;
    from += chunkLimit;
  }

  if (truncated) {
    console.warn('[website-performance] Fallback event scan reached limit', {
      maxRows,
      merchantId,
    });
  }

  return { rows: eventRows, truncated };
}
