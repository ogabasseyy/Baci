#!/usr/bin/env npx tsx
/**
 * Backfill script for `product_feed_images` manifest table.
 *
 * Run on the VPS or locally to populate/refresh the verified image manifest
 * used by the Google Merchant Center feed route.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-feed-images.ts [merchant_slug]
 *
 * What it does:
 * 1. Loads active products for the given merchant
 * 2. Extracts image candidates from each product's `images` JSONB
 * 3. Classifies each candidate (pure, extension-based)
 * 4. Verifies each candidate (CDN filesystem or HTTP probe)
 * 5. Upserts rows into `product_feed_images` with true statuses
 * 6. Marks stale rows (no longer in product source set)
 * 7. Reports summary stats and pending derivative file list
 */

import { createClient } from '@supabase/supabase-js';
import {
  type BackfillImageCandidate,
  type ClassifiedImage,
  type ProductImages,
  classifyFeedImageCandidate,
  extractImageCandidates,
} from '../packages/shared/src/gmc-feed/index';
import {
  type VerificationResult,
  getClassifiedImageVerificationUrl,
  isCdnUrl,
  verifyCdnImageWithTransformFallback,
  verifyRemoteImage,
} from './lib/gmc-feed-verifier';
import { appendOfferImageCandidates } from './lib/feed-offer-image-backfill';

// ---------- Config ----------

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CDN_BASE_PATH = process.env.CDN_BASE_PATH;
const CONCURRENCY = 10;

if (!SUPABASE_URL || !SUPABASE_KEY || !CDN_BASE_PATH) {
  console.error(
    'Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CDN_BASE_PATH'
  );
  process.exit(1);
}

// Narrow types after the guard — process.exit never returns
const cdnBasePath: string = CDN_BASE_PATH;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- Concurrency limiter ----------

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ---------- Verification orchestrator ----------

async function verifyClassifiedImage(
  classified: ClassifiedImage,
  cdnBasePath: string
): Promise<VerificationResult> {
  const url = getClassifiedImageVerificationUrl(classified);

  // Already invalid — no verification needed
  if (classified.status === 'invalid') {
    return {
      status: 'invalid',
      verified_url: null,
      verified_format: null,
      failure_reason: classified.failure_reason,
    };
  }

  // CDN-hosted: verify via filesystem
  if (isCdnUrl(url)) {
    return verifyCdnImageWithTransformFallback(url, cdnBasePath);
  }

  // Non-CDN absolute URL or absolutized relative path: verify via HTTP
  if (url.startsWith('http')) {
    return verifyRemoteImage(url);
  }

  return {
    status: 'invalid',
    verified_url: null,
    verified_format: null,
    failure_reason: `Cannot verify URL: ${url}`,
  };
}

// ---------- Main ----------

