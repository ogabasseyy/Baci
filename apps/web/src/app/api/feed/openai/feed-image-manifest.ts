import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkValues } from '@/lib/chunk-values';
import type { ImageManifestMap } from '../google-merchant/feed-builder';

const OPENAI_FEED_IMAGE_MANIFEST_PAGE_SIZE = 1000;
const OPENAI_FEED_IMAGE_MANIFEST_PRODUCT_BATCH_SIZE = 250;
const OPENAI_FEED_IMAGE_MANIFEST_MAX_CONCURRENT_BATCHES = 4;

type FeedImageManifestRow = {
  product_id: string;
  variant_id?: string | null;
  source_url?: string | null;
  verified_url: string | null;
  verified_format: string | null;
  status: string;
  is_primary: boolean;
  position: number;
};

function buildImageManifest(rows: FeedImageManifestRow[]): ImageManifestMap {
  const imageManifest: ImageManifestMap = {};

  for (const row of rows) {
    if (!imageManifest[row.product_id]) {
      imageManifest[row.product_id] = [];
    }

    imageManifest[row.product_id].push({
      variant_id: row.variant_id ?? null,
      source_url: row.source_url ?? null,
      verified_url: row.verified_url,
      verified_format: row.verified_format,
      status: 'verified',
      is_primary: row.is_primary,
      position: row.position,
    });
  }

  return imageManifest;
}

async function fetchVerifiedImageManifestRows(
  supabase: SupabaseClient,
  merchantId: string,
  productIds: string[]
): Promise<FeedImageManifestRow[]> {
  const manifestBatches = chunkValues(
    productIds,
    OPENAI_FEED_IMAGE_MANIFEST_PRODUCT_BATCH_SIZE
  );
  const manifestRows: FeedImageManifestRow[] = [];

  for (
    let batchStart = 0;
    batchStart < manifestBatches.length;
    batchStart += OPENAI_FEED_IMAGE_MANIFEST_MAX_CONCURRENT_BATCHES
  ) {
    const batchWindow = manifestBatches.slice(
      batchStart,
      batchStart + OPENAI_FEED_IMAGE_MANIFEST_MAX_CONCURRENT_BATCHES
    );
    const batchResults = await Promise.all(
      batchWindow.map(async (batchProductIds, batchWindowIndex) => {
        const batchIndex = batchStart + batchWindowIndex;
        const batchRows: FeedImageManifestRow[] = [];
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
            .range(offset, offset + OPENAI_FEED_IMAGE_MANIFEST_PAGE_SIZE - 1);

          if (error) {
            console.error('DB_IMAGE_MANIFEST_ERROR:', {
              batchIndex,
              batchProductCount: batchProductIds.length,
              error,
              merchantId,
              offset,
            });
            throw new Error('Failed to fetch image manifest');
          }

          const page = (data || []) as FeedImageManifestRow[];
          batchRows.push(...page);

          if (page.length < OPENAI_FEED_IMAGE_MANIFEST_PAGE_SIZE) {
            break;
          }

          offset += OPENAI_FEED_IMAGE_MANIFEST_PAGE_SIZE;
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

export async function fetchVerifiedOpenAIImageManifest(
  supabase: SupabaseClient,
  merchantId: string,
  productIds: string[]
): Promise<ImageManifestMap | undefined> {
  if (productIds.length === 0) return undefined;

  return buildImageManifest(
    await fetchVerifiedImageManifestRows(supabase, merchantId, productIds)
  );
}
