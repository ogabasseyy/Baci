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
 * Throws only when `revalidateProducts` has no Next request/store context.
 */
export async function revalidateProductsInProcess({
  merchantId,
  merchantSlug,
  products,
  nextProductSlugs,
  supabase,
  purgeWholeStorefront,
}: RevalidateProductsInProcessArgs): Promise<void> {
  if (revalidateProducts(merchantId) === false) {
    throw new Error('Product cache revalidation requires a request context');
  }

  const shouldPurgeProducts = Boolean(
    merchantSlug && !purgeWholeStorefront && products && products.length > 0
  );

  if ((products && products.length > 0) || nextProductSlugs.length > 0) {
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

    if (supabase && products && products.length > 0 && !purgeWholeStorefront) {
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

    // Hard-expire per-slug caches when an edge purge follows in-process so SWR
    // cannot re-seed Cloudflare from pre-mutation snapshots.
    if ((shouldPurgeProducts || purgeWholeStorefront) && merchantSlug) {
      revalidateProductSlugs(merchantId, resolvedSlugs, {
        expireImmediately: true,
      });
    } else {
      revalidateProductSlugs(merchantId, resolvedSlugs);
    }

    if (shouldPurgeProducts && merchantSlug) {
      expireProductBlogCache(merchantId);
      if (
        blogPostSlugsIncomplete ||
        (products &&
          !hasCompleteScopedProductSlugs(
            products,
            purgeEntries,
            resolvedSlugs,
            authoritativeSlugsById
          ))
      ) {
        revalidateProducts(merchantId, undefined, { expireImmediately: true });
      }
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
    }
  }

  if (purgeWholeStorefront && merchantSlug) {
    revalidateProducts(merchantId, undefined, { expireImmediately: true });
    expireProductBlogCache(merchantId);
    scheduleStorefrontHostnamePurge(merchantSlug);
  }
}