async function main() {
  const merchantSlug = process.argv[2];

  if (!merchantSlug) {
    console.error('Usage: npx tsx scripts/backfill-feed-images.ts <merchant_slug>');
    process.exit(1);
  }

  // 1. Resolve merchant
  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('id, slug')
    .eq('slug', merchantSlug)
    .single();

  if (error || !merchant) {
    console.error(`Merchant "${merchantSlug}" not found:`, error?.message);
    process.exit(1);
  }

  const { data: primaryDomain, error: domainError } = await supabase
    .from('domains')
    .select('domain')
    .eq('merchant_id', merchant.id)
    .eq('status', 'active')
    .eq('is_primary', true)
    .maybeSingle();

  if (domainError) {
    console.error(
      `Failed to resolve primary domain for merchant "${merchantSlug}":`,
      domainError.message
    );
    process.exit(1);
  }

  const merchantId = merchant.id;
  const storefrontBaseUrl = primaryDomain?.domain
    ? `https://${primaryDomain.domain}`
    : `https://${merchant.slug}.baci.app`;

  console.log(`Backfilling for merchant: ${merchantSlug} (${merchantId})`);
  console.log(`Storefront base URL: ${storefrontBaseUrl}`);
  console.log(`CDN base path: ${cdnBasePath}`);

  // 2. Load active products (paginated — Supabase defaults to 1000 row limit)
  const PAGE_SIZE = 1000;
  const products: {
    id: string;
    images: unknown;
    condition?: string | null;
    has_condition_offers?: boolean | null;
  }[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error: productsError } = await supabase
      .from('products')
      .select('id, images, condition, has_condition_offers')
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .range(offset, offset + PAGE_SIZE - 1);

    if (productsError) {
      console.error('Failed to fetch products:', productsError.message);
      process.exit(1);
    }

    products.push(...(data || []));
    hasMore = (data?.length ?? 0) === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  console.log(`Found ${products.length} active products`);

  // 3. Extract and classify (pure)
  const classifiedRows: Array<{ candidate: BackfillImageCandidate; classified: ClassifiedImage }> = [];

  for (const product of products) {
    const candidates = extractImageCandidates(product.id, product.images as ProductImages);
    for (const candidate of candidates) {
      const classified = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
      classifiedRows.push({ candidate, classified });
    }
  }

  // Condition offers can own imagery that is not duplicated on the parent
  // product. Merge those URLs (merchant-scoped) into the same verified
  // manifest so feed rows can resolve offer-specific images. Only flagged
  // products are eligible: feed hydration skips the offers relation
  // otherwise, so unflagged offer rows could never build an exclusion set
  // and would leak into base product imagery.
  const offerProducts = products.filter(
    (product) => product.has_condition_offers
  );
  try {
    classifiedRows.push(
      ...(await appendOfferImageCandidates({
        supabase,
        productIds: offerProducts.map((product) => product.id),
        merchantId,
        storefrontBaseUrl,
        productRows: classifiedRows,
        productConditions: new Map(
          offerProducts.map((product) => [product.id, product.condition])
        ),
      }))
    );
  } catch (err) {
    console.error(
      'Failed to fetch product offer images:',
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  }

  console.log(`\nClassified ${classifiedRows.length} image candidates`);

  // 4. Verify each candidate (I/O)
  console.log(`Verifying images (concurrency: ${CONCURRENCY})...`);
  const verificationTasks = classifiedRows.map(
    ({ classified }) => () => verifyClassifiedImage(classified, cdnBasePath)
  );
  const verificationResults = await runWithConcurrency(verificationTasks, CONCURRENCY);

  // 5. Build upsert rows with true statuses
  const stats = {
    verified: 0,
    pending_derivative: 0,
    pending_verification: 0,
    missing: 0,
    invalid: 0,
    total: 0,
  };

  const currentPairs = new Set<string>();
  const upsertRows: Array<Record<string, unknown>> = [];
  const pendingDerivativePaths: string[] = [];

  for (let i = 0; i < classifiedRows.length; i++) {
    const { classified } = classifiedRows[i];
    const verification = verificationResults[i];
    stats.total++;

    const finalStatus = verification.status;
    switch (finalStatus) {
      case 'verified':
      case 'pending_derivative':
      case 'pending_verification':
      case 'missing':
      case 'invalid':
        stats[finalStatus]++;
        break;
    }

    currentPairs.add(`${classified.product_id}::${classified.source_url}`);

    upsertRows.push({
      merchant_id: merchantId,
      product_id: classified.product_id,
      source_url: classified.source_url,
      verified_url: verification.verified_url,
      verified_format: verification.verified_format,
      status: finalStatus,
      is_primary: classified.is_primary,
      position: classified.position,
      failure_reason: verification.failure_reason,
      last_checked_at: new Date().toISOString(),
      verified_at: finalStatus === 'verified' ? new Date().toISOString() : null,
    });

    // Track files needing derivative generation
    if (finalStatus === 'pending_derivative' && isCdnUrl(classified.source_url)) {
      try {
        const url = new URL(classified.source_url);
        pendingDerivativePaths.push(`${cdnBasePath}${url.pathname}`);
      } catch {
        // Skip malformed URLs
      }
    }
  }

  console.log('\nVerification summary:');
  console.log(`  Total images: ${stats.total}`);
  console.log(`  Verified: ${stats.verified}`);
  console.log(`  Pending derivative (AVIF needs JPG): ${stats.pending_derivative}`);
  console.log(`  Pending verification (needs recheck): ${stats.pending_verification}`);
  console.log(`  Missing: ${stats.missing}`);
  console.log(`  Invalid: ${stats.invalid}`);

  // 6. Upsert in batches with retry
  const BATCH_SIZE = 100;
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

  // 7. Mark stale product-level rows — (product_id, source_url) pairs no
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

  // 8. Report pending derivatives
  if (pendingDerivativePaths.length > 0) {
    console.log(`\n${pendingDerivativePaths.length} AVIF files need JPG derivatives:`);
    for (const path of pendingDerivativePaths) {
      const jpgPath = path.replace(/\.avif$/i, '.jpg');
      console.log(`  ${path} -> ${jpgPath}`);
    }
    console.log('\nGenerate them on the VPS:');
    console.log('  for f in <paths above>; do jpg="${f%.avif}.jpg"; [ -f "$jpg" ] || convert "$f" "$jpg"; done');
    console.log('Then re-run this script to promote them to verified.');
  }

  // 9. Fail loudly if any persist operations failed — before any cache bust
  if (persistErrors > 0) {
    console.error(`\n${persistErrors} persist error(s) occurred — manifest may be incomplete.`);
    console.error('Feed cache NOT revalidated. Fix errors and re-run.');
    process.exit(1);
  }

  // 10. Bust the feed cache via the revalidation endpoint so the next
  //     feed request picks up the fresh manifest immediately.
  //     Requires CRON_SECRET to match the deployed app's value.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    console.log('\nRevalidating feed cache...');
    try {
      const revalidateUrl = `${storefrontBaseUrl}/api/feed/google-merchant/revalidate`;
      const res = await fetch(revalidateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cronSecret}`,
        },
        body: JSON.stringify({ merchant_id: merchantId }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        console.log('  Feed cache revalidated successfully.');
      } else {
        console.warn(`  Revalidation returned ${res.status} — cache may be stale for up to 1 hour.`);
      }
    } catch (err) {
      console.warn(`  Could not reach revalidation endpoint: ${(err as Error).message}`);
      console.warn('  Feed cache may be stale for up to 1 hour.');
    }
  } else {
    console.warn('\nCRON_SECRET not set — skipping feed cache revalidation.');
    console.warn('Feed cache may be stale for up to 1 hour.');
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
