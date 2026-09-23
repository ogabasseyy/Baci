import type { SupabaseClient } from '@supabase/supabase-js';
import { JumiaClient } from '@/lib/jumia/client';
import { updateStock } from '@/lib/jumia/feeds';
import {
  getPushReadyJumiaStockMappings,
  loadJumiaStockMappings,
} from '@/lib/jumia/load-jumia-stock-mappings';
import { getEffectiveStock } from '@/lib/product-stock';

export interface JumiaStockSyncResult {
  updated: number;
  skipped: number;
  trackingFailures: number;
  feedId: string | null;
}

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
}): Promise<JumiaStockSyncResult> {
  const { supabase, merchantId, integrationId } = args;
  const empty: JumiaStockSyncResult = {
    updated: 0,
    skipped: 0,
    trackingFailures: 0,
    feedId: null,
  };
  const jumiaClient = await JumiaClient.forIntegration(
    supabase,
    merchantId,
    integrationId
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
  if (variantIds.length > 0) {
    const { data: variants, error: variantsError } = await supabase
      .from('product_variants')
      .select('id, stock_quantity')
      .in('id', variantIds);
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
  if (productOnlyIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, stock, stock_quantity')
      .in('id', productOnlyIds);
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

  const now = new Date().toISOString();
  const { error: bulkError } = await supabase
    .from('jumia_product_mappings')
    .upsert(
      stockUpdates.map((update) => ({
        id: update.mappingId,
        baci_stock_at_last_sync: update.stock,
        last_stock_synced_at: now,
        last_feed_id: feedId,
      })),
      { onConflict: 'id', ignoreDuplicates: false }
    );
  return {
    updated: stockUpdates.length,
    skipped,
    trackingFailures: bulkError ? stockUpdates.length : 0,
    feedId,
  };
}
