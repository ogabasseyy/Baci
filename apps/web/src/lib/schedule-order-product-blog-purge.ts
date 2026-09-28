import type { SupabaseClient } from '@supabase/supabase-js';
import { enrichProductPurgeEntries } from '@/lib/authoritative-product-purge-enrichment';
import { revalidateProductSlugs } from '@/lib/cache-revalidation';
import { expireProductBlogCacheReliable } from '@/lib/expire-product-blog-cache-reliable';
import { scheduleStorefrontProductPurge } from '@/lib/storefront-product-purge';
import { scheduleStorefrontHostnamePurge } from '@/lib/storefront-product-purge-hostnames';

interface ScheduleOrderProductBlogPurgeInput {
  merchantId: string;
  merchantSlug?: string | null;
  productIds: readonly (string | null | undefined)[];
  supabase: SupabaseClient;
  /**
   * Set when the caller's target sweep may have truncated rows (e.g. a
   * mid-sweep page failure): the purge scope is unknown, so the hostname
   * fallback replaces the product-scoped purge.
   */
  targetSweepIncomplete?: boolean;
}

/**
 * Evict edge-cached storefront articles whose related-product rail may have
 * changed after checkout or order cancellation. Product/category mutations
 * already handle the Next tags; this helper covers the additional Cloudflare
 * document that embeds the rail, including legacy category-fallback posts.
 *
 * The lookup is deliberately best-effort. A cache purge failure must never
 * turn a completed order or cancellation into an error; the article TTL and
 * the next product-tag invalidation remain safe fallbacks.
 */
export async function scheduleOrderProductBlogPurge({
  merchantId,
  merchantSlug: suppliedMerchantSlug,
  productIds,
  supabase,
  targetSweepIncomplete = false,
}: ScheduleOrderProductBlogPurgeInput): Promise<void> {
  const normalizedProductIds = Array.from(
    new Set(
      productIds
        .map((productId) => productId?.trim())
        .filter((productId): productId is string => Boolean(productId))
    )
  );
  if (normalizedProductIds.length === 0) {
    return;
  }

  // Enrichment, per-slug revalidation, and blog-cache expiry need only
  // the merchant id, so they run BEFORE the slug lookup: a transient
  // `merchants` read failure must not skip the local invalidation for an
  // already-committed inventory mutation. Only the Cloudflare purge below
  // is gated on resolving the slug.
  const products = normalizedProductIds.map((id) => ({ id }));
  let entries: Awaited<ReturnType<typeof enrichProductPurgeEntries>>['entries'];
  let blogPostSlugs: string[];
  let blogPostSlugsIncomplete: boolean;
  let slugs: string[];
  try {
    const enriched = await enrichProductPurgeEntries(
      supabase,
      merchantId,
      products
    );
    entries = enriched.entries;
    blogPostSlugs = enriched.blogPostSlugs;
    blogPostSlugsIncomplete =
      enriched.blogPostSlugsIncomplete === true || targetSweepIncomplete;
    slugs = enriched.resolvedSlugs ?? entries.map((entry) => entry.slug);
  } catch (error) {
    console.warn('Skipped order-related blog purge after enrichment failed', {
      merchantId,
      error,
    });
    return;
  }
  if (entries.length === 0) {
    return;
  }

  // Hard-expire the per-slug PDP snapshots before the edge purge below:
  // stale-while-revalidate would serve the pre-mutation snapshot to the
  // first post-purge request and re-seed Cloudflare with stale stock. The
  // slugs ride along to the worker-safe expiry so standalone workers (no
  // request context) invalidate the same tags via the internal endpoint.
  revalidateProductSlugs(merchantId, slugs, { expireImmediately: true });
  const blogCacheExpired = await expireProductBlogCacheReliable(merchantId, {
    productSlugs: slugs,
  });
  if (!blogCacheExpired) {
    // The standalone worker path reports hard-expiry failure as `false`
    // (timeout/non-2xx). Purging the edge now would let the first request
    // refill from the unchanged Next snapshots, so skip the edge purge; the
    // article TTL plus the next invalidation self-heal.
    console.warn(
      'Skipped order-related edge purge because blog-cache hard expiry failed',
      { merchantId }
    );
    return;
  }

  let merchantSlug = suppliedMerchantSlug?.trim() || null;
  if (!merchantSlug) {
    try {
      const { data, error } = await supabase
        .from('merchants')
        .select('slug')
        .eq('id', merchantId)
        .maybeSingle<{ slug: string | null }>();
      if (error) {
        console.warn(
          'Skipped order-related edge purge because merchant slug lookup failed',
          { merchantId, error }
        );
        return;
      }
      merchantSlug = data?.slug?.trim() || null;
    } catch (error) {
      console.warn(
        'Skipped order-related edge purge because merchant slug lookup failed',
        { merchantId, error }
      );
      return;
    }
  }
  if (!merchantSlug) {
    return;
  }

  if (blogPostSlugsIncomplete) {
    // The purge scope is unknown (failed article lookup or truncated
    // caller sweep): evict the hostname (a superset of the product purge)
    // rather than leaving affected URLs stale until TTL.
    scheduleStorefrontHostnamePurge(merchantSlug);
  } else if (blogPostSlugs.length > 0) {
    scheduleStorefrontProductPurge(merchantSlug, entries, {
      blogPostSlugs,
    });
  } else {
    // The relationship lookup can legitimately find no published article,
    // but the order still changed the product PDP/listing. Keep the core
    // purge in that case so those pages cannot remain stale until TTL.
    scheduleStorefrontProductPurge(merchantSlug, entries);
  }
}
