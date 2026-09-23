import type { SupabaseClient } from '@supabase/supabase-js';
import { getJumiaShopNonDefaultMarketplaceKeys } from '@/lib/jumia/shop-marketplace-scope';

export { getJumiaShopNonDefaultMarketplaceKeys };

type JumiaOrderScopeResult =
  | Readonly<{
      kind: 'ok';
      cachedMarketplaceKeys: string[];
      marketplaceKey: string;
      shopId: string;
    }>
  | Readonly<{
      kind: 'database_error';
      message: string;
    }>
  | Readonly<{
      kind: 'not_found';
    }>
  | Readonly<{
      kind: 'invalid_shop';
    }>;

/** Resolves the provider and marketplace identity used to scope cached orders. */
export async function getJumiaOrderScope(
  supabase: SupabaseClient,
  merchantId: string,
  integrationId: string
): Promise<JumiaOrderScopeResult> {
  const { data: integration, error } = await supabase
    .from('marketplace_integrations')
    .select('shop_id, marketplace_key, country_code')
    .eq('id', integrationId)
    .eq('merchant_id', merchantId)
    .eq('platform', 'jumia')
    .eq('is_active', true)
    .maybeSingle();

  if (error) return { kind: 'database_error', message: error.message };
  if (!integration) return { kind: 'not_found' };
  if (!integration.shop_id || typeof integration.shop_id !== 'string') {
    return { kind: 'invalid_shop' };
  }

  const marketplaceKey =
    typeof integration.marketplace_key === 'string' &&
    integration.marketplace_key.trim().length > 0
      ? integration.marketplace_key.trim()
      : 'default';

  if (marketplaceKey === 'default') {
    return {
      kind: 'ok',
      cachedMarketplaceKeys: ['default'],
      marketplaceKey,
      shopId: integration.shop_id,
    };
  }

  // Reads must use the same country-aware scope the manual sync wrote
  // with, except for OAuth integrations whose provider queries are
  // shop-wide.
  const nonDefaultMarketplaceKeys = await getJumiaShopNonDefaultMarketplaceKeys(
    supabase,
    merchantId,
    integration.shop_id,
    {
      countryCode:
        marketplaceKey === 'oauth'
          ? undefined
          : typeof integration.country_code === 'string'
            ? integration.country_code
            : undefined,
    }
  );
  if (!(nonDefaultMarketplaceKeys instanceof Set)) {
    return nonDefaultMarketplaceKeys;
  }

  return {
    kind: 'ok',
    cachedMarketplaceKeys:
      nonDefaultMarketplaceKeys.size > 1
        ? [marketplaceKey]
        : [marketplaceKey, 'default'],
    marketplaceKey,
    shopId: integration.shop_id,
  };
}
