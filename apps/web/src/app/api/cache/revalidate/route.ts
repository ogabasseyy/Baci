import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hasCompleteScopedProductSlugs } from '@/app/api/internal/revalidate-products/has-complete-scoped-product-slugs';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
  type UserAccess,
} from '@/lib/api-auth';
import { enrichProductPurgeEntries } from '@/lib/authoritative-product-purge-enrichment';
import { BLOG_LISTING_PAGE_SIZE } from '@/lib/blog-listing-page-size';
import {
  revalidateBlogPosts,
  revalidateCategories,
  revalidateFeatures,
  revalidateMerchant,
  revalidatePageConfig,
  revalidateProductSlugs,
  revalidateProducts,
  revalidateReviews,
} from '@/lib/cache-revalidation';
import { checkCsrfProtection } from '@/lib/csrf';
import { expireProductBlogCache } from '@/lib/expire-product-blog-cache';
import { getMerchantBlogRevalidationContext } from '@/lib/get-merchant-blog-cache-identifiers';
import { getMerchantBlogPostCategories } from '@/lib/get-merchant-blog-post-categories';
import { getMerchantBlogPostSlugs } from '@/lib/get-merchant-blog-post-slugs';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { scheduleStorefrontProductPurge } from '@/lib/storefront-product-purge';
import { scheduleStorefrontHostnamePurge } from '@/lib/storefront-product-purge-hostnames';
import { cacheRevalidateRequestSchema } from '@/schemas/cache-revalidate-route';

/**
 * Cache Revalidation API
 *
 * POST /api/cache/revalidate
 * Allows authenticated merchants to manually purge cached data for their store.
 * Useful after bulk imports, external data changes, or debugging stale data.
 */

