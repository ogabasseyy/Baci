import type { SupabaseClient } from '@supabase/supabase-js';

export interface JumiaStockTrackingUpdate {
  mappingId: string;
  stock: number;
}

/**
 * Advances per-mapping stock tracking after a Jumia stock feed is accepted.
 *
 * Uses scoped updates instead of a partial upsert: an upsert row carrying
 * only `id` plus tracking columns omits NOT NULL mapping columns, and
 * PostgreSQL validates the insert tuple before applying the conflict
 * update, so the bulk write fails and `baci_stock_at_last_sync` never
 * advances. Failures are counted per row so callers can surface them.
 */
export async function updateJumiaStockTracking(
  supabase: SupabaseClient,
  args: { updates: JumiaStockTrackingUpdate[]; feedId: string | null }
): Promise<{ trackingFailures: number }> {
  const now = new Date().toISOString();
  const results = await Promise.all(
    args.updates.map((update) =>
      supabase
        .from('jumia_product_mappings')
        .update({
          baci_stock_at_last_sync: update.stock,
          last_stock_synced_at: now,
          ...(args.feedId ? { last_feed_id: args.feedId } : {}),
        })
        .eq('id', update.mappingId)
    )
  );
  return {
    trackingFailures: results.filter((result) => result.error).length,
  };
}
