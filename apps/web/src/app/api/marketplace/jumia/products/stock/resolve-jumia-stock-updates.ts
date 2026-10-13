import type { SupabaseClient } from '@supabase/supabase-js';
import type { JumiaStockMapping } from '@/lib/jumia/load-jumia-stock-mappings';
import { getEffectiveStock } from '@/lib/product-stock';

export interface JumiaStockUpdate {
  mappingId: string;
  sellerSku: string;
  id: string;
  stock: number;
}

export interface JumiaStockUpdateResolution {
  stockUpdates: JumiaStockUpdate[];
  skipped: number;
  fetchErrors: number;
}

// PostgREST filters travel on the URL; keep id lists small enough for
// proxy and server limits regardless of catalog size.
const STOCK_LOOKUP_CHUNK_SIZE = 100;

/**
 * Resolves which push-ready mappings have local stock that differs from the
 * last synced cursor. Stock lookups stay merchant-scoped and chunked; lookup
 * failures are counted (not thrown) so one bad page cannot fail the sync.
 */
export async function resolveJumiaStockUpdates(
  supabase: SupabaseClient,
  merchantId: string,
  pushReady: JumiaStockMapping[]
): Promise<JumiaStockUpdateResolution> {
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
  let fetchErrors = 0;

  for (
    let start = 0;
    start < variantIds.length;
    start += STOCK_LOOKUP_CHUNK_SIZE
  ) {
    const { data: variants, error: variantsError } = await supabase
      .from('product_variants')
      .select('id, stock_quantity')
      .eq('merchant_id', merchantId)
      .in('id', variantIds.slice(start, start + STOCK_LOOKUP_CHUNK_SIZE));

    if (variantsError) {
      fetchErrors++;
      console.error(
        '[Jumia Stock Sync] Failed to fetch variant stock:',
        variantsError
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
      fetchErrors++;
      console.error(
        '[Jumia Stock Sync] Failed to fetch product stock:',
        productsError
      );
    }
    for (const p of products || []) {
      productStockMap.set(p.id, getEffectiveStock(p));
    }
  }

  const stockUpdates: JumiaStockUpdate[] = [];
  let skipped = 0;

  for (const mapping of pushReady) {
    const stock = mapping.variant_id
      ? variantStockMap.get(mapping.variant_id)
      : productStockMap.get(mapping.product_id);

    if (stock === undefined) {
      skipped++;
      continue;
    }

    if (stock === mapping.baci_stock_at_last_sync) {
      continue;
    }

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

  return { stockUpdates, skipped, fetchErrors };
}
