import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkValues } from '@/lib/chunk-values';
import type { FeedVariant } from './feed-builder';
import { FEED_FETCH_CONSTANTS } from './feed-fetch-constants';

export interface FeedVariantRow {
  attributes: Record<string, unknown> | null;
  condition?: FeedVariant['condition'];
  id: string;
  price_override?: number | string | null;
  product_id: string;
  sku?: string | null;
  stock_quantity?: number | null;
}

/** Fetch variant rows for products via the batched variant RPC. */
export async function fetchFeedVariants(
  supabase: SupabaseClient,
  merchantId: string,
  productIds: string[]
): Promise<FeedVariantRow[]> {
  const variantBatches = chunkValues(
    productIds,
    FEED_FETCH_CONSTANTS.VARIANTS_BATCH_SIZE
  );
  const variantRows: FeedVariantRow[] = [];

  for (
    let batchStart = 0;
    batchStart < variantBatches.length;
    batchStart += FEED_FETCH_CONSTANTS.VARIANTS_MAX_CONCURRENT_BATCHES
  ) {
    const batchWindow = variantBatches.slice(
      batchStart,
      batchStart + FEED_FETCH_CONSTANTS.VARIANTS_MAX_CONCURRENT_BATCHES
    );
    const batchResults = await Promise.all(
      batchWindow.map(async (batchProductIds, batchWindowIndex) => {
        const batchIndex = batchStart + batchWindowIndex;
        const { data, error } = await supabase.rpc(
          'get_feed_product_variants',
          {
            p_merchant_id: merchantId,
            p_product_ids: batchProductIds,
          }
        );

        if (error) {
          console.error('DB_VARIANTS_ERROR:', {
            batchIndex,
            batchProductCount: batchProductIds.length,
            error,
            merchantId,
          });
          throw new Error('Failed to fetch product variants');
        }

        return (data || []) as FeedVariantRow[];
      })
    );

    for (const rows of batchResults) {
      if (rows.length > 0) {
        variantRows.push(...rows);
      }
    }
  }

  return variantRows;
}
