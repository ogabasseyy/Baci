import type { SupabaseClient } from '@supabase/supabase-js';

export interface JumiaDashboardOrderScope {
  shopId: string;
  marketplaceKeys: string[];
}

/**
 * Resolves a dashboard `integrationId` link parameter to the Jumia shop
 * and marketplace scope it may display. Returns undefined when no
 * integration was requested and null when the requested integration
 * does not belong to the merchant, so callers fail closed.
 *
 * The neutral 'default' scope is always included alongside the
 * integration key: multi-marketplace shops record unattributable
 * orders there.
 */
export async function resolveJumiaDashboardOrderScope(
  supabase: SupabaseClient,
  merchantId: string,
  integrationId: string | undefined
): Promise<JumiaDashboardOrderScope | null | undefined> {
  if (!integrationId) return undefined;
  const { data: integration, error } = await supabase
    .from('marketplace_integrations')
    .select('shop_id, marketplace_key')
    .eq('id', integrationId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (error || !integration) return null;
  const shopId =
    typeof integration.shop_id === 'string' ? integration.shop_id : '';
  if (shopId.length === 0) return null;
  const marketplaceKey =
    typeof integration.marketplace_key === 'string' &&
    integration.marketplace_key.trim().length > 0
      ? integration.marketplace_key.trim()
      : 'default';
  return {
    shopId,
    marketplaceKeys:
      marketplaceKey === 'default' ? ['default'] : [marketplaceKey, 'default'],
  };
}
