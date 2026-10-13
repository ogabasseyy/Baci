import type { AnalyticsCategory } from '@/components/analytics/analytics-category-nav';
import type {
  AnalyticsData,
  InventoryForecastStatus,
} from '@/components/analytics/draggable-analytics-grid';
import { buildAdsSyncWindow } from '@/lib/analytics/default-ads-sync-window';
import {
  type AnalyticsJsonRecord,
  analyticsDataParsers,
} from './analytics-data-parsers';
import { mapGoogleAdsReporting } from './google-ads-analytics-mapper';
import { mapSocialAdsReporting } from './social-ads-analytics-mapper';

interface FetchAnalyticsCategoryDataOptions {
  category: AnalyticsCategory;
  from: Date;
  merchantId: string;
  refreshKey?: number;
  signal: AbortSignal;
  to: Date;
}

const { asArray, asNumber, asOptionalNumber, asRecord, asString } =
  analyticsDataParsers;

function asInventoryForecastStatus(
  value: unknown
): InventoryForecastStatus | undefined {
  if (
    value === 'healthy' ||
    value === 'warning' ||
    value === 'critical' ||
    value === 'out_of_stock'
  ) {
    return value;
  }

  return undefined;
}

async function fetchAnalyticsJson(
  path: string,
  merchantId: string,
  signal: AbortSignal
): Promise<AnalyticsJsonRecord> {
  const response = await fetch(path, {
    headers: { 'x-baci-merchant-id': merchantId },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Analytics request failed (${response.status})`);
  }

  const payload: unknown = await response.json();
  return asRecord(payload) ?? {};
}

function mapInventoryAlert(alert: AnalyticsJsonRecord) {
  const product = asRecord(alert.products);
  return {
    alert_type: asString(alert.alert_type, 'unknown'),
    current_stock: asNumber(alert.current_stock),
    id: asString(alert.id, 'unknown-alert'),
    product_name: asString(product?.name, 'Unknown Product'),
    status: asString(alert.status, 'active'),
  };
}

function mapInventoryForecast(forecast: AnalyticsJsonRecord) {
  return {
    avg_daily_sales: asNumber(forecast.avgDailySales),
    current_stock: asNumber(forecast.currentStock),
    days_of_stock: asNumber(forecast.daysOfStock),
    low_stock_threshold: asOptionalNumber(forecast.lowStockThreshold),
    product_id: asString(forecast.productId, 'unknown-product'),
    product_name: asString(forecast.productName, 'Unknown Product'),
    sales_trend: asString(forecast.salesTrend, 'stable'),
    status: asInventoryForecastStatus(forecast.status),
  };
}

function inventoryForecastPriority(
  forecast: ReturnType<typeof mapInventoryForecast>
): number {
  if (forecast.status === 'out_of_stock' || forecast.current_stock <= 0) {
    return 0;
  }

  if (forecast.status === 'critical') {
    return 1;
  }

  if (forecast.status === 'warning') {
    return 2;
  }

  return 3;
}

async function fetchInventoryData(
  merchantId: string,
  signal: AbortSignal
): Promise<Partial<AnalyticsData>> {
  const [alertsPayload, forecastPayload, resolvedAlertsPayload] =
    await Promise.all([
      fetchAnalyticsJson(
        '/api/inventory/alerts?status=active',
        merchantId,
        signal
      ),
      fetchAnalyticsJson(
        '/api/inventory/forecast?limit=100',
        merchantId,
        signal
      ),
      fetchAnalyticsJson(
        '/api/inventory/alerts?status=resolved',
        merchantId,
        signal
      ),
    ]);

  const forecastSummary = asRecord(forecastPayload.summary);
  const forecasts = asArray(forecastPayload.forecasts)
    .map(mapInventoryForecast)
    .sort(
      (left, right) =>
        inventoryForecastPriority(left) - inventoryForecastPriority(right) ||
        left.days_of_stock - right.days_of_stock ||
        left.product_id.localeCompare(right.product_id)
    );
  const resolvedAlertsStats = asRecord(resolvedAlertsPayload.stats);

  return {
    inventoryAlerts: asArray(alertsPayload.alerts).map(mapInventoryAlert),
    inventoryForecasts: forecasts,
    lowStockCount:
      asNumber(forecastSummary?.critical) + asNumber(forecastSummary?.warning),
    outOfStockCount: asNumber(forecastSummary?.outOfStock),
    resolvedInventoryAlertCount:
      resolvedAlertsStats && 'total' in resolvedAlertsStats
        ? asNumber(resolvedAlertsStats.total)
        : asArray(resolvedAlertsPayload.alerts).length,
  };
}

function normalizeSegmentName(value: unknown): string {
  return asString(value, 'Unknown').trim();
}

async function fetchSegmentData(
  merchantId: string,
  signal: AbortSignal
): Promise<Partial<AnalyticsData>> {
  const payload = await fetchAnalyticsJson(
    '/api/customers/segments?limit=100',
    merchantId,
    signal
  );
  const segments = asArray(payload.summary).map((row) => ({
    avg_clv: asNumber(row.avg_clv),
    count: asNumber(row.customer_count),
    segment: normalizeSegmentName(row.segment_name),
    total_revenue: asNumber(row.total_revenue),
  }));
  const totalCustomers = segments.reduce((sum, row) => sum + row.count, 0);
  const champions = segments.find(
    (row) => row.segment.toLowerCase() === 'champions'
  );
  const atRisk = segments.filter((row) =>
    ['at risk', "can't lose them"].includes(row.segment.toLowerCase())
  );
  const atRiskCount = atRisk.reduce((sum, row) => sum + row.count, 0);
  const atRiskAverageClv =
    atRiskCount > 0
      ? atRisk.reduce((sum, row) => sum + row.avg_clv * row.count, 0) /
        atRiskCount
      : undefined;

  return {
    segmentSummary: {
      at_risk_avg_clv: atRiskAverageClv,
      at_risk_count: atRiskCount,
      champions_count: champions?.count ?? 0,
      segments,
      total_customers: totalCustomers,
    },
  };
}

function mapAdPlatform(platform: AnalyticsJsonRecord) {
  return {
    clickAttributed: asNumber(platform.clickAttributed),
    configured: platform.configured === true,
    conversions: asNumber(platform.conversions),
    name: asString(platform.name, 'Unknown platform'),
    revenue: asNumber(platform.revenue),
  };
}

function endOfLocalCalendarDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

async function fetchAdAnalyticsData(
  merchantId: string,
  from: Date,
  refreshKey: number | undefined,
  to: Date,
  signal: AbortSignal
): Promise<Partial<AnalyticsData>> {
  const params = new URLSearchParams({
    // The ads endpoint accepts calendar dates. Converting date-picker values
    // through ISO/UTC here shifts account-local provider spend windows.
    orderEnd: endOfLocalCalendarDay(to).toISOString(),
    orderStart: from.toISOString(),
    ...buildAdsSyncWindow(from, to),
  });
  if (refreshKey !== undefined) {
    params.set('cacheBust', String(refreshKey));
  }
  const payload = await fetchAnalyticsJson(
    `/api/analytics/ads?${params.toString()}`,
    merchantId,
    signal
  );
  const summary = asRecord(payload.summary);
  const details = asRecord(payload.details);
  const googleAds = mapGoogleAdsReporting(payload.googleAds ?? payload.adSpend);
  const socialAds = mapSocialAdsReporting(payload.socialAds);

  return {
    adAnalytics: {
      configuredPlatforms: asNumber(payload.configuredPlatforms),
      details: {
        ordersWithClickIds: asNumber(details?.ordersWithClickIds),
        ordersWithLDU: asNumber(details?.ordersWithLDU),
        ordersWithTracking: asNumber(details?.ordersWithTracking),
      },
      googleAds,
      offlineConversionsEnabled: payload.offlineConversionsEnabled !== false,
      platforms: asArray(payload.platforms).map(mapAdPlatform),
      socialAds,
      summary: {
        clickAttributionRate: asNumber(summary?.clickAttributionRate),
        lduRate: asNumber(summary?.lduRate),
        totalAttributedRevenue: asNumber(summary?.totalAttributedRevenue),
        totalConversions: asNumber(summary?.totalConversions),
        totalOrders: asNumber(summary?.totalOrders),
        trackingRate: asNumber(summary?.trackingRate),
      },
    },
  };
}

export function fetchAnalyticsCategoryData({
  category,
  from,
  merchantId,
  refreshKey,
  signal,
  to,
}: FetchAnalyticsCategoryDataOptions): Promise<Partial<AnalyticsData>> {
  if (category === 'inventory') {
    return fetchInventoryData(merchantId, signal);
  }

  if (category === 'segments') {
    return fetchSegmentData(merchantId, signal);
  }

  if (category === 'ads') {
    return fetchAdAnalyticsData(merchantId, from, refreshKey, to, signal);
  }

  return Promise.resolve({});
}
