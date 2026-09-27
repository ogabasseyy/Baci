import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExportVariation } from './export-product-source';

export const AMBIGUOUS_JUMIA_EXPORT_ERROR =
  'ambiguous_submission_requires_manual_resolution';

export async function markAmbiguousJumiaExport(
  supabase: SupabaseClient,
  args: {
    merchantId: string;
    productId: string;
    shopId: string;
    marketplaceKey: string;
    exportVariations: ExportVariation[];
  }
): Promise<boolean> {
  const { error } = await supabase
    .from('jumia_product_mappings')
    .update({
      sync_status: 'pending',
      sync_error: AMBIGUOUS_JUMIA_EXPORT_ERROR,
      last_synced_at: new Date().toISOString(),
    })
    .eq('merchant_id', args.merchantId)
    .eq('product_id', args.productId)
    .eq('jumia_shop_id', args.shopId)
    .eq('marketplace_key', args.marketplaceKey)
    .eq('sync_status', 'pending')
    .is('last_feed_id', null)
    .in(
      'jumia_sku',
      args.exportVariations.map((variation) => variation.sellerSku)
    );
  return !error;
}
