import type { SupabaseClient } from '@supabase/supabase-js';

export interface JumiaStockMapping {
  id: string;
  product_id: string;
  variant_id: string | null;
  jumia_seller_sku: string | null;
  jumia_product_id: string | null;
  baci_stock_at_last_sync: number | null;
}

export async function loadJumiaStockMappings(
  supabase: SupabaseClient,
  args: { merchantId: string; shopId: string; marketplaceKey: string }
): Promise<{ mappings: JumiaStockMapping[] | null; error: unknown }> {
  const { data, error } = await supabase
    .from('jumia_product_mappings')
    .select(
      'id, product_id, variant_id, jumia_seller_sku, jumia_product_id, baci_stock_at_last_sync'
    )
    .eq('merchant_id', args.merchantId)
    .eq('jumia_shop_id', args.shopId)
    .eq('marketplace_key', args.marketplaceKey)
    .eq('sync_status', 'synced')
    // A deactivated or inventory-opted-out mapping can retain
    // sync_status='synced'; never push stock for those listings. Both flags
    // are nullable with a true default, so NULL keeps syncing.
    .or('is_active.is.null,is_active.eq.true')
    .or('sync_inventory.is.null,sync_inventory.eq.true');

  return { mappings: (data as JumiaStockMapping[] | null) ?? null, error };
}

export function getPushReadyJumiaStockMappings(mappings: JumiaStockMapping[]) {
  const pushReady: JumiaStockMapping[] = [];
  let skipped = 0;
  for (const mapping of mappings) {
    if (
      !mapping.jumia_seller_sku?.trim() ||
      !mapping.jumia_product_id?.trim()
    ) {
      skipped += 1;
      continue;
    }
    pushReady.push(mapping);
  }
  return { pushReady, skipped };
}
