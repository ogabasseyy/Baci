import type { SupabaseClient } from '@supabase/supabase-js';
import { hasCompleteScopedProductSlugs } from '@/app/api/internal/revalidate-products/has-complete-scoped-product-slugs';
import { enrichProductPurgeEntries } from '@/lib/authoritative-product-purge-enrichment';
import {
  revalidateProductSlugs,
  revalidateProducts,
} from '@/lib/cache-revalidation';
import { getCloudflarePurgeCredentials } from '@/lib/cloudflare-purge-credentials';
import { delegateStorefrontEdgePurge } from '@/lib/delegate-storefront-edge-purge';
import { expireProductBlogCacheReliable } from '@/lib/expire-product-blog-cache-reliable';
import {
  buildInternalProductPurgeEntries,
  collectResolvedProductSlugs,
} from '@/lib/internal-product-purge-entries';
import {
  purgeStorefrontProductConfirmed,
  scheduleStorefrontProductPurge,
} from '@/lib/storefront-product-purge';
import {
  purgeStorefrontHostnameConfirmed,
  scheduleStorefrontHostnamePurge,
} from '@/lib/storefront-product-purge-hostnames';

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
  /**
   * When true, await confirmed Cloudflare edge eviction and return `false` if
   * provider confirmation fails (used by background sweep workers).
   */
  confirmEdgeEviction?: boolean;
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
  confirmEdgeEviction = false,
}: ScheduleOrderProductBlogPurgeInput): Promise<boolean> {
  const normalizedProductIds = Array.from(
    new Set(
      productIds
        .map((productId) => productId?.trim())
        .filter((productId): productId is string => Boolean(productId))
    )
  );
  if (normalizedProductIds.length === 0) {
    return true;
  }

  // Enrichment, per-slug revalidation, and blog-cache expiry need only
  // the merchant id, so they run BEFORE the slug lookup: a transient
  // `merchants` read failure must not skip the local invalidation for an
  // already-committed inventory mutation. Only the Cloudflare purge below
  // is gated on resolving the slug.
  const products = normalizedProductIds.map((id) => ({ id }));
  let entries: Awaited<ReturnType<typeof enrichProductPurgeEntries>>['entries'];
  let authoritativeSlugsById: ReadonlyMap<string, string> | undefined;
  let blogPostSlugs: string[];
  let blogPostSlugsIncomplete: boolean;
  let slugs: string[];
  let enrichmentFailed = false;
  let needsBroadPdpExpiry = false;
  try {
    const enriched = await enrichProductPurgeEntries(
      supabase,
      merchantId,
      products
    );
    entries = enriched.entries;
    authoritativeSlugsById = enriched.authoritativeSlugsById;
    blogPostSlugs = enriched.blogPostSlugs;
    blogPostSlugsIncomplete =
      enriched.blogPostSlugsIncomplete === true || targetSweepIncomplete;
    slugs = enriched.resolvedSlugs ?? entries.map((entry) => entry.slug);
  } catch (error) {
    // Enrichment only rejects when a row lookup itself threw (transport or
    // a broken client): the caller-supplied ids still name the affected
    // products, so continue with hint entries and unknown purge scope — the
    // hostname fallback below covers the unresolved article/product URLs.
    // The canonical slugs are unknown here, so the id-scoped hard-expiry at
    // the call below cannot reach the slug-tagged outer PDP entries: hard-
    // expire the broad merchant product tags (incl. `product-details`) so
    // the first post-purge request cannot refill the edge from a stale
    // snapshot that preceding callers only stale-while-revalidated.
    enrichmentFailed = true;
    console.warn(
      'Order-related product enrichment failed; continuing with caller hints',
      { merchantId, error }
    );
    entries = buildInternalProductPurgeEntries(products);
    blogPostSlugs = [];
    blogPostSlugsIncomplete = true;
    slugs = collectResolvedProductSlugs(products);
    needsBroadPdpExpiry =
      revalidateProducts(merchantId, undefined, { expireImmediately: true }) !==
      true;
  }
  if (entries.length === 0) {
    if (
      !enrichmentFailed &&
      revalidateProducts(merchantId, undefined, { expireImmediately: true }) !==
        true
    ) {
      await expireProductBlogCacheReliable(merchantId, {
        expireWidePdpDetails: true,
      });
    }
    return true;
  }

  // Hard-expire the per-slug PDP snapshots before the edge purge below:
  // stale-while-revalidate would serve the pre-mutation snapshot to the
  // first post-purge request and re-seed Cloudflare with stale stock. The
  // slugs ride along to the worker-safe expiry so standalone workers (no
  // request context) invalidate the same tags via the internal endpoint.
  const slugsRevalidated =
    revalidateProductSlugs(merchantId, slugs, { expireImmediately: true }) ===
    true;
  if (
    !enrichmentFailed &&
    (!slugsRevalidated ||
      blogPostSlugsIncomplete ||
      !hasCompleteScopedProductSlugs(
        products,
        entries,
        slugs,
        authoritativeSlugsById
      ))
  ) {
    needsBroadPdpExpiry =
      revalidateProducts(merchantId, undefined, { expireImmediately: true }) !==
      true;
  }
  const blogCacheExpired = await expireProductBlogCacheReliable(merchantId, {
    productSlugs: slugs,
    ...(needsBroadPdpExpiry ? { expireWidePdpDetails: true } : {}),
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
    return false;
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
        return false;
      }
      merchantSlug = data?.slug?.trim() || null;
    } catch (error) {
      console.warn(
        'Skipped order-related edge purge because merchant slug lookup failed',
        { merchantId, error }
      );
      return false;
    }
  }
  if (!merchantSlug) {
    return true;
  }

  if (confirmEdgeEviction) {
    const confirmed = blogPostSlugsIncomplete
      ? await purgeStorefrontHostnameConfirmed(merchantSlug)
      : blogPostSlugs.length > 0
        ? await purgeStorefrontProductConfirmed(merchantSlug, entries, {
            blogPostSlugs,
          })
        : await purgeStorefrontProductConfirmed(merchantSlug, entries);
    if (confirmed) {
      return true;
    }
    if (!getCloudflarePurgeCredentials()) {
      // Standalone VPS workers do not hold Cloudflare credentials locally;
      // delegate the storefront edge purge to the authenticated internal web
      // route, which runs with Vercel's Cloudflare configuration.
      return await delegateStorefrontEdgePurge({
        merchantId,
        merchantSlug,
        entries,
        productSlugs: slugs,
        blogPostSlugs,
        purgeWholeStorefront: blogPostSlugsIncomplete,
      });
    }
    return false;
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
  return true;
}
