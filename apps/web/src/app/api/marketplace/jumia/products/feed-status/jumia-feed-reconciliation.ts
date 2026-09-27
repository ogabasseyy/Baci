import type { SupabaseClient } from '@supabase/supabase-js';
import type { PendingFeedMapping } from '@/lib/jumia/jumia-feed-reconciliation-batch';
import { logger } from '@/lib/logger';

async function markMappingsAsFeedError(
  supabase: SupabaseClient,
  merchantId: string,
  mappings: PendingFeedMapping[],
  message: string
): Promise<number> {
  let marked = 0;
  for (const mapping of mappings) {
    const { error } = await supabase
      .from('jumia_product_mappings')
      .update({
        sync_status: 'error',
        sync_error: message,
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', mapping.id)
      .eq('merchant_id', merchantId);
    if (!error) {
      marked++;
      continue;
    }
    logger.error({
      message: 'Failed to mark rejected Jumia feed mapping',
      error,
      mapping_id: mapping.id,
    });
    throw new Error('Failed to mark rejected Jumia feed mapping');
  }
  return marked;
}

export type ManualResolutionEntry = {
  mappingId: string;
  sellerSku: string | null;
};

async function markMappingsAsPendingForManualResolution(
  supabase: SupabaseClient,
  merchantId: string,
  mappings: PendingFeedMapping[],
  message: string
): Promise<ManualResolutionEntry[]> {
  const preserved: ManualResolutionEntry[] = [];
  for (const mapping of mappings) {
    const update = supabase
      .from('jumia_product_mappings')
      .update({
        sync_status: 'pending',
        sync_error: message,
        last_feed_id: null,
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', mapping.id)
      .eq('merchant_id', merchantId)
      .eq('sync_status', 'pending');
    // Only downgrade the row this poll observed: a concurrent poll may have
    // synced the mapping or recorded a newer feed since it was read.
    const guarded =
      mapping.last_feed_id === null
        ? update.is('last_feed_id', null)
        : update.eq('last_feed_id', mapping.last_feed_id);
    const { data, error } = await guarded
      .select('id')
      .maybeSingle<{ id: string }>();
    if (error) {
      logger.error({
        message: 'Failed to preserve unmatched Jumia feed mapping',
        error,
        mapping_id: mapping.id,
      });
      throw new Error('Failed to preserve unmatched Jumia feed mapping');
    }
    if (data) {
      preserved.push({
        mappingId: mapping.id,
        sellerSku: mapping.jumia_seller_sku,
      });
    }
  }
  return preserved;
}

/**
 * Advances the retry timestamp for mappings whose feed lookup failed with a
 * retryable error. The reconciliation window always takes the oldest
 * timestamps, so without rotation a stuck head would starve newer feeds
 * forever. Best-effort: the lookup already failed, so a touch failure must
 * not fail the batch.
 */
async function touchMappingsForFeedRetry(
  supabase: SupabaseClient,
  merchantId: string,
  mappings: PendingFeedMapping[]
): Promise<void> {
  if (mappings.length === 0) return;
  const { error } = await supabase
    .from('jumia_product_mappings')
    .update({ last_synced_at: new Date().toISOString() })
    .in(
      'id',
      mappings.map((mapping) => mapping.id)
    )
    .eq('merchant_id', merchantId);
  if (error) {
    logger.error({
      message: 'Failed to rotate Jumia feed retry window',
      error,
    });
  }
}

function findMappingForFeedItem(
  mappingsForFeed: PendingFeedMapping[],
  sellerSku: string,
  feedItemCount: number
): PendingFeedMapping | undefined {
  const exactMatch = mappingsForFeed.find(
    (mapping) => mapping.jumia_seller_sku === sellerSku
  );
  if (exactMatch) return exactMatch;

  if (
    feedItemCount === 1 &&
    mappingsForFeed.length === 1 &&
    !mappingsForFeed[0]?.jumia_seller_sku
  ) {
    return mappingsForFeed[0];
  }

  return undefined;
}

export const jumiaFeedReconciliation = {
  findMappingForFeedItem,
  markMappingsAsFeedError,
  markMappingsAsPendingForManualResolution,
  touchMappingsForFeedRetry,
};
