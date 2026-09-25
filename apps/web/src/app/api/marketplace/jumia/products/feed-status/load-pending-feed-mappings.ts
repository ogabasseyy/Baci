import type { SupabaseClient } from '@supabase/supabase-js';
import type { PendingFeedMapping } from '@/lib/jumia/jumia-feed-reconciliation-batch';

const PENDING_MAPPING_PAGE_SIZE = 500;

export async function loadPendingFeedMappings(
  supabase: SupabaseClient,
  merchantId: string,
  shopId: string,
  marketplaceKey: string
): Promise<{
  mappings: PendingFeedMapping[];
  error: unknown | null;
}> {
  const mappings: PendingFeedMapping[] = [];

  for (let start = 0; ; start += PENDING_MAPPING_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('jumia_product_mappings')
      .select('id, last_feed_id, jumia_seller_sku, last_synced_at, sync_error')
      .eq('merchant_id', merchantId)
      .eq('jumia_shop_id', shopId)
      .eq('marketplace_key', marketplaceKey)
      .eq('sync_status', 'pending')
      .order('id', { ascending: true })
      .range(start, start + PENDING_MAPPING_PAGE_SIZE - 1);

    if (error) return { mappings: [], error };
    const page = (data ?? []) as PendingFeedMapping[];
    mappings.push(...page);
    if (page.length < PENDING_MAPPING_PAGE_SIZE) {
      return { mappings, error: null };
    }
  }
}
