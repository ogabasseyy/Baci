import type { SupabaseClient } from '@supabase/supabase-js';
import { extractRankedProductIds, toRankedSearchProductRows } from './search-products-query-helpers';

/** Indexed verified facts are a separate candidate source, under product RLS. */
export async function loadDiscoveryFactCandidates(query: string, merchantId: string, supabase: SupabaseClient) {
  const ids: string[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const { data, error } = await supabase.rpc('search_product_discovery_facts', {
      merchant_id_param: merchantId, query_text: query, result_limit: 100, result_offset: offset,
    });
    if (error) return { ids, truncated: true };
    const rows = toRankedSearchProductRows(data);
    const page = extractRankedProductIds(rows);
    ids.push(...page);
    if (page.length < 100) return { ids: [...new Set(ids)], truncated: false };
    if (offset === 400) return { ids: [...new Set(ids)], truncated: Number(rows[0]?.total_count ?? 501) > 500 };
  }
  return { ids: [...new Set(ids)], truncated: true };
}
