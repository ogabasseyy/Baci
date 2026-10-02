import type { SupabaseClient } from '@supabase/supabase-js';
import { extractRankedProductIds, toRankedSearchProductRows } from './search-products-query-helpers';

/** Indexed verified facts are a separate candidate source, under product RLS. */
export async function loadDiscoveryFactCandidates(query: string, merchantId: string, supabase: SupabaseClient,
  filters: { brand?: string; category?: string; condition?: string } = {}) {
  const ids: string[] = [];
  try {
    for (let offset = 0; offset < 500; offset += 100) {
      const { data, error } = await supabase.rpc('search_product_discovery_facts', {
        merchant_id_param: merchantId, query_text: query, result_limit: 100, result_offset: offset,
        brand_filter: filters.brand ?? null, category_filter: filters.category ?? null,
        condition_filter: filters.condition ?? null,
      });
      if (error) return { ids, truncated: true };
      const rows = toRankedSearchProductRows(data);
      const page = extractRankedProductIds(rows);
      ids.push(...page);
      if (page.length < 100) return { ids: [...new Set(ids)], truncated: false };
      if (offset === 400) return { ids: [...new Set(ids)], truncated: Number(rows[0]?.total_count ?? 501) > 500 };
    }
  } catch {
    return { ids: [...new Set(ids)], truncated: true };
  }
  return { ids: [...new Set(ids)], truncated: true };
}
