import type { SupabaseClient } from '@supabase/supabase-js';

export const INTEGRATION_SCOPED_MAPPING_SELECT =
  'id, product_id, variant_id, jumia_sku, jumia_seller_sku, jumia_product_id, jumia_price, jumia_sale_price, jumia_sale_start, jumia_sale_end, is_active, sync_inventory, sync_price, sync_status, last_synced_at, sync_error, created_at, updated_at';

export type IntegrationScopedMapping = {
  id: string;
  product_id: string;
  variant_id: string | null;
  jumia_sku: string;
  jumia_seller_sku: string | null;
  jumia_product_id: string | null;
  jumia_price: number | null;
  jumia_sale_price: number | null;
  jumia_sale_start: string | null;
  jumia_sale_end: string | null;
  is_active: boolean;
  sync_inventory: boolean;
  sync_price: boolean;
  sync_status: string;
  last_synced_at: string | null;
  sync_error: string | null;
  created_at: string;
  updated_at: string;
};

type LoadIntegrationScopedMappingsArgs = {
  supabase: SupabaseClient;
  merchantId: string;
  productId: string;
  shopId: string;
  marketplaceKey: string;
};

export async function loadIntegrationScopedMappings({
  supabase,
  merchantId,
  productId,
  shopId,
  marketplaceKey,
}: LoadIntegrationScopedMappingsArgs): Promise<{
  mappings: IntegrationScopedMapping[];
  error: Error | null;
}> {
  const { data, error } = await supabase
    .from('jumia_product_mappings')
    .select(INTEGRATION_SCOPED_MAPPING_SELECT)
    .eq('product_id', productId)
    .eq('merchant_id', merchantId)
    .eq('jumia_shop_id', shopId)
    .eq('marketplace_key', marketplaceKey)
    .order('created_at', { ascending: true });

  if (error) {
    return { mappings: [], error: new Error(error.message) };
  }

  return {
    mappings: (data ?? []) as IntegrationScopedMapping[],
    error: null,
  };
}

export function pickPrimaryProductMapping(
  mappings: IntegrationScopedMapping[]
): IntegrationScopedMapping | null {
  if (mappings.length === 0) {
    return null;
  }

  return (
    mappings.find((mapping) => mapping.variant_id == null) ??
    mappings[0] ??
    null
  );
}
