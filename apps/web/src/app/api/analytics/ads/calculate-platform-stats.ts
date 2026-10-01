import type { AdTrackingData } from '@/lib/ad-tracking-cookies';
import type { AnalyticsPaidOrder } from './fetch-paid-orders';
import { hasAdTrackingData } from './has-ad-tracking-data';

export interface PlatformStats {
  name: string;
  configured: boolean;
  conversions: number;
  revenue: number;
  clickAttributed: number;
}

export interface AnalyticsPlatformConfig {
  facebook_capi_token: string | null;
  facebook_pixel_id: string | null;
  ga4_api_secret: string | null;
  google_analytics_id: string | null;
  snapchat_capi_token: string | null;
  snapchat_pixel_id: string | null;
  tiktok_access_token: string | null;
  tiktok_pixel_id: string | null;
}

export interface PlatformStatsResult {
  configuredPlatforms: number;
  details: {
    ordersWithClickIds: number;
    ordersWithLDU: number;
    ordersWithTracking: number;
  };
  platformStats: Record<string, PlatformStats>;
  totalAttributedRevenue: number;
  totalConversions: number;
}

function configuredPlatformStats(
  merchant: AnalyticsPlatformConfig
): Record<string, PlatformStats> {
  return {
    facebook: {
      name: 'Facebook',
      configured: Boolean(
        merchant.facebook_pixel_id && merchant.facebook_capi_token
      ),
      conversions: 0,
      revenue: 0,
      clickAttributed: 0,
    },
    tiktok: {
      name: 'TikTok',
      configured: Boolean(
        merchant.tiktok_pixel_id && merchant.tiktok_access_token
      ),
      conversions: 0,
      revenue: 0,
      clickAttributed: 0,
    },
    ga4: {
      name: 'Google Analytics 4',
      configured: Boolean(
        merchant.google_analytics_id && merchant.ga4_api_secret
      ),
      conversions: 0,
      revenue: 0,
      clickAttributed: 0,
    },
    snapchat: {
      name: 'Snapchat',
      configured: Boolean(
        merchant.snapchat_pixel_id && merchant.snapchat_capi_token
      ),
      conversions: 0,
      revenue: 0,
      clickAttributed: 0,
    },
  };
}

function addAttribution(
  stats: PlatformStats,
  revenue: number,
  configured: boolean
): void {
  stats.clickAttributed += 1;
  if (configured) {
    stats.conversions += 1;
    stats.revenue += revenue;
  }
}

function hasConfiguredPlatformTracking(
  tracking: AdTrackingData,
  platformStats: Record<string, PlatformStats>
): boolean {
  return Boolean(
    (platformStats.facebook.configured && tracking.fbclid) ||
      (platformStats.tiktok.configured && tracking.ttclid) ||
      (platformStats.ga4.configured && tracking.gclid) ||
      (platformStats.snapchat.configured && tracking.sccid)
  );
}

export function calculatePlatformStats(
  orders: readonly AnalyticsPaidOrder[],
  merchant: AnalyticsPlatformConfig
): PlatformStatsResult {
  const platformStats = configuredPlatformStats(merchant);
  let totalConversions = 0;
  let totalAttributedRevenue = 0;
  let ordersWithTracking = 0;
  let ordersWithClickIds = 0;
  let ordersWithLDU = 0;

  for (const order of orders) {
    const tracking = order.ad_tracking as AdTrackingData | null;
    const revenue = Number(order.total) || 0;
    if (!hasAdTrackingData(tracking)) continue;

    ordersWithTracking += 1;
    if (tracking.limitedDataUse) ordersWithLDU += 1;

    const hasClickId = Boolean(
      tracking.fbclid || tracking.ttclid || tracking.gclid || tracking.sccid
    );
    if (hasClickId) ordersWithClickIds += 1;

    if (tracking.fbclid) {
      addAttribution(
        platformStats.facebook,
        revenue,
        platformStats.facebook.configured
      );
    }
    if (tracking.ttclid) {
      addAttribution(
        platformStats.tiktok,
        revenue,
        platformStats.tiktok.configured
      );
    }
    if (tracking.gclid) {
      addAttribution(platformStats.ga4, revenue, platformStats.ga4.configured);
    }
    if (tracking.sccid) {
      addAttribution(
        platformStats.snapchat,
        revenue,
        platformStats.snapchat.configured
      );
    }

    if (hasConfiguredPlatformTracking(tracking, platformStats)) {
      totalConversions += 1;
      totalAttributedRevenue += revenue;
    }
  }

  return {
    configuredPlatforms: Object.values(platformStats).filter(
      (platform) => platform.configured
    ).length,
    details: { ordersWithClickIds, ordersWithLDU, ordersWithTracking },
    platformStats,
    totalAttributedRevenue,
    totalConversions,
  };
}
