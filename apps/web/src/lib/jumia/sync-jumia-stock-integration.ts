import type { SupabaseClient } from '@supabase/supabase-js';
import { JumiaClient } from '@/lib/jumia/client';
import { updateStock } from '@/lib/jumia/feeds';
import {
  getPushReadyJumiaStockMappings,
  loadJumiaStockMappings,
} from '@/lib/jumia/load-jumia-stock-mappings';
import { reconcileJumiaStockFeeds } from '@/lib/jumia/reconcile-jumia-stock-feeds';
import { updateJumiaStockTracking } from '@/lib/jumia/update-jumia-stock-tracking';
import { getEffectiveStock } from '@/lib/product-stock';
import type { JumiaCredentialServiceClient } from '@/lib/supabase/service';

export interface JumiaStockSyncResult {
  updated: number;
  skipped: number;
  trackingFailures: number;
  feedId: string | null;
}

// PostgREST filters travel on the URL; keep id lists small enough for
// proxy and server limits regardless of catalog size.
const STOCK_LOOKUP_CHUNK_SIZE = 100;

/**
 * Pushes changed local stock levels for one integration's synced mappings.
 * Shares the manual stock endpoint's mapping, computation, and tracking
 * rules; multi-marketplace shops fail closed inside `updateStock`, which
 * has no provider business-client selector.
 */
export async function syncJumiaStockForIntegration(args: {
  supabase: SupabaseClient;
  merchantId: string;
  integrationId: string;
  credentialClient?: JumiaCredentialServiceClient;
}): Promise<JumiaStockSyncResult> {
  const { supabase, merchantId, integrationId, credentialClient } = args;
  const empty: JumiaStockSyncResult = {
    updated: 0,
    skipped: 0,
    trackingFailures: 0,
    feedId: null,
  };
  const jumiaClient = await JumiaClient.forIntegration(
    supabase,
    merchantId,
    integrationId,
    credentialClient ? { credentialClient } : undefined
  );
  const { mappings, error: mappingsError } = await loadJumiaStockMappings(
    supabase,
    {
      merchantId,
      shopId: jumiaClient.shopId,
      marketplaceKey: jumiaClient.marketplaceKey,
    }
  );
  if (mappingsError) {
    throw new Error(
      `Failed to fetch product mappings: ${
        mappingsError instanceof Error ? mappingsError.message : 'unknown error'
      }`
    );
  }
  if (!mappings || mappings.length === 0) return empty;

  // Settle previously accepted stock feeds first: a later rejection resets
  // the cursor so the mapping is retried instead of skipped forever.
  const reconciliation = await reconcileJumiaStockFeeds(supabase, jumiaClient, {
    mappings,
  });
  if (reconciliation.failures > 0) {
    console.error(
      '[Jumia Stock Sync] Stock feed reconciliation failed for',
      reconciliation.failures,
      'mapping(s)'
    );
  }

  const { pushReady, skipped: initialSkipped } =
    getPushReadyJumiaStockMappings(mappings);
  let skipped = initialSkipped;
  if (pushReady.length === 0) return { ...empty, skipped };

  const variantIds = Array.from(
    new Set(
      pushReady.flatMap((mapping) =>
        mapping.variant_id ? [mapping.variant_id] : []
      )
    )
  );
  const productOnlyIds = Array.from(
    new Set(pushReady.filter((m) => !m.variant_id).map((m) => m.product_id))
  );

  const variantStockMap = new Map<string, number>();
  const productStockMap = new Map<string, number>();
  for (
    let start = 0;
    start < variantIds.length;
    start += STOCK_LOOKUP_CHUNK_SIZE
  ) {
    // The worker runs as service-role, so scope explicitly: a mapping must
    // never publish another merchant's stock to its own Jumia SKU.
    const { data: variants, error: variantsError } = await supabase
      .from('product_variants')
      .select('id, stock_quantity')
      .eq('merchant_id', merchantId)
      .in('id', variantIds.slice(start, start + STOCK_LOOKUP_CHUNK_SIZE));
    if (variantsError) {
      throw new Error(
        `Failed to fetch variant stock: ${variantsError.message}`
      );
    }
    for (const v of variants || []) {
      variantStockMap.set(
        v.id,
        Math.max(0, Math.trunc(Number(v.stock_quantity) || 0))
      );
    }
  }
  for (
    let start = 0;
    start < productOnlyIds.length;
    start += STOCK_LOOKUP_CHUNK_SIZE
  ) {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, stock, stock_quantity')
      .eq('merchant_id', merchantId)
      .in('id', productOnlyIds.slice(start, start + STOCK_LOOKUP_CHUNK_SIZE));
    if (productsError) {
      throw new Error(
        `Failed to fetch product stock: ${productsError.message}`
      );
    }
    for (const p of products || []) {
      productStockMap.set(p.id, getEffectiveStock(p));
    }
  }

  const stockUpdates: Array<{
    mappingId: string;
    sellerSku: string;
    id: string;
    stock: number;
  }> = [];
  for (const mapping of pushReady) {
    const stock = mapping.variant_id
      ? variantStockMap.get(mapping.variant_id)
      : productStockMap.get(mapping.product_id);
    if (stock === undefined) {
      skipped++;
      continue;
    }
    if (stock === mapping.baci_stock_at_last_sync) continue;
    if (!mapping.jumia_seller_sku || !mapping.jumia_product_id) {
      skipped++;
      continue;
    }
    stockUpdates.push({
      mappingId: mapping.id,
      sellerSku: mapping.jumia_seller_sku,
      id: mapping.jumia_product_id,
      stock,
    });
  }
  if (stockUpdates.length === 0) return { ...empty, skipped };

  const feedId = await updateStock(
    jumiaClient,
    stockUpdates.map(({ sellerSku, id, stock }) => ({
      sellerSku,
      id,
      stock,
    }))
  );

  const { trackingFailures } = await updateJumiaStockTracking(supabase, {
    updates: stockUpdates.map((update) => ({
      mappingId: update.mappingId,
      stock: update.stock,
    })),
    feedId,
  });
  return {
    updated: stockUpdates.length,
    skipped,
    trackingFailures,
    feedId,
  };
}
