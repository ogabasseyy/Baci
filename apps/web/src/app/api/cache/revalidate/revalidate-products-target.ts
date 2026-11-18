import { hasCompleteScopedProductSlugs } from '@/app/api/internal/revalidate-products/has-complete-scoped-product-slugs';
import { enrichProductPurgeEntries } from '@/lib/authoritative-product-purge-enrichment';
import {
  revalidateProductSlugs,
  revalidateProducts,
} from '@/lib/cache-revalidation';
import { expireProductBlogCache } from '@/lib/expire-product-blog-cache';
import { scheduleStorefrontProductPurge } from '@/lib/storefront-product-purge';
import { scheduleStorefrontHostnamePurge } from '@/lib/storefront-product-purge-hostnames';

type PurgeSupabaseClient = Parameters<typeof enrichProductPurgeEntries>[0];
type PurgeProductsInput = Parameters<typeof enrichProductPurgeEntries>[2];

interface RevalidateProductsTargetInput {
  supabase: PurgeSupabaseClient;
  merchantId: string;
  products?: PurgeProductsInput;
}

/**
 * Revalidates Next product caches for `POST /api/cache/revalidate` and, when
 * product hints are supplied, evicts authoritative storefront URLs after origin
 * expiry succeeds. Returns `false` when required origin expiry fails.
 */
export async function revalidateProductsTarget({
  supabase,
  merchantId,
  products,
}: RevalidateProductsTargetInput): Promise<boolean> {
  if (!products || products.length === 0) {
    return revalidateProducts(merchantId) !== false;
  }

  try {
    const {
      entries,
      resolvedSlugs,
      authoritativeSlugsById,
      blogPostSlugs,
      blogPostSlugsIncomplete,
    } = await enrichProductPurgeEntries(supabase, merchantId, products);

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

    let originHardExpired =
      revalidateProducts(merchantId, undefined, {
        expireImmediately: true,
        ...(completeScoped ? { omitMerchantWidePdpDetails: true } : {}),
      }) === true;
    if (!originHardExpired && completeScoped) {
      originHardExpired =
        revalidateProducts(merchantId, undefined, {
          expireImmediately: true,
        }) === true;
    }

    const { data: merchantRow, error: merchantLookupError } = await supabase
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

    return originHardExpired;
  } catch (purgeError) {
    const recovered =
      revalidateProducts(merchantId, undefined, {
        expireImmediately: true,
      }) !== false;
    console.error('Skipped Cloudflare product purge in cache/revalidate:', {
      merchantId,
      purgeError,
    });
    return recovered;
  }
}
