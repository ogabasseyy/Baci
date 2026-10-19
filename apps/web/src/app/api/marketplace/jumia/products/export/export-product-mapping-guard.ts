import type { SupabaseClient } from '@supabase/supabase-js';

export async function findExistingJumiaExportMapping(
  supabase: SupabaseClient,
  args: {
    merchantId: string;
    productId: string;
    shopId: string;
    marketplaceKey: string;
  }
): Promise<boolean> {
  const { data, error } = await supabase
    .from('jumia_product_mappings')
    .select('id')
    .eq('merchant_id', args.merchantId)
    .eq('product_id', args.productId)
    .eq('jumia_shop_id', args.shopId)
    .eq('marketplace_key', args.marketplaceKey)
    .neq('sync_status', 'error')
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check existing Jumia mapping: ${error.message}`);
  }

  return Boolean(data);
}
