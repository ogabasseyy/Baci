import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import {
  revalidateProductSlugs,
  revalidateProducts,
} from './cache-revalidation';
import { expireProductBlogCache } from './expire-product-blog-cache';
import { expireProductBlogCacheReliable } from './expire-product-blog-cache-reliable';
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
  dependentProductIdentifiers?: readonly string[];
  dependentAliasesIncomplete?: boolean;
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
  dependentProductIdentifiers = [],
  dependentAliasesIncomplete = false,
  blogPostSlugs,
  blogPostIds,
  purgeWholeStorefront,
}: ScheduleProductMutationPurgeInput): void {
  // Hard-expire the per-slug PDP snapshots before the edge purge below:
  // stale-while-revalidate would serve the pre-mutation snapshot to the
  // first post-purge request and re-seed Cloudflare with the old price,
  // stock, or deleted product.
  const slugsExpired =
    revalidateProductSlugs(
      merchantId,
      [
        ...entries.map((entry) => entry.slug),
        ...productIds,
        ...dependentProductIdentifiers,
      ],
      {
        expireImmediately: true,
      }
    ) === true;
  expireProductBlogCache(merchantId);

  const scheduleEdgePurge = () => {
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
  };

  const scopedListingsExpired =
    !purgeWholeStorefront &&
    !dependentAliasesIncomplete &&
    slugsExpired &&
    revalidateProducts(merchantId, undefined, {
      expireImmediately: true,
      omitMerchantWidePdpDetails: true,
    }) === true;
  if (scopedListingsExpired) {
    scheduleEdgePurge();
    return;
  }

  if (
    revalidateProducts(merchantId, undefined, { expireImmediately: true }) ===
    true
  ) {
    scheduleEdgePurge();
    return;
  }
  const runFallback = async () => {
    try {
      const expired = await expireProductBlogCacheReliable(merchantId, {
        expireWidePdpDetails: true,
      });
      if (expired) {
        scheduleEdgePurge();
      } else {
        console.warn(
          'Skipped mutation hostname purge because PDP hard expiry failed',
          { merchantId }
        );
      }
    } catch (error) {
      console.warn(
        'Skipped mutation hostname purge after reliable expiry error',
        { merchantId, error }
      );
    }
  };
  try {
    after(runFallback);
  } catch {
    void runFallback();
  }
}
