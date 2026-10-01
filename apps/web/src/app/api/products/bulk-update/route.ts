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
import { isValidUuid } from '@/lib/sanitize-core';
import { scheduleProductBlogPurgeAfterResponse } from '@/lib/schedule-product-blog-purge-after-response';
import { scheduleStorefrontProductPurge } from '@/lib/storefront-product-purge';
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

    // Invalidate product caches after bulk update
    revalidateProducts(merchantId);

    // Evict the Cloudflare-fronted public URLs the batch changed so the raised
    // edge TTL never serves stale listings/PDPs. Fire-and-forget: a purge is
    // always survivable (caches self-heal on their TTL), so it must never break
    // the bulk update. The shared scheduler uses a bounded hostname purge for
    // high-cardinality batches so every affected PDP is still evicted.
    try {
      // Bust every purged slug's Next product cache BEFORE the edge purge —
      // revalidateProducts(merchantId) above is slug-less and leaves the
      // per-slug scoped tags cached, so a CF MISS would refill stale.
      revalidateProductSlugs(
        merchantId,
        purgeEntries.map((entry) => entry.slug)
      );
      const requestedProductIds = parseResult.data.changes
        .map((change) => change.productId?.trim())
        .filter(
          (productId): productId is string =>
            typeof productId === 'string' && isValidUuid(productId)
        );
      const productIds = Array.from(
        new Set([...requestedProductIds, ...resolvedProductIds])
      ).filter(isValidUuid);
      // The immediate purge can refill related articles from the edge before
      // the post-response enrichment runs, so expire the merchant-scoped blog
      // data before scheduling the Cloudflare purge.
      expireProductBlogCache(merchantId);
      // Keep paginated article fallback reads out of the mutation response.
      // The after-response helper hard-expires the related-blog cache before
      // scheduling any linked article URLs.
      scheduleStorefrontProductPurge(
        merchantContext.merchantSlug,
        purgeEntries
      );
      scheduleProductBlogPurgeAfterResponse({
        supabase,
        merchantId,
        merchantSlug: merchantContext.merchantSlug,
        productIds,
        entries: purgeEntries,
        categorySlugs: purgeEntries.map((entry) => entry.categorySegment),
        skipProductPurge: true,
      });
    } catch (purgeError) {
      console.warn('Skipped Cloudflare product purge after bulk update', {
        purgeError,
      });
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
