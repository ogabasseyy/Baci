import type { SupabaseClient } from '@supabase/supabase-js';
import { JumiaClient } from '@/lib/jumia/client';
import type { JumiaOrderSyncResult } from '@/lib/jumia/order-sync-result';
import { getAllOrders, getOrderItems } from '@/lib/jumia/orders';
import { logger } from '@/lib/logger';
import {
  JUMIA_EXTERNAL_SOURCE,
  type MarketplaceIntegrationRow,
  readStockSyncEnabled,
} from './order-sync-mappers';
import {
  buildExistingJumiaCacheEntry,
  buildSyncedJumiaCacheRow,
  loadExistingCanonicalOrders,
  loadExistingJumiaOrders,
  notifySyncedJumiaOrder,
  upsertCanonicalOrder,
} from './order-sync-operations';
import { selectJumiaOrderSyncIntegrations } from './select-jumia-order-sync-integrations';
import { getJumiaShopNonDefaultMarketplaceKeys } from './shop-marketplace-scope';
import {
  JumiaSyncCursorUpdateError,
  type SyncJumiaOrderIntegrationDependencies,
  syncJumiaOrderIntegration,
} from './sync-jumia-order-integration';
import { syncJumiaStockForIntegration } from './sync-jumia-stock-integration';

const JUMIA_ORDER_SYNC_ROUTE = 'jumia/order-sync';

const syncJumiaOrderIntegrationDependencies = {
  createClient: (
    supabase: SupabaseClient,
    merchantId: string,
    integrationId: string
  ) => JumiaClient.forIntegration(supabase, merchantId, integrationId),
  getAllOrders,
  getOrderItems,
  buildExistingJumiaCacheEntry,
  buildSyncedJumiaCacheRow,
  loadExistingCanonicalOrders,
  loadExistingJumiaOrders,
  notifySyncedJumiaOrder,
  upsertCanonicalOrder,
} satisfies SyncJumiaOrderIntegrationDependencies;

export async function syncJumiaOrdersForActiveIntegrations(
  supabase: SupabaseClient
): Promise<JumiaOrderSyncResult> {
  const result: JumiaOrderSyncResult = {
    integrations: 0,
    synced: 0,
    canonicalCreated: 0,
    canonicalUpdated: 0,
    notified: 0,
    stockUpdated: 0,
    orderErrors: 0,
    errors: [],
  };

  const { data, error } = await supabase
    .from('marketplace_integrations')
    .select(
      'id, merchant_id, shop_id, country_code, marketplace_key, connection_method, jumia_authorization_id, last_sync_at, sync_config'
    )
    .eq('platform', JUMIA_EXTERNAL_SOURCE)
    .eq('is_active', true);

  if (error)
    throw new Error(`Failed to load Jumia integrations: ${error.message}`);

  const integrations = (data || []) as MarketplaceIntegrationRow[];
  result.integrations = integrations.length;

  for (const integration of selectJumiaOrderSyncIntegrations(integrations)) {
    try {
      await syncJumiaOrderIntegration(
        supabase,
        integration,
        result,
        syncJumiaOrderIntegrationDependencies
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`${integration.merchant_id}: ${message}`);
      logger.error({
        message: 'Jumia order sync failed',
        error,
        integrationId: integration.id,
        merchant_id: integration.merchant_id,
        route: JUMIA_ORDER_SYNC_ROUTE,
        sync_error: message,
      });
      const syncErrorPatch =
        error instanceof JumiaSyncCursorUpdateError
          ? { ...error.syncUpdate, sync_error: message }
          : { sync_error: message };
      const { error: syncErrorUpdateError } = await supabase
        .from('marketplace_integrations')
        .update(syncErrorPatch)
        .eq('id', integration.id);
      if (syncErrorUpdateError) {
        const syncErrorMessage = `Failed to persist Jumia sync error for ${integration.merchant_id}: ${syncErrorUpdateError.message}`;
        result.errors.push(syncErrorMessage);
        logger.error({
          message: 'Failed to persist Jumia sync error',
          error: syncErrorUpdateError,
          integrationId: integration.id,
          merchant_id: integration.merchant_id,
          route: JUMIA_ORDER_SYNC_ROUTE,
          sync_error_update_error: syncErrorUpdateError.message,
        });
      }
    }
  }

  // OAuth integrations keep automatic stock sync in the legacy edge
  // worker. Self-authorized integrations are excluded there, so the VPS
  // loop pushes their stock here. Multi-marketplace shops fail closed:
  // the stock feed has no business-client selector.
  for (const integration of integrations) {
    if (integration.connection_method !== 'self_authorization') continue;
    if (!readStockSyncEnabled(integration.sync_config)) continue;
    if (!integration.shop_id) continue;
    try {
      const shopKeys = await getJumiaShopNonDefaultMarketplaceKeys(
        supabase,
        integration.merchant_id,
        integration.shop_id
      );
      if (!(shopKeys instanceof Set) || shopKeys.size > 1) {
        logger.info({
          message: 'Skipping Jumia stock sync for ambiguous shop scope',
          integrationId: integration.id,
          merchant_id: integration.merchant_id,
          route: JUMIA_ORDER_SYNC_ROUTE,
        });
        continue;
      }
      const stock = await syncJumiaStockForIntegration({
        supabase,
        merchantId: integration.merchant_id,
        integrationId: integration.id,
      });
      result.stockUpdated += stock.updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`${integration.merchant_id}/stock: ${message}`);
      logger.error({
        message: 'Jumia stock sync failed',
        error,
        integrationId: integration.id,
        merchant_id: integration.merchant_id,
        route: JUMIA_ORDER_SYNC_ROUTE,
        sync_error: message,
      });
    }
  }

  return result;
}
