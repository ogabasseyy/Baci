import type { SupabaseClient } from '@supabase/supabase-js';

export interface PersistFeedManifestResult {
  upserted: number;
  failedRows: number;
  persistErrors: number;
}

/**
 * Persists verified manifest rows with batched upserts and retries, then
 * marks product-level rows that are no longer in the source set as stale.
 * Variant-scoped feed-only rows are owned by the image-generation
 * pipeline and are never touched here.
 */
export async function persistFeedManifest(args: {
  supabase: SupabaseClient;
  merchantId: string;
  upsertRows: Array<Record<string, unknown>>;
  currentPairs: ReadonlySet<string>;
}): Promise<PersistFeedManifestResult> {
  const { supabase, merchantId, upsertRows, currentPairs } = args;
  const BATCH_SIZE = 100;
  const PAGE_SIZE = 1000;
  const MAX_RETRIES = 3;
  let upserted = 0;
  let persistErrors = 0;
  let failedRows = 0;

  for (let i = 0; i < upsertRows.length; i += BATCH_SIZE) {
    const batch = upsertRows.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE);
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const { error: upsertError } = await supabase
        .from('product_feed_images')
        .upsert(batch, {
          onConflict: 'merchant_id,product_id,source_url',
          ignoreDuplicates: false,
        });

      if (!upsertError) {
        upserted += batch.length;
        break;
      }

      if (attempt < MAX_RETRIES - 1) {
        const delay = 1000 * 2 ** attempt; // 1s, 2s, 4s
        console.warn(`Batch ${batchNum} attempt ${attempt + 1} failed: ${upsertError.message} — retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        console.error(`Batch ${batchNum} failed after ${MAX_RETRIES} attempts: ${upsertError.message}`);
        persistErrors++;
        failedRows += batch.length;
      }
    }
  }

  console.log(`\nUpserted ${upserted}/${upsertRows.length} rows into product_feed_images (${failedRows} failed)`);

  // Mark stale product-level rows — (product_id, source_url) pairs no
  // longer in the current product.images source set. Variant-scoped feed-only
  // rows are owned by the image-generation pipeline.
  const existingRows: { id: string; product_id: string; source_url: string }[] = [];
  let staleOffset = 0;
  let staleHasMore = true;
  let existingError: unknown = null;

  while (staleHasMore) {
    const { data, error } = await supabase
      .from('product_feed_images')
      .select('id, product_id, source_url')
      .eq('merchant_id', merchantId)
      .is('variant_id', null)
      .neq('status', 'stale')
      .range(staleOffset, staleOffset + PAGE_SIZE - 1);

    if (error) {
      existingError = error;
      existingRows.length = 0;
      break;
    }

    existingRows.push(...(data || []));
    staleHasMore = (data?.length ?? 0) === PAGE_SIZE;
    staleOffset += PAGE_SIZE;
  }

  if (existingError) {
    console.error(
      'Failed to fetch existing rows for stale detection:',
      existingError instanceof Error ? existingError.message : String(existingError)
    );
    persistErrors++;
  } else {
    const staleIds: string[] = [];
    for (const row of existingRows) {
      const key = `${row.product_id}::${row.source_url}`;
      if (!currentPairs.has(key)) {
        staleIds.push(row.id);
      }
    }

    if (staleIds.length > 0) {
      // Batch stale updates
      for (let i = 0; i < staleIds.length; i += BATCH_SIZE) {
        const batch = staleIds.slice(i, i + BATCH_SIZE);
        const { error: staleError } = await supabase
          .from('product_feed_images')
          .update({ status: 'stale', is_primary: false, updated_at: new Date().toISOString() })
          .in('id', batch);
        if (staleError) {
          console.error(`Stale update error:`, staleError.message);
          persistErrors++;
        }
      }
      console.log(`Marked ${staleIds.length} orphaned rows as stale`);
    } else {
      console.log('No stale rows found');
    }
  }

  return { upserted, failedRows, persistErrors };
}