export async function POST(request: NextRequest) {
  const { valid, response } = await checkCsrfProtection(request);
  if (!valid && response) return response;

  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }

  const access = await getUserAccess(auth.supabase);
  if (!access) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }

  const body = await request.json();
  const result = cacheRevalidateRequestSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      {
        error: 'Invalid input',
        code: 'INVALID_INPUT',
        details: z.flattenError(result.error),
      },
      { status: 400 }
    );
  }

  const { targets, products, merchantId: requestedMerchantId } = result.data;

  // Resolve the merchant this request acts on. `get_user_access` returns the
  // caller's DEFAULT merchant — for a user who owns/staffs MULTIPLE merchants
  // that may NOT be the merchant whose product the mobile app just saved. When
  // the client names a specific merchant, re-resolve access SCOPED to that
  // merchant (owner or active-staff membership, with that merchant's own
  // permissions) so BOTH the permission gate below and the server-side slug
  // lookup run against the RIGHT merchant. NEVER trust the client id without
  // this verification: a foreign/unknown id resolves to no membership and is a
  // hard 403 — we do not silently fall back to the default merchant.
  let effectiveAccess: UserAccess = access;
  if (requestedMerchantId && requestedMerchantId !== access.merchantId) {
    const scopedContext = await getMerchantForApiRequest(
      auth.supabase,
      auth.user.id,
      { requestedMerchantId }
    );
    if (!scopedContext) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    effectiveAccess = toUserAccess(scopedContext);
  }

  // Permission gate. Purging shared caches is normally a `settings:edit`
  // (owner/admin) action, but the mobile-admin save/quick-action paths run as
  // staff who may only hold `products:edit` — and after a product write they
  // post a PRODUCTS-ONLY revalidate here to evict the storefront edge cache.
  // Allow `products:edit` (or `settings:edit`) for a products-only request, but
  // keep every other leg (categories/merchant/blog/reviews/features/pages, and
  // the catch-all `all`) locked to `settings:edit` so nothing else is loosened.
  const canManageSettings = hasPermission(effectiveAccess, 'settings', 'edit');
  const isProductsOnlyRequest = targets.every(
    (target) => target === 'products'
  );
  // `products:create`-only staff (mobile create flow) must also be able to
  // evict the storefront edge cache for the product they just created.
  const isAuthorized = isProductsOnlyRequest
    ? canManageSettings ||
      hasPermission(effectiveAccess, 'products', 'edit') ||
      hasPermission(effectiveAccess, 'products', 'create')
    : canManageSettings;
  if (!isAuthorized) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  const merchantId = effectiveAccess.merchantId;
  const failedTargets: string[] = [];
  const revalidated: string[] = [];

  const shouldRevalidate = (target: string) =>
    targets.includes('all') || targets.includes(target as (typeof targets)[0]);

  if (shouldRevalidate('products')) {
    revalidated.push('products');

    // Evict affected products' public URLs from Cloudflare when supplied.
    // Merchant slug is resolved server-side (never trusted from the client).
    // Fire-and-forget: a purge failure never fails the revalidation.
    if (products && products.length > 0) {
      try {
        // Resolve authoritative purge entries and per-slug tags before
        // scheduling the Cloudflare purge.
        const {
          entries,
          resolvedSlugs,
          authoritativeSlugsById,
          blogPostSlugs,
          blogPostSlugsIncomplete,
        } = await enrichProductPurgeEntries(
          auth.supabase,
          merchantId,
          products
        );
        // Hard-expire per-slug PDP tags and merchant blog enrichment before
        // any Cloudflare MISS can refill from stale Next snapshots.
        const slugsRevalidated =
          revalidateProductSlugs(merchantId, resolvedSlugs, {
            expireImmediately: true,
          }) === true;
        expireProductBlogCache(merchantId);
        const completeScoped =
          slugsRevalidated &&
          !blogPostSlugsIncomplete &&
          hasCompleteScopedProductSlugs(
            products,
            entries,
            resolvedSlugs,
            authoritativeSlugsById
          );
        const originHardExpired =
          revalidateProducts(merchantId, undefined, {
            expireImmediately: true,
            ...(completeScoped ? { omitMerchantWidePdpDetails: true } : {}),
          }) === true;

        // Resolve the merchant's public slug solely for Cloudflare routing.
        const { data: merchantRow, error: merchantLookupError } =
          await auth.supabase
            .from('merchants')
            .select('slug')
            .eq('id', merchantId)
            .maybeSingle();
        if (merchantLookupError) {
          console.error(
            'Failed to resolve merchant slug for Cloudflare product purge (continuing with available data):',
            { merchantId, error: merchantLookupError }
          );
        }
        const merchantSlug = merchantRow?.slug ?? null;
        if (merchantSlug && originHardExpired) {
          if (blogPostSlugsIncomplete) {
            scheduleStorefrontHostnamePurge(merchantSlug);
          } else if (blogPostSlugs.length > 0) {
            scheduleStorefrontProductPurge(merchantSlug, entries, {
              blogPostSlugs,
            });
          } else {
            scheduleStorefrontProductPurge(merchantSlug, entries);
          }
        }
      } catch (purgeError) {
        revalidateProducts(merchantId, undefined, { expireImmediately: true });
        console.error('Skipped Cloudflare product purge in cache/revalidate:', {
          merchantId,
          purgeError,
        });
      }
    } else {
      revalidateProducts(merchantId);
    }
  }

  if (shouldRevalidate('categories')) {
    revalidateCategories(merchantId);
    revalidated.push('categories');
  }

  if (shouldRevalidate('merchant')) {
    revalidateMerchant(merchantId);
    revalidated.push('merchant');
  }

  if (shouldRevalidate('blog')) {
    try {
      const [blogRevalidation, postSlugs, listingCategories] =
        await Promise.all([
          getMerchantBlogRevalidationContext(auth.supabase, merchantId),
          getMerchantBlogPostSlugs(auth.supabase, merchantId),
          getMerchantBlogPostCategories(auth.supabase, merchantId),
        ]);
      const listingPages = Array.from(
        {
          length: Math.max(
            1,
            Math.ceil(postSlugs.length / BLOG_LISTING_PAGE_SIZE)
          ),
        },
        (_, index) => index + 1
      );

      revalidateBlogPosts({
        merchantId,
        identifiers: blogRevalidation.identifiers,
        canonicalMerchantSlug: blogRevalidation.canonicalMerchantSlug,
        listingCategories,
        listingPages,
        postSlugs,
      });
      revalidated.push('blog');
    } catch (error) {
      console.error('Failed to revalidate blog caches:', {
        merchantId,
        error,
      });
      failedTargets.push('blog');
    }
  }

  if (shouldRevalidate('reviews')) {
    revalidateReviews(merchantId);
    revalidated.push('reviews');
  }

  if (shouldRevalidate('features')) {
    revalidateFeatures(merchantId);
    revalidated.push('features');
  }

  if (shouldRevalidate('pages')) {
    revalidatePageConfig(merchantId);
    revalidated.push('pages');
  }

  const success = failedTargets.length === 0;

  if (!success) {
    return NextResponse.json(
      {
        error: `Cache purge failed for: ${failedTargets.join(', ')}`,
        failedTargets,
        revalidated,
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      revalidated,
      failedTargets: [],
      message: `Cache purged for: ${revalidated.join(', ')}`,
    },
    { status: 200 }
  );
}
