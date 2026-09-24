import type { SupabaseClient } from '@supabase/supabase-js';
import { JumiaClient } from '@/lib/jumia/client';
import {
  getActiveSelfAuthorizedJumiaShopIds,
  getJumiaOAuthShopIdsConflictingWithSelfAuthorization,
} from '@/lib/jumia/jumia-oauth-self-authorization-conflict';
import { persistJumiaOAuthIntegrations } from '@/lib/jumia/persist-jumia-oauth-integrations';
import { logger } from '@/lib/logger';
import type { JumiaTokenResponse } from '@/schemas/jumia';

type JumiaOAuthPersistenceResult =
  | { status: 'database_error' }
  | { status: 'shop_discovery_failed' }
  | { status: 'shop_already_self_authorized'; shopIds: string[] }
  | { status: 'success'; shopIds: string[]; isFallback: boolean };

export async function persistJumiaOAuthConnection(args: {
  merchantId: string;
  supabase: SupabaseClient;
  tokens: JumiaTokenResponse;
}): Promise<JumiaOAuthPersistenceResult> {
  const { merchantId, supabase, tokens } = args;
  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const tempClient = new JumiaClient({
    integrationId: 'temp',
    merchantId,
    shopId: 'oauth',
    marketplaceKey: 'oauth',
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || '',
    tokenExpiresAt,
    supabase,
  });

  let discoveredShops: Awaited<ReturnType<typeof tempClient.getShops>>;
  try {
    discoveredShops = await tempClient.getShops();
  } catch (shopError) {
    logger.error({
      message: 'Jumia Callback Failed to fetch shops',
      merchantId,
      error:
        shopError instanceof Error
          ? {
              message: shopError.message,
              code: (shopError as Error & { code?: string }).code,
            }
          : 'Unknown error',
    });
    return { status: 'shop_discovery_failed' };
  }

  const { data: existingIntegrations, error: existingIntegrationsError } =
    await supabase
      .from('marketplace_integrations')
      .select('shop_id,is_active,connection_method')
      .eq('merchant_id', merchantId)
      .eq('platform', 'jumia');

  if (existingIntegrationsError) {
    logger.error({
      message: 'Jumia Callback Failed to load existing integrations',
      merchantId,
      error: existingIntegrationsError,
    });
    return { status: 'database_error' };
  }

  const existingActiveShopIds = new Set(
    (existingIntegrations ?? [])
      .filter((integration) => integration.is_active)
      .map((integration) => integration.shop_id)
  );
  const activeSelfAuthorizedShopIds = getActiveSelfAuthorizedJumiaShopIds(
    existingIntegrations ?? []
  );

  let isFallbackShop = false;
  if (discoveredShops.length === 0) {
    logger.warn({
      message: 'Jumia Callback No shops discovered',
      merchantId,
    });
    isFallbackShop = true;
    discoveredShops.push({
      id: 'oauth',
      name: 'Jumia Shop',
      email: '',
      businessClients: [
        {
          name: 'Jumia Nigeria',
          code: 'jumia_ng',
          countryCode: 'NG',
          countryName: 'Nigeria',
          status: 'active',
          shortCode: 'NG',
        },
      ],
    });
  }

  if (!isFallbackShop) {
    const conflictingShopIds =
      getJumiaOAuthShopIdsConflictingWithSelfAuthorization(
        discoveredShops.map((shop) => shop.id),
        activeSelfAuthorizedShopIds
      );
    if (conflictingShopIds.length > 0) {
      logger.warn({
        message:
          'Jumia Callback rejected OAuth because shop already uses self-authorization',
        merchantId,
        shopIds: conflictingShopIds,
      });
      return {
        status: 'shop_already_self_authorized',
        shopIds: conflictingShopIds,
      };
    }
  }

  const integrationRows = discoveredShops.map((shop) => ({
    merchant_id: merchantId,
    platform: 'jumia' as const,
    shop_id: shop.id,
    marketplace_key: 'oauth',
    shop_name: shop.name || 'Jumia Shop',
    country_code: shop.businessClients?.some((bc) => bc.countryCode === 'NG')
      ? 'NG'
      : (shop.businessClients?.[0]?.countryCode ?? 'NG'),
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    token_expires_at: tokenExpiresAt.toISOString(),
    connection_method: 'oauth' as const,
    jumia_authorization_id: null,
    is_active: !isFallbackShop,
    sync_config: {
      products: true,
      orders: true,
      stock: true,
      businessClients: shop.businessClients ?? [],
    },
  }));

  const persistence = await persistJumiaOAuthIntegrations(
    supabase,
    integrationRows
  );
  if (!persistence.ok) {
    logger.error({
      message: 'Jumia Callback Database error while persisting shops',
      shopIds: integrationRows.map((row) => row.shop_id),
      error: persistence.error,
    });
    return { status: 'database_error' };
  }

  return {
    status: 'success',
    shopIds: integrationRows
      .filter(
        (integration) =>
          integration.is_active &&
          !existingActiveShopIds.has(integration.shop_id)
      )
      .map((integration) => integration.shop_id),
    // An empty shop discovery persists only an inactive fallback row, so the
    // caller must not report the connection as successful.
    isFallback: isFallbackShop,
  };
}
