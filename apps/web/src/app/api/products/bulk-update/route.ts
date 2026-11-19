import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-auth';
import {
  revalidateProductSlugs,
  revalidateProducts,
} from '@/lib/cache-revalidation';
import { checkCsrfProtection } from '@/lib/csrf';
import { getCurrencyConfig } from '@/lib/currency';
import { expireProductBlogCache } from '@/lib/expire-product-blog-cache';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { resolveDependentLegacyProductIdentifiers } from '@/lib/resolve-dependent-legacy-product-identifiers';
import { isValidUuid } from '@/lib/sanitize-core';
import { scheduleProductBlogPurgeAfterResponse } from '@/lib/schedule-product-blog-purge-after-response';
import { scheduleStorefrontProductPurge } from '@/lib/storefront-product-purge';
import { scheduleStorefrontHostnamePurge } from '@/lib/storefront-product-purge-hostnames';
import type { StorefrontProductPurgeEntry } from '@/lib/storefront-product-purge-urls';
import { createClient } from '@/lib/supabase/server';
import { BulkUpdateChangesSchema } from '@/schemas/dashboard-product-import-actions';
import { processBulkUpdateChanges } from './bulk-update-change-processing';

export async function POST(request: NextRequest) {
  const { valid, response } = await checkCsrfProtection(request);
  if (!valid && response) return response;

  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'products', 'edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const merchantId = merchantContext.merchantId;

    // Fetch business_name and currency fields for product creation
    const { data: merchantDetails, error: merchantError } = await supabase
      .from('merchants')
      .select('business_name, country, payout_currency')
      .eq('id', merchantId)
      .maybeSingle();

    if (merchantError) {
      return NextResponse.json(
        { error: 'Failed to fetch merchant details' },
        { status: 500 }
      );
    }

    const merchantBusinessName =
      merchantDetails?.business_name ?? merchantContext.businessName ?? '';
    const merchantCountry = merchantDetails?.country ?? null;
    const merchantPayoutCurrency = merchantDetails?.payout_currency ?? null;
    const currency = getCurrencyConfig(
      merchantCountry,
      merchantPayoutCurrency
    ).code;

    const body = await request.json();

    const parseResult = BulkUpdateChangesSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid changes data',
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    // Product purge targets accumulated across the whole batch so the raised
    // storefront edge TTL never serves a stale listing/PDP after a bulk edit.
    const purgeEntries: StorefrontProductPurgeEntry[] = [];
    const resolvedProductIds: string[] = [];
    const results = await processBulkUpdateChanges({
      changes: parseResult.data.changes,
      currency,
      merchantBusinessName,
      merchantId,
      onPurgeEntries: (entries) => {
        for (const entry of entries) {
          purgeEntries.push(entry);
        }
      },
      onResolvedProductIds: (productIds) => {
        resolvedProductIds.push(...productIds);
      },
      supabase,
    });

    // Evict the Cloudflare-fronted public URLs the batch changed so the raised
    // edge TTL never serves stale listings/PDPs. Fire-and-forget: a purge is
    // always survivable (caches self-heal on their TTL), so it must never break
    // the bulk update. The shared scheduler uses a bounded hostname purge for
    // high-cardinality batches so every affected PDP is still evicted.
    if (purgeEntries.length > 0 || resolvedProductIds.length > 0) {
      try {
        const requestedProductIds = parseResult.data.changes
          .map((change) => change.productId?.trim())
          .filter(
            (productId): productId is string =>
              typeof productId === 'string' && isValidUuid(productId)
          );
        const allProductIds = Array.from(
          new Set([...requestedProductIds, ...resolvedProductIds])
        );
        const productIds = allProductIds.filter(isValidUuid);
        const resolvedIdSet = new Set(resolvedProductIds);
        const productIdSet = new Set(allProductIds);
        const nonIdPurgeSlugs = new Set(
          purgeEntries
            .map((entry) => entry.slug.trim())
            .filter((slug) => Boolean(slug) && !productIdSet.has(slug))
        );
        const hasCompleteScopedCoverage =
          purgeEntries.length > 0 &&
          productIds.length > 0 &&
          nonIdPurgeSlugs.size >= allProductIds.length &&
          requestedProductIds.every((id) => resolvedIdSet.has(id));
        const dependentAliases = await resolveDependentLegacyProductIdentifiers(
          supabase,
          merchantId,
          productIds
        );
        const slugIdentifiers = Array.from(
          new Set([
            ...purgeEntries.map((entry) => entry.slug),
            ...productIds,
            ...dependentAliases.identifiers,
          ])
        );
        // Bust every purged slug, product UUID, and dependent child cache
        // BEFORE the edge purge so a CF MISS cannot refill from stale entries.
        const slugsExpired =
          slugIdentifiers.length > 0 &&
          revalidateProductSlugs(merchantId, slugIdentifiers, {
            expireImmediately: true,
          }) === true;
        const originHardExpired =
          (slugsExpired &&
            hasCompleteScopedCoverage &&
            !dependentAliases.incomplete &&
            revalidateProducts(merchantId, undefined, {
              expireImmediately: true,
              omitMerchantWidePdpDetails: true,
            }) === true) ||
          revalidateProducts(merchantId, undefined, {
            expireImmediately: true,
          }) === true;
        // The immediate purge can refill related articles from the edge before
        // the post-response enrichment runs, so expire the merchant-scoped blog
        // data before scheduling the Cloudflare purge.
        expireProductBlogCache(merchantId);
        // Keep paginated article fallback reads out of the mutation response.
        // The after-response helper hard-expires the related-blog cache before
        // scheduling any linked article URLs.
        if (!originHardExpired) {
          console.warn(
            'Skipped Cloudflare product purge after bulk update because origin hard expiry failed',
            { merchantId }
          );
        } else if (dependentAliases.incomplete) {
          scheduleStorefrontHostnamePurge(merchantContext.merchantSlug);
        } else {
          const seenEdgeSlugs = new Set(
            purgeEntries
              .map((entry) => entry.slug.trim().toLowerCase())
              .filter(Boolean)
          );
          const aliasEdgeEntries: StorefrontProductPurgeEntry[] = [
            ...productIds,
            ...dependentAliases.identifiers,
          ]
            .map((identifier) => identifier.trim())
            .filter((identifier) => {
              const key = identifier.toLowerCase();
              if (!key || seenEdgeSlugs.has(key)) return false;
              seenEdgeSlugs.add(key);
              return true;
            })
            .map((identifier) => ({ slug: identifier, categorySegment: null }));
          const edgeEntries = [...purgeEntries, ...aliasEdgeEntries];
          scheduleStorefrontProductPurge(
            merchantContext.merchantSlug,
            edgeEntries
          );
          scheduleProductBlogPurgeAfterResponse({
            supabase,
            merchantId,
            merchantSlug: merchantContext.merchantSlug,
            productIds,
            entries: edgeEntries,
            categorySlugs: purgeEntries.map((entry) => entry.categorySegment),
            skipProductPurge: true,
          });
        }
      } catch (purgeError) {
        revalidateProducts(merchantId, undefined, { expireImmediately: true });
        console.warn('Skipped Cloudflare product purge after bulk update', {
          purgeError,
        });
      }
    } else {
      revalidateProducts(merchantId);
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('Bulk update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
