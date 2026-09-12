import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidateProductSlugs } from './cache-revalidation';
import { expireProductBlogCache } from './expire-product-blog-cache';
import { scheduleProductBlogPurgeAfterResponse } from './schedule-product-blog-purge-after-response';
import { scheduleStorefrontProductPurge } from './storefront-product-purge';
import { scheduleStorefrontHostnamePurge } from './storefront-product-purge-hostnames';
import type { StorefrontProductPurgeEntry } from './storefront-product-purge-urls';

interface ScheduleProductMutationPurgeInput {
  supabase: SupabaseClient;
  merchantId: string;
  merchantSlug: string | null | undefined;
  productIds: readonly string[];
  entries: readonly StorefrontProductPurgeEntry[];
  blogPostSlugs?: readonly string[];
  blogPostIds?: readonly string[];
  purgeWholeStorefront?: boolean;
}

/**
 * Evict core product URLs immediately and defer article enrichment until after
 * the mutation response. Keeping this sequence in one helper prevents update
 * and delete handlers from drifting apart.
 */
export function scheduleProductMutationPurge({
  supabase,
  merchantId,
  merchantSlug,
  productIds,
  entries,
  blogPostSlugs,
  blogPostIds,
  purgeWholeStorefront,
}: ScheduleProductMutationPurgeInput): void {
  revalidateProductSlugs(
    merchantId,
    entries.map((entry) => entry.slug)
  );
  expireProductBlogCache(merchantId);
  if (purgeWholeStorefront) {
    scheduleStorefrontHostnamePurge(merchantSlug);
    return;
  }
  scheduleStorefrontProductPurge(merchantSlug, entries);
  scheduleProductBlogPurgeAfterResponse({
    supabase,
    merchantId,
    merchantSlug,
    productIds,
    entries,
    blogPostSlugs,
    blogPostIds,
    categorySlugs: entries.map((entry) => entry.categorySegment),
    skipProductPurge: true,
  });
}
