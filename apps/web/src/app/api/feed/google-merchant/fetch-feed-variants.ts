import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkValues } from '@/lib/chunk-values';
import type { FeedVariant } from './feed-builder';

export const FEED_PRODUCT_VARIANTS_BATCH_SIZE = 50;
// Keep variant hydration bounded: the smaller RPC batches reduce DB work per
// call, while limited parallelism prevents cold public feeds from serializing
// up to 200 round trips for max-size merchant catalogs.
export const FEED_PRODUCT_VARIANTS_MAX_CONCURRENT_BATCHES = 4;

export interface FeedVariantRow {
  attributes: Record<string, unknown> | null;
  condition?: FeedVariant['condition'];
  id: string;
  price_override?: number | string | null;
  product_id: string;
  sku?: string | null;
  stock_quantity?: number | null;
}

export function normalizeFeedVariantPrice(
  value: number | string | null | undefined
): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/** Fetch variant rows for products via the batched variant RPC. */
export async function fetchFeedVariants(
  supabase: SupabaseClient,
  merchantId: string,
  productIds: string[]
): Promise<FeedVariantRow[]> {
  const variantBatches = chunkValues(
    productIds,
    FEED_PRODUCT_VARIANTS_BATCH_SIZE
  );
  const variantRows: FeedVariantRow[] = [];

  for (
    let batchStart = 0;
    batchStart < variantBatches.length;
    batchStart += FEED_PRODUCT_VARIANTS_MAX_CONCURRENT_BATCHES
  ) {
    const batchWindow = variantBatches.slice(
      batchStart,
      batchStart + FEED_PRODUCT_VARIANTS_MAX_CONCURRENT_BATCHES
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
