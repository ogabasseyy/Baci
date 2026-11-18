import { type NextRequest, NextResponse } from 'next/server';
import { getInternalApiSecret } from '@/env';
import { enrichProductPurgeEntries } from '@/lib/authoritative-product-purge-enrichment';
import {
  revalidateProductSlugs,
  revalidateProducts,
} from '@/lib/cache-revalidation';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import { expireProductBlogCache } from '@/lib/expire-product-blog-cache';
import { collectResolvedProductSlugs } from '@/lib/internal-product-purge-entries';
import { logger } from '@/lib/logger';
import { createPublicClient } from '@/lib/supabase/public';
import { internalRevalidateProductsBodySchema } from '@/schemas/internal-revalidate-products-route';
import { dispatchStorefrontHostnamePurge } from './dispatch-storefront-hostname-purge';
import { dispatchStorefrontProductPurge } from './dispatch-storefront-purge';
import { flushOriginCacheRevalidations } from './flush-origin-cache-revalidations';
import { hasCompleteScopedProductSlugs } from './has-complete-scoped-product-slugs';
import { resolveAuthoritativeMerchantSlug } from './resolve-authoritative-merchant-slug';

/**
 * Internal product-cache revalidation endpoint.
 *
 * `revalidateTag` requires a Next request/store context, which the standalone
 * import worker (`scripts/process-import-jobs.ts`) does NOT have — so its
 * in-process `revalidateProducts` is a no-op. That worker calls this Bearer-authed
 * route instead, which DOES run in a route context, to reliably invalidate the
 * product caches (incl. the proxy crawl-budget `product-slug-set-${merchantId}`)
 * after an import — so freshly imported products are never hard-404ed waiting on
 * the cacheLife TTL. See `revalidateProductsReliable`.
 *
 * Auth: `Authorization: Bearer ${INTERNAL_API_SECRET}` (timing-safe). Bearer
 * requests are CSRF-exempt and rate-limit-exempt in the proxy.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const expectedSecret = getInternalApiSecret();
  if (!expectedSecret) {
    logger.error({ message: 'INTERNAL_API_SECRET not configured' });
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('Authorization');
  if (
    !authHeader ||
    !constantTimeEqual(authHeader, `Bearer ${expectedSecret}`)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = internalRevalidateProductsBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const {
    merchantId,
    merchantSlug,
    productSlugs,
    products,
    purgeWholeStorefront,
    expireProductBlogCache: shouldExpireProductBlogCache,
    omitMerchantWidePdpDetails: callerOmitMerchantWidePdpDetails,
    blogPostSlugs: callerBlogPostSlugs,
    confirmEdgeEviction,
  } = parsed.data;
  let edgePurged = false;

  const hasExplicitProductSlugs = Boolean(productSlugs?.length);
  const hasProducts = Boolean(products?.length);

  // The internal Bearer secret authorizes this endpoint, but `merchantSlug` is
  // still only caller-supplied routing data. Validate it BEFORE mutating any
  // origin caches so a mismatched slug fails fast. The public client is
  // intentional: this route needs only `merchants.slug` and never service-role.
  const needsStorefrontPurge = Boolean(
    merchantSlug && (purgeWholeStorefront || hasProducts)
  );
  const needsPublicClient = Boolean(needsStorefrontPurge || hasProducts);
  let supabase: ReturnType<typeof createPublicClient> | undefined;
  let authoritativeMerchantSlug: string | undefined;

  if (needsPublicClient) {
    try {
      supabase = createPublicClient({
        clientInfo: 'internal-revalidate-products-purge',
      });

      if (needsStorefrontPurge && merchantSlug) {
        const slugResult = await resolveAuthoritativeMerchantSlug(
          supabase,
          merchantId,
          merchantSlug
        );
        if (slugResult.status === 'mismatch') {
          return NextResponse.json(
            {
              error: 'Merchant slug does not match merchant ID',
              code: 'MERCHANT_SLUG_MISMATCH',
            },
            { status: 400 }
          );
        }
        if (slugResult.status === 'ok') {
          authoritativeMerchantSlug = slugResult.slug;
        }
      }
    } catch (purgeClientError) {
      logger.error({
        message: 'Skipped Cloudflare storefront purge client initialization',
        error: purgeClientError,
        merchantId,
      });
    }
  }

  // Every slug chunk is hard-expired: this request cannot know whether a
  // later control-metadata chunk will schedule an edge purge, and SWR would
  // serve pre-mutation snapshots and re-seed the edge with stale stock.
  const explicitSlugsRevalidated =
    hasExplicitProductSlugs &&
    revalidateProductSlugs(merchantId, productSlugs ?? [], {
      expireImmediately: true,
    }) === true;

  // Runs in a route context, so revalidateTag works here (unlike the CLI worker).
  // Trusted internal callers (INTERNAL_API_SECRET) pass pre-validated slug chunks here.
  const isScopedSlugOnly =
    !hasProducts &&
    !purgeWholeStorefront &&
    callerOmitMerchantWidePdpDetails === true &&
    explicitSlugsRevalidated;
  if (isScopedSlugOnly) {
    expireProductBlogCache(merchantId);
    revalidateProducts(merchantId, undefined, {
      expireImmediately: true,
      omitMerchantWidePdpDetails: true,
    });
  } else if (shouldExpireProductBlogCache) {
    expireProductBlogCache(merchantId);
    if (
      callerOmitMerchantWidePdpDetails === false ||
      (callerOmitMerchantWidePdpDetails === true &&
        !hasProducts &&
        !purgeWholeStorefront)
    ) {
      revalidateProducts(merchantId, undefined, { expireImmediately: true });
    }
  } else if (!hasProducts || purgeWholeStorefront) {
    if (callerOmitMerchantWidePdpDetails === true) {
      revalidateProducts(merchantId, undefined, { expireImmediately: true });
    } else {
      revalidateProducts(merchantId);
    }
  }
  if (hasProducts && products) {
    let revalidatedDeferredProducts = false;
    try {
      if (purgeWholeStorefront) {
        // Whole-storefront purges skip article lookups and bust caller hints;
        // hard-expire when a hostname purge follows so SWR cannot re-seed CF.
        const hintSlugs = collectResolvedProductSlugs(products);
        if (authoritativeMerchantSlug) {
          revalidateProductSlugs(merchantId, hintSlugs, {
            expireImmediately: true,
          });
        } else {
          revalidateProductSlugs(merchantId, hintSlugs);
        }
      } else {
        // Resolve authoritative active product rows under anon RLS (no service role).
        const purgeClient =
          supabase ??
          createPublicClient({
            clientInfo: 'internal-revalidate-products-purge',
          });
        const {
          entries,
          resolvedSlugs,
          authoritativeSlugsById,
          blogPostSlugs,
          blogPostSlugsIncomplete,
        } = await enrichProductPurgeEntries(purgeClient, merchantId, products);
        // Hard-expire per-slug PDP tags before edge purging so SWR cannot re-seed CF.
        const bustSlugs = Array.from(
          new Set([...(productSlugs ?? []), ...resolvedSlugs])
        );
        const bustSlugsRevalidated =
          (authoritativeMerchantSlug
            ? revalidateProductSlugs(merchantId, bustSlugs, {
                expireImmediately: true,
              })
            : revalidateProductSlugs(merchantId, bustSlugs)) === true;
        const scopedOptions =
          callerOmitMerchantWidePdpDetails === true &&
          explicitSlugsRevalidated &&
          bustSlugsRevalidated &&
          !blogPostSlugsIncomplete &&
          hasCompleteScopedProductSlugs(
            products,
            entries,
            resolvedSlugs,
            authoritativeSlugsById
          )
            ? { omitMerchantWidePdpDetails: true }
            : undefined;
        if (authoritativeMerchantSlug && !purgeWholeStorefront) {
          // Related blog enrichment shares the merchant product tag. Expire it
          // before the edge purge can cause an article MISS to refill stale data.
          expireProductBlogCache(merchantId);
          revalidateProducts(merchantId, undefined, {
            expireImmediately: true,
            ...scopedOptions,
          });
          revalidatedDeferredProducts = true;
          const mergedBlogPostSlugs = Array.from(
            new Set([...(callerBlogPostSlugs ?? []), ...blogPostSlugs])
          );
          if (confirmEdgeEviction) {
            await flushOriginCacheRevalidations();
          }
          edgePurged = await dispatchStorefrontProductPurge({
            merchantSlug: authoritativeMerchantSlug,
            entries,
            blogPostSlugs: mergedBlogPostSlugs,
            blogPostSlugsIncomplete,
            confirmEdgeEviction: Boolean(confirmEdgeEviction),
          });
        } else if (!shouldExpireProductBlogCache) {
          if (scopedOptions) {
            revalidateProducts(merchantId, undefined, scopedOptions);
          } else {
            revalidateProducts(merchantId);
          }
          revalidatedDeferredProducts = true;
        }
      }
    } catch (purgeError) {
      if (
        !shouldExpireProductBlogCache &&
        !purgeWholeStorefront &&
        !revalidatedDeferredProducts
      ) {
        if (callerOmitMerchantWidePdpDetails === true) {
          revalidateProducts(merchantId, undefined, {
            expireImmediately: true,
          });
        } else {
          revalidateProducts(merchantId);
        }
      }
      logger.error({
        message: 'Skipped Cloudflare product purge in revalidate-products',
        error: purgeError,
      });
    }
  }

  // Category path changes are structural: the affected public documents cannot
  // be enumerated safely from a category mutation, so use the bounded hostname
  // purge rather than a partial URL list. The hostname comes only from the
  // merchant-id lookup above, never directly from the request body.
  if (purgeWholeStorefront && authoritativeMerchantSlug) {
    try {
      // Expire the merchant-scoped article enrichment before the hostname purge
      // can trigger a MISS and refill Cloudflare with stale product data.
      expireProductBlogCache(merchantId);
      revalidateProducts(merchantId, undefined, { expireImmediately: true });
      if (confirmEdgeEviction) {
        await flushOriginCacheRevalidations();
      }
      edgePurged = await dispatchStorefrontHostnamePurge(
        authoritativeMerchantSlug,
        Boolean(confirmEdgeEviction)
      );
    } catch (purgeError) {
      logger.error({
        message: 'Skipped Cloudflare hostname purge in revalidate-products',
        error: purgeError,
      });
    }
  }

  return NextResponse.json(
    confirmEdgeEviction ? { ok: true, edgePurged } : { ok: true },
    { status: 200 }
  );
}
