import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Lists the distinct non-default marketplace keys across a shop's active
 * Jumia integrations. More than one key means the provider order set is
 * shared and per-order marketplace attribution is ambiguous.
 *
 * Pass `countryCode` when the caller scopes its provider request by
 * country (self-authorized order sync): keys from other countries cannot
 * collide with a country-specific result. Rows with a NULL country cannot
 * be attributed and stay in the count so the scope fails closed.
 */
export async function getJumiaShopNonDefaultMarketplaceKeys(
  supabase: SupabaseClient,
  merchantId: string,
  shopId: string,
  options?: { countryCode?: string | null }
): Promise<Set<string> | { kind: 'database_error'; message: string }> {
  const countryCode = options?.countryCode?.trim().toUpperCase() ?? '';
  const query = supabase
    .from('marketplace_integrations')
    .select('marketplace_key')
    .eq('merchant_id', merchantId)
    .eq('platform', 'jumia')
    .eq('is_active', true)
    .eq('shop_id', shopId);
  const { data: activeIntegrations, error: activeIntegrationsError } =
    /^[A-Z]{2}$/.test(countryCode)
      ? await query.or(`country_code.eq.${countryCode},country_code.is.null`)
      : await query;
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
