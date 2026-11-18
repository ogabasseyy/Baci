import type { SupabaseClient } from '@supabase/supabase-js';
import { hasCompleteScopedProductSlugs } from '@/app/api/internal/revalidate-products/has-complete-scoped-product-slugs';
import { enrichProductPurgeEntries } from '@/lib/authoritative-product-purge-enrichment';
import {
  revalidateProductSlugs,
  revalidateProducts,
} from '@/lib/cache-revalidation';
import { expireProductBlogCache } from '@/lib/expire-product-blog-cache';
import {
  buildInternalProductPurgeEntries,
  collectResolvedProductSlugs,
} from '@/lib/internal-product-purge-entries';
import { scheduleStorefrontProductPurge } from '@/lib/storefront-product-purge';
import { scheduleStorefrontHostnamePurge } from '@/lib/storefront-product-purge-hostnames';
import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';

interface RevalidateProductsInProcessArgs {
  merchantId: string;
  merchantSlug?: string;
  products?: readonly InternalRevalidateProductEntry[];
  nextProductSlugs: readonly string[];
  supabase?: SupabaseClient;
  purgeWholeStorefront?: boolean;
}

/**
 * Execute Next cache revalidation and Cloudflare purge scheduling in-process.
 * Throws when local Next tag revalidation or hard-expiry fails so the reliable
 * caller falls back to the authenticated internal endpoint before edge purging.
 */
export async function revalidateProductsInProcess({
  merchantId,
  merchantSlug,
  products,
  nextProductSlugs,
  supabase,
  purgeWholeStorefront,
}: RevalidateProductsInProcessArgs): Promise<void> {
  const hasProducts = Boolean(products && products.length > 0);
  const shouldPurgeProducts = Boolean(
    merchantSlug && !purgeWholeStorefront && hasProducts
  );

  if (!hasProducts && nextProductSlugs.length === 0) {
    if (purgeWholeStorefront && merchantSlug) {
      if (
        revalidateProducts(merchantId, undefined, {
          expireImmediately: true,
        }) === false
      ) {
        throw new Error('Merchant-wide product hard expiry failed');
      }
      expireProductBlogCache(merchantId);
      scheduleStorefrontHostnamePurge(merchantSlug);
      return;
    }
    if (revalidateProducts(merchantId) === false) {
      throw new Error('Product cache revalidation requires a request context');
    }
    return;
  }

  let resolvedSlugs =
    nextProductSlugs.length > 0
      ? [...nextProductSlugs]
      : products
        ? collectResolvedProductSlugs(products)
        : [];
  let purgeEntries = buildInternalProductPurgeEntries(products ?? []);
  let authoritativeSlugsById: ReadonlyMap<string, string> | undefined;
  let blogPostSlugs: string[] = [];
  let blogPostSlugsIncomplete = false;

  if (supabase && products && hasProducts && !purgeWholeStorefront) {
    try {
      const enriched = await enrichProductPurgeEntries(
        supabase,
        merchantId,
        products
      );
      resolvedSlugs = Array.from(
        new Set([...resolvedSlugs, ...enriched.resolvedSlugs])
      );
      purgeEntries = enriched.entries;
      authoritativeSlugsById = enriched.authoritativeSlugsById;
      blogPostSlugs = enriched.blogPostSlugs;
      blogPostSlugsIncomplete = enriched.blogPostSlugsIncomplete;
    } catch (error) {
      blogPostSlugsIncomplete = true;
      console.warn(
        'Failed to enrich in-process product purge (continuing with caller hints)',
        { merchantId, error }
      );
    }
  }

  if (purgeWholeStorefront && merchantSlug) {
    if (
      revalidateProducts(merchantId, undefined, { expireImmediately: true }) ===
      false
    ) {
      throw new Error('Merchant-wide product hard expiry failed');
    }
    revalidateProductSlugs(merchantId, resolvedSlugs, {
      expireImmediately: true,
    });
    expireProductBlogCache(merchantId);
    scheduleStorefrontHostnamePurge(merchantSlug);
    return;
  }

  if (shouldPurgeProducts && merchantSlug) {
    // Hard-expire per-slug caches before edge purging so SWR cannot re-seed CF.
    const slugsRevalidated =
      revalidateProductSlugs(merchantId, resolvedSlugs, {
        expireImmediately: true,
      }) === true;
    const scopedComplete =
      slugsRevalidated &&
      !blogPostSlugsIncomplete &&
      Boolean(
        products &&
          hasCompleteScopedProductSlugs(
            products,
            purgeEntries,
            resolvedSlugs,
            authoritativeSlugsById
          )
      );
    if (scopedComplete) {
      if (
        revalidateProducts(merchantId, undefined, {
          omitMerchantWidePdpDetails: true,
        }) === false
      ) {
        throw new Error(
          'Product cache revalidation requires a request context'
        );
      }
    } else if (
      revalidateProducts(merchantId, undefined, { expireImmediately: true }) ===
      false
    ) {
      throw new Error('Merchant-wide product hard expiry failed');
    }

    expireProductBlogCache(merchantId);
    if (blogPostSlugs.length > 0) {
      scheduleStorefrontProductPurge(merchantSlug, purgeEntries, {
        blogPostSlugs,
      });
    } else {
      scheduleStorefrontProductPurge(merchantSlug, purgeEntries);
    }
    if (blogPostSlugsIncomplete) {
      scheduleStorefrontHostnamePurge(merchantSlug);
    }
    return;
  }

  if (revalidateProducts(merchantId) === false) {
    throw new Error('Product cache revalidation requires a request context');
  }
  revalidateProductSlugs(merchantId, resolvedSlugs);
}
