import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkValues } from '@/lib/chunk-values';
import { FEED_FETCH_CONSTANTS } from './feed-fetch-constants';

const FEED_IMAGE_MANIFEST_PAGE_SIZE = 1000;
// Keep PostgREST `in(...)` URL filters under common proxy limits.
const FEED_IMAGE_MANIFEST_PRODUCT_BATCH_SIZE = 250;

export type ManifestRow = {
  source_url?: string | null;
  product_id: string;
  variant_id?: string | null;
  verified_url: string | null;
  verified_format: string | null;
  status: string;
  is_primary: boolean;
  position: number;
};

/** Fetch verified image manifest rows for products in bounded batches. */
export async function fetchVerifiedImageManifestRows(
  supabase: SupabaseClient,
  merchantId: string,
  productIds: string[]
): Promise<ManifestRow[]> {
  const manifestBatches = chunkValues(
    productIds,
    FEED_IMAGE_MANIFEST_PRODUCT_BATCH_SIZE
  );
  const manifestRows: ManifestRow[] = [];

  for (
    let batchStart = 0;
    batchStart < manifestBatches.length;
    batchStart += FEED_FETCH_CONSTANTS.MANIFEST_MAX_CONCURRENT_BATCHES
  ) {
    const batchWindow = manifestBatches.slice(
      batchStart,
      batchStart + FEED_FETCH_CONSTANTS.MANIFEST_MAX_CONCURRENT_BATCHES
    );
    const batchResults = await Promise.all(
      batchWindow.map(async (batchProductIds, batchWindowIndex) => {
        const batchIndex = batchStart + batchWindowIndex;
        const batchRows: ManifestRow[] = [];
        let offset = 0;

        while (true) {
          const { data, error } = await supabase
            .from('product_feed_images')
            .select(
              'product_id, variant_id, source_url, verified_url, verified_format, status, is_primary, position'
            )
            .eq('merchant_id', merchantId)
            .eq('status', 'verified')
            .in('product_id', batchProductIds)
            .order('product_id', { ascending: true })
            .order('position', { ascending: true })
            .order('id', { ascending: true })
            .range(offset, offset + FEED_IMAGE_MANIFEST_PAGE_SIZE - 1)
            .overrideTypes<ManifestRow[], { merge: false }>();

          if (error) {
            console.error('DB_MANIFEST_ERROR:', {
              batchIndex,
              batchProductCount: batchProductIds.length,
              error,
              merchantId,
              offset,
            });
            throw new Error('Failed to fetch image manifest');
          }

          const page = data || [];
          batchRows.push(...page);

          if (page.length < FEED_IMAGE_MANIFEST_PAGE_SIZE) {
            break;
          }

          offset += FEED_IMAGE_MANIFEST_PAGE_SIZE;
        }

        return batchRows;
      })
    );

    for (const rows of batchResults) {
      if (rows.length > 0) {
        manifestRows.push(...rows);
      }
    }
  }

  return manifestRows;
}
