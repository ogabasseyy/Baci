import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Lists the distinct non-default marketplace keys across a shop's active
 * Jumia integrations. More than one key means the provider order set is
 * shared and per-order marketplace attribution is ambiguous.
 */
export async function getJumiaShopNonDefaultMarketplaceKeys(
  supabase: SupabaseClient,
  merchantId: string,
  shopId: string
): Promise<Set<string> | { kind: 'database_error'; message: string }> {
  const { data: activeIntegrations, error: activeIntegrationsError } =
    await supabase
      .from('marketplace_integrations')
      .select('marketplace_key')
      .eq('merchant_id', merchantId)
      .eq('platform', 'jumia')
      .eq('is_active', true)
      .eq('shop_id', shopId);
  if (activeIntegrationsError) {
    return {
      kind: 'database_error',
      message: activeIntegrationsError.message,
    };
  }
  return new Set(
    (activeIntegrations as Array<{ marketplace_key: string | null }> | null)
      ?.map((row) => row.marketplace_key?.trim() || 'default')
      .filter((key) => key !== 'default') ?? []
  );
}
