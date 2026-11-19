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
import { mergeDependentAliasTargets } from './merge-dependent-alias-targets';
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
    slugsUnchanged,
    blogPostSlugs: callerBlogPostSlugs,
    confirmEdgeEviction,
  } = parsed.data;
  let edgePurged = false;

  const hasExplicitProductSlugs = Boolean(productSlugs?.length);
  const hasProducts = Boolean(products?.length);

  // Validate caller-supplied `merchantSlug` under anon RLS before mutating origin caches.
  const needsStorefrontPurge = Boolean(
    merchantSlug && (purgeWholeStorefront || hasProducts)
  );
  const needsPublicClient = Boolean(needsStorefrontPurge || hasProducts);
  let supabase: ReturnType<typeof createPublicClient> | undefined;
  let authoritativeMerchantSlug: string | undefined;
  let merchantSlugMismatch = false;

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
          merchantSlugMismatch = true;
        } else if (slugResult.status === 'ok') {
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

  const explicitSlugsRevalidated =
    hasExplicitProductSlugs &&
    revalidateProductSlugs(merchantId, productSlugs ?? [], {
      expireImmediately: true,
    }) === true;
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
        const hintSlugs = collectResolvedProductSlugs(products);
        revalidateProductSlugs(
          merchantId,
          hintSlugs,
          authoritativeMerchantSlug ? { expireImmediately: true } : undefined
        );
      } else {
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
        const mergedAliases = await mergeDependentAliasTargets({
          supabase: purgeClient,
          merchantId,
          products,
          entries,
          slugs: Array.from(
            new Set([...(productSlugs ?? []), ...resolvedSlugs])
          ),
        });
        const bustSlugsRevalidated =
          (authoritativeMerchantSlug
            ? revalidateProductSlugs(merchantId, mergedAliases.slugs, {
                expireImmediately: true,
              })
            : revalidateProductSlugs(merchantId, mergedAliases.slugs)) === true;
        const scopedOptions =
          callerOmitMerchantWidePdpDetails === true &&
          explicitSlugsRevalidated &&
          bustSlugsRevalidated &&
          !blogPostSlugsIncomplete &&
          !mergedAliases.incomplete &&
          hasCompleteScopedProductSlugs(
            products,
            entries,
            resolvedSlugs,
            authoritativeSlugsById,
            { allowAssumedUnchangedSlugs: slugsUnchanged === true }
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
            entries: mergedAliases.entries,
            blogPostSlugs: mergedBlogPostSlugs,
            blogPostSlugsIncomplete:
              blogPostSlugsIncomplete || mergedAliases.incomplete,
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

  if (merchantSlugMismatch) {
    return NextResponse.json(
      {
        error: 'Merchant slug does not match merchant ID',
        code: 'MERCHANT_SLUG_MISMATCH',
      },
      { status: 400 }
    );
  }

  return NextResponse.json(
    confirmEdgeEviction ? { ok: true, edgePurged } : { ok: true },
    { status: 200 }
  );
}
