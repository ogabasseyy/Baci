import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { parseRequestedMerchantId } from '@/app/api/branches/branch-route-utils';
import {
  buildAdsAnalyticsCacheKey,
  getAdsAnalyticsCacheVersion,
} from '@/lib/ads/analytics-cache';
import { fetchAnalyticsPlatformConfig } from '@/lib/analytics/analytics-platform-config';
import { fetchAdReportingSnapshots } from '@/lib/analytics/fetch-ad-reporting-snapshots';
import { hasPermission } from '@/lib/api-auth';
import { cache } from '@/lib/cache';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { adsAnalyticsQuerySchema } from '@/schemas/ads-analytics-query';
import { calculatePlatformStats } from './calculate-platform-stats';
import { fetchPaidOrdersForAnalytics } from './fetch-paid-orders';

/**
 * Ad Conversion Analytics API
 *
 * GET /api/analytics/ads?startDate=ISO&endDate=ISO
 *
 * Returns metrics about CAPI/offline conversion tracking:
 * - Total conversions tracked
 * - Revenue attributed to each platform (Facebook, TikTok, GA4, Snapchat)
 * - Click attribution (orders with fbclid, ttclid, gclid, sccid)
 * - Platform configuration status
 */

function getUtcCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getDefaultCalendarDateRange(now: Date): {
  endDate: string;
  startDate: string;
} {
  const endDate = getUtcCalendarDate(now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 29);
  return { endDate, startDate: getUtcCalendarDate(start) };
}

// react-doctor-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler -- Process-local analytics cache write only; no user or database state is mutated by GET.
export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsedQuery = adsAnalyticsQuerySchema.safeParse({
      cacheBust: searchParams.get('cacheBust') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      orderEnd: searchParams.get('orderEnd') || undefined,
      orderStart: searchParams.get('orderStart') || undefined,
      startDate: searchParams.get('startDate') || undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        { code: 'INVALID_QUERY', error: 'Invalid query parameters' },
        { status: 400 }
      );
    }

    // Provider spend_date is an account-local calendar date. Order attribution
    // uses the exact dashboard instants when supplied, with a date-only
    // fallback for callers that do not yet send those boundaries.
    const defaultRange = getDefaultCalendarDateRange(new Date());
    const startDate = parsedQuery.data.startDate ?? defaultRange.startDate;
    const endDate = parsedQuery.data.endDate ?? defaultRange.endDate;
    const orderStart =
      parsedQuery.data.orderStart ?? `${startDate}T00:00:00.000Z`;
    const orderEnd = parsedQuery.data.orderEnd ?? `${endDate}T23:59:59.999Z`;

    const requestedMerchant = parseRequestedMerchantId(request);
    if (requestedMerchant.response) {
      return requestedMerchant.response;
    }

    // Resolve merchant context (supports both owners and staff members)
    const merchantContext = await getMerchantForApiRequest(supabase, user.id, {
      requestedMerchantId: requestedMerchant.merchantId,
    });
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'analytics', 'view')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const merchantId = merchantContext.merchantId;

    // Fetch merchant analytics config, preferring dashboard feature settings.
    const merchant = await fetchAnalyticsPlatformConfig(supabase, merchantId);

    if (!merchant) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    // The in-memory cache is process-local. Include the durable connection
    // revision so a warm Vercel instance cannot read a snapshot written before
    // another instance completed an account, sync, callback, or disconnect
    // mutation. If the marker read is unavailable, skip caching for safety.
    const cacheVersion = await getAdsAnalyticsCacheVersion(
      supabase,
      merchantId
    );
    const cacheKey =
      cacheVersion === undefined
        ? undefined
        : buildAdsAnalyticsCacheKey({
            endDate,
            merchantId,
            orderEnd,
            orderStart,
            startDate,
            version: cacheVersion,
          });

    // Try cached data (5 minute TTL)
    const shouldBypassCache = parsedQuery.data.cacheBust !== undefined;
    const cachedData =
      shouldBypassCache || !cacheKey
        ? undefined
        : cache.get<Record<string, unknown>>(cacheKey);
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    // Fetch paid orders with ad tracking data
    const { data: orders, error: ordersError } =
      await fetchPaidOrdersForAnalytics(
        supabase,
        merchantId,
        orderStart,
        orderEnd
      );

    if (ordersError) {
      console.error('Error fetching orders:', ordersError);
      return NextResponse.json(
        { error: 'Failed to fetch orders' },
        { status: 500 }
      );
    }

    // Spend snapshots are optional: an unconnected merchant or a not-yet-run
    // sync must not erase the conversion analytics response. Keep the provider
    // credentials out of this projection and expose only reporting metadata.
    const { googleAds, socialAds } = await fetchAdReportingSnapshots({
      endDate,
      merchantId,
      startDate,
      supabase,
    });

    const {
      configuredPlatforms,
      details,
      platformStats,
      totalAttributedRevenue,
      totalConversions,
    } = calculatePlatformStats(orders ?? [], merchant);
    const { ordersWithClickIds, ordersWithLDU, ordersWithTracking } = details;

    // Calculate percentages
    const totalOrders = orders?.length || 0;
    const trackingRate =
      totalOrders > 0 ? (ordersWithTracking / totalOrders) * 100 : 0;
    const clickAttributionRate =
      totalOrders > 0 ? (ordersWithClickIds / totalOrders) * 100 : 0;
    const lduRate =
      ordersWithTracking > 0 ? (ordersWithLDU / ordersWithTracking) * 100 : 0;

    const responseData = {
      // Overall status
      offlineConversionsEnabled: merchant.offline_conversions_enabled !== false,
      configuredPlatforms,

      // Summary metrics
      summary: {
        totalOrders,
        totalConversions,
        totalAttributedRevenue,
        trackingRate: Math.round(trackingRate * 10) / 10, // 1 decimal
        clickAttributionRate: Math.round(clickAttributionRate * 10) / 10,
        lduRate: Math.round(lduRate * 10) / 10,
      },

      // Per-platform breakdown
      platforms: Object.values(platformStats),

      // Detailed stats
      details,
      socialAds,
      ...(googleAds ? { googleAds } : {}),
    };

    // Cache for 5 minutes only when the durable marker was available.
    if (cacheKey) {
      cache.set(cacheKey, responseData, 300);
    }

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Error fetching ad analytics:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
