import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

type LoadJumiaImportMappingsArgs = {
  supabase: SupabaseClient;
  merchantId: string;
  shopId: string;
  marketplaceKey: string;
  skus: string[];
};

export async function loadJumiaImportMappings({
  supabase,
  merchantId,
  shopId,
  marketplaceKey,
  skus,
}: LoadJumiaImportMappingsArgs): Promise<
  { ok: true; mappedSkus: Set<string> } | { ok: false }
> {
  const { data, error } = await supabase
    .from('jumia_product_mappings')
    .select('id, jumia_sku')
    .eq('merchant_id', merchantId)
    .eq('jumia_shop_id', shopId)
    .eq('marketplace_key', marketplaceKey)
    .in('jumia_sku', skus);

  if (error) {
    logger.error({
      message: 'Failed to query existing mappings',
      error,
    });
    return { ok: false };
  }

  return {
    ok: true,
    mappedSkus: new Set(
      (data ?? [])
        .filter((mapping) => mapping.jumia_sku)
        .map((mapping) => mapping.jumia_sku)
    ),
  };
}
