import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkValues } from '@/lib/chunk-values';
import type { FeedVariant } from './feed-builder';
import { FEED_FETCH_CONSTANTS } from './feed-fetch-constants';

const VARIANT_PAGE_SIZE = 1000;

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
        const batchRows: FeedVariantRow[] = [];
        for (let offset = 0; ; offset += VARIANT_PAGE_SIZE) {
          // PostgREST caps rows per response, even for a bounded product batch.
          const { data, error } = await supabase
            .rpc('get_feed_product_variants', {
              p_merchant_id: merchantId,
              p_product_ids: batchProductIds,
            })
            .order('id', { ascending: true })
            .range(offset, offset + VARIANT_PAGE_SIZE - 1);

          if (error) {
            console.error('DB_VARIANTS_ERROR:', {
              batchIndex,
              batchProductCount: batchProductIds.length,
              error,
              merchantId,
              offset,
            });
            throw new Error('Failed to fetch product variants');
          }
          const page = (data ?? []) as FeedVariantRow[];
          batchRows.push(...page);
          if (page.length < VARIANT_PAGE_SIZE) return batchRows;
        }
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
