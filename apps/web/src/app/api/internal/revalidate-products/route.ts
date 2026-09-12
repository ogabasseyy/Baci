import { type NextRequest, NextResponse } from 'next/server';
import { getInternalApiSecret } from '@/env';
import { enrichProductPurgeEntries } from '@/lib/authoritative-product-purge-enrichment';
import {
  revalidateProductSlugs,
  revalidateProducts,
} from '@/lib/cache-revalidation';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import { expireProductBlogCache } from '@/lib/expire-product-blog-cache';
import { logger } from '@/lib/logger';
import { scheduleStorefrontProductPurge } from '@/lib/storefront-product-purge';
import { scheduleStorefrontHostnamePurge } from '@/lib/storefront-product-purge-hostnames';
import { createPublicClient } from '@/lib/supabase/public';
import { internalRevalidateProductsBodySchema } from '@/schemas/internal-revalidate-products-route';

function normalizeMerchantSlug(value: string): string {
  return value.trim().toLowerCase();
}

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
  } = parsed.data;

  // Runs in a route context, so revalidateTag works here (unlike the CLI worker).
  if (shouldExpireProductBlogCache) {
    // Standalone workers use this narrow mode to refresh the related-product
    // enrichment without churning every product/index/feed cache for the
    // merchant. The helper is intentionally called in this request context.
    expireProductBlogCache(merchantId);
  } else {
    revalidateProducts(merchantId);
  }

  // The internal Bearer secret authorizes this endpoint, but `merchantSlug` is
  // still only caller-supplied routing data. Resolve the canonical slug from
  // the validated merchant id before it can reach either Cloudflare purge
  // scheduler. The public client is intentional: this server-only route needs
  // only the public `merchants.slug` projection and must not expand to a
  // service-role client.
  const needsStorefrontPurge = Boolean(
    merchantSlug && (purgeWholeStorefront || (products && products.length > 0))
  );
  const needsPublicClient = Boolean(
    needsStorefrontPurge || (products && products.length > 0)
  );
  let supabase: ReturnType<typeof createPublicClient> | undefined;
  let authoritativeMerchantSlug: string | undefined;

  if (needsPublicClient) {
    try {
      supabase = createPublicClient({
        clientInfo: 'internal-revalidate-products-purge',
      });

      if (needsStorefrontPurge && merchantSlug) {
        const { data: merchantRow, error: merchantLookupError } = await supabase
          .from('merchants')
          .select('slug')
          .eq('id', merchantId)
          .maybeSingle<{ slug: string | null }>();

        if (merchantLookupError) {
          logger.error({
            message:
              'Skipped Cloudflare storefront purge after merchant slug lookup failed',
            error: merchantLookupError,
            merchantId,
          });
        } else {
          const resolvedSlug = merchantRow?.slug?.trim();
          if (!resolvedSlug) {
            logger.error({
              message:
                'Skipped Cloudflare storefront purge because the merchant has no slug',
              merchantId,
            });
          } else if (
            normalizeMerchantSlug(resolvedSlug) !==
            normalizeMerchantSlug(merchantSlug)
          ) {
            logger.warn({
              message:
                'Rejected internal storefront purge with a mismatched merchant slug',
              merchantId,
            });
            return NextResponse.json(
              {
                error: 'Merchant slug does not match merchant ID',
                code: 'MERCHANT_SLUG_MISMATCH',
              },
              { status: 400 }
            );
          } else {
            authoritativeMerchantSlug = resolvedSlug;
          }
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

  // When the caller supplies product entries, resolve them against the DB and
  // bust their per-slug Next caches. The per-slug bust needs only merchantId,
  // so it remains independent of the merchant-slug-gated Cloudflare purge.
  if (productSlugs && productSlugs.length > 0) {
    revalidateProductSlugs(merchantId, productSlugs);
  }
  if (products && products.length > 0) {
    try {
      // Enrich from the product ROWS with the SAME resolution `/api/cache/revalidate`
      // performs, so an {id}-only import/save entry purges the real slug/category
      // URLs (not `/products/<uuid>`). Public client: this route intentionally
      // uses no service-role credentials, and the anon policy exposes only
      // ACTIVE rows, which is sufficient — draft/
      // pending PDPs are never publicly cached, so an unresolved row simply
      // falls back to the caller's hints + the always-purged fallback URLs.
      // Fail-open lives inside the enrichment.
      const purgeClient =
        supabase ??
        createPublicClient({
          clientInfo: 'internal-revalidate-products-purge',
        });
      const { entries, resolvedSlugs, blogPostSlugs } =
        await enrichProductPurgeEntries(purgeClient, merchantId, products);
      // Bust the per-slug Next product-detail caches for every resolved slug
      // BEFORE scheduling the edge purge: the PDP snapshot is tagged per-slug
      // and is NOT invalidated by the slug-less revalidateProducts above, so a
      // Cloudflare MISS would otherwise refill from stale Next data until TTL.
      revalidateProductSlugs(
        merchantId,
        Array.from(new Set([...(productSlugs ?? []), ...resolvedSlugs]))
      );
      if (authoritativeMerchantSlug && !purgeWholeStorefront) {
        // Related blog enrichment shares the merchant product tag. Expire it
        // before the edge purge can cause an article MISS to refill stale data.
        expireProductBlogCache(merchantId);
        if (blogPostSlugs.length > 0) {
          scheduleStorefrontProductPurge(authoritativeMerchantSlug, entries, {
            blogPostSlugs,
          });
        } else {
          scheduleStorefrontProductPurge(authoritativeMerchantSlug, entries);
        }
      }
    } catch (purgeError) {
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
    // Expire the merchant-scoped article enrichment before the hostname purge
    // can trigger a MISS and refill Cloudflare with stale product data.
    expireProductBlogCache(merchantId);
    scheduleStorefrontHostnamePurge(authoritativeMerchantSlug);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
