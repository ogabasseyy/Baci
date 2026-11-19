import { type NextRequest, NextResponse } from 'next/server';
import { getInternalApiSecret } from '@/env';
import { enrichProductPurgeEntries } from '@/lib/authoritative-product-purge-enrichment';
import {
  revalidateProductSlugs,
  revalidateProducts,
} from '@/lib/cache-revalidation';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import { collectResolvedProductSlugs } from '@/lib/internal-product-purge-entries';
import { logger } from '@/lib/logger';
import { createPublicClient } from '@/lib/supabase/public';
import { internalRevalidateProductsBodySchema } from '@/schemas/internal-revalidate-products-route';
import { dispatchStorefrontHostnamePurge } from './dispatch-storefront-hostname-purge';
import { dispatchStorefrontProductPurge } from './dispatch-storefront-purge';
import { flushOriginCacheRevalidations } from './flush-origin-cache-revalidations';
import { hardExpireOriginCaches } from './hard-expire-origin-caches';
import { hasCompleteScopedProductSlugs } from './has-complete-scoped-product-slugs';
import { resolveAuthoritativeMerchantSlug } from './resolve-authoritative-merchant-slug';
import { revalidateWithoutProducts } from './revalidate-without-products';

/**
 * Internal product-cache revalidation endpoint (`Authorization: Bearer
 * ${INTERNAL_API_SECRET}`). Runs in a Next route context so `revalidateTag`
 * works for standalone workers (whose in-process `revalidateTag` is a no-op).
 */
const failedExpiryResponse = (): NextResponse =>
  NextResponse.json(
    { error: 'Failed to expire merchant-wide product caches' },
    { status: 500 }
  );

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

  // Hard-expire every slug chunk immediately so SWR cannot re-seed the edge.
  const explicitSlugsRevalidated =
    hasExplicitProductSlugs &&
    revalidateProductSlugs(merchantId, productSlugs ?? [], {
      expireImmediately: true,
    }) === true;

  // Trusted internal callers (INTERNAL_API_SECRET) pass pre-validated slug chunks here.
  if (
    !revalidateWithoutProducts({
      merchantId,
      hasProducts,
      purgeWholeStorefront,
      hasExplicitProductSlugs,
      explicitSlugsRevalidated,
      callerOmitMerchantWidePdpDetails,
      shouldExpireProductBlogCache,
    })
  ) {
    return failedExpiryResponse();
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
          if (
            !hardExpireOriginCaches({
              merchantId,
              scopedOptions,
              edgePurgeTarget: 'product',
            })
          ) {
            return failedExpiryResponse();
          }
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
        } else if (
          !shouldExpireProductBlogCache ||
          callerOmitMerchantWidePdpDetails === true
        ) {
          const opts = shouldExpireProductBlogCache
            ? { ...scopedOptions, expireImmediately: true }
            : scopedOptions;
          const ok =
            (opts
              ? revalidateProducts(merchantId, undefined, opts)
              : revalidateProducts(merchantId)) !== false ||
            (Boolean(scopedOptions) &&
              revalidateProducts(merchantId, undefined, {
                expireImmediately: true,
              }) !== false);
          if (!ok) return failedExpiryResponse();
          revalidatedDeferredProducts = true;
        }
      }
    } catch (purgeError) {
      if (
        !purgeWholeStorefront &&
        !revalidatedDeferredProducts &&
        (!shouldExpireProductBlogCache ||
          callerOmitMerchantWidePdpDetails === true) &&
        revalidateProducts(merchantId, undefined, {
          expireImmediately: true,
        }) === false
      ) {
        logger.error({
          message:
            'Failed to expire merchant-wide product caches after purge error',
          error: purgeError,
        });
        return failedExpiryResponse();
      }
      logger.error({
        message: 'Skipped Cloudflare product purge in revalidate-products',
        error: purgeError,
      });
    }
  }

  // Structural purges evict the authoritative merchant hostname via bounded purge.
  if (purgeWholeStorefront && authoritativeMerchantSlug) {
    try {
      if (
        !hardExpireOriginCaches({
          merchantId,
          edgePurgeTarget: 'hostname',
        })
      ) {
        return failedExpiryResponse();
      }
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
