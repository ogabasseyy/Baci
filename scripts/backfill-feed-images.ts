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
import { isCdnUrl } from './lib/gmc-feed-verifier';
import { verifyClassifiedImage } from './lib/verify-classified-image';
import { appendOfferProductImages } from './lib/offer-product-images';
import { persistFeedManifest } from './lib/persist-feed-manifest';
import { revalidateFeedCache } from './lib/revalidate-feed-cache';
import { runWithConcurrency } from './lib/run-with-concurrency';

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
    variant_model?: string | null;
  }[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error: productsError } = await supabase
      .from('products')
      .select('id, images, condition, has_condition_offers, variant_model')
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
  // manifest so feed rows can resolve offer-specific images.
  try {
    classifiedRows.push(
      ...(await appendOfferProductImages({
        supabase,
        products,
        merchantId,
        storefrontBaseUrl,
        productRows: classifiedRows,
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

  // 6+7. Persist rows and mark stale orphans (see lib/persist-feed-manifest).
  const { persistErrors } = await persistFeedManifest({
    supabase,
    merchantId,
    upsertRows,
    currentPairs,
  });

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
  //     Requires CRON_SECRET to match the deployed app's value. The
  //     helper targets the deployment origin, never the merchant domain.
  await revalidateFeedCache({ merchantId });
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
