import type { MerchantAnalyticsResponse } from '@baci/shared';
import type { MerchantData } from '@/hooks/merchant/types';
import type { AdsSyncWindow } from '@/lib/analytics/default-ads-sync-window';
import type { AnalyticsCategory } from './analytics-category-nav';
import type { GoogleAdsReportingData } from './google-ads-reporting-card';
import type { SocialAdsReportingData } from './social-ads-reporting-card';

interface MetricData {
  value: number;
  change: number;
}

export interface AnalyticsSummary {
  revenue: MetricData;
  customers: MetricData;
  sales: MetricData;
  activeNow: MetricData;
  aov?: MetricData;
  profit?: MetricData;
  taxDue?: MetricData;
  grossMargin?: MetricData;
  revenuePerCustomer?: MetricData;
  refundRate?: MetricData;
  subtotal?: number;
  shipping?: number;
  tax?: number;
  discounts?: number;
  totalUnitsSold?: number;
}

export interface SaleRecord {
  id: string;
  name: string;
  email: string;
  time: string;
  amount: number;
  avatar?: string;
}

export interface ProductRecord {
  id: string;
  name: string;
  sku?: string;
  revenue: number;
  units?: number;
}

export interface InventoryAlert {
  id: string;
  product_name: string;
  alert_type: string;
  current_stock: number;
  status: string;
}

export type InventoryForecastStatus =
  | 'healthy'
  | 'warning'
  | 'critical'
  | 'out_of_stock';

export interface InventoryForecast {
  product_id: string;
  product_name: string;
  current_stock: number;
  avg_daily_sales: number;
  days_of_stock: number;
  sales_trend: string;
  low_stock_threshold?: number;
  status?: InventoryForecastStatus;
}

export interface SegmentInfo {
  segment: string;
  count: number;
  avg_clv?: number;
  avg_order_value?: number;
  total_revenue?: number;
}

export interface SegmentSummary {
  total_customers: number;
  champions_count: number;
  at_risk_count: number;
  at_risk_avg_clv?: number;
  segments: SegmentInfo[];
}

export interface AdPlatformData {
  name: string;
  configured: boolean;
  conversions: number;
  revenue: number;
  clickAttributed: number;
}

export interface AdAnalyticsSummary {
  totalSpend?: number;
  totalRoas?: number;
  totalOrders: number;
  trackingRate: number;
  clickAttributionRate: number;
  lduRate: number;
  totalConversions: number;
  totalAttributedRevenue: number;
}

export interface AdAnalyticsDetails {
  ordersWithClickIds: number;
  ordersWithLDU: number;
  ordersWithTracking: number;
}

export interface AdAnalyticsData {
  googleAds?: GoogleAdsReportingData;
  socialAds?: SocialAdsReportingData;
  summary: AdAnalyticsSummary;
  details: AdAnalyticsDetails;
  platforms: AdPlatformData[];
  offlineConversionsEnabled: boolean;
  configuredPlatforms: number;
}

export interface AnalyticsData {
  blog?: MerchantAnalyticsResponse['blog'];
  brandBreakdown?: MerchantAnalyticsResponse['brandBreakdown'];
  summary?: AnalyticsSummary;
  chartData?: MerchantAnalyticsResponse['chartData'];
  customerBreakdown?: MerchantAnalyticsResponse['customerBreakdown'];
  revenueOverTime?: unknown[];
  salesByChannel?: Array<{ name: string; value: number }>;
  salesByPaymentMethod?: Array<{ name: string; value: number }>;
  recentSales?: SaleRecord[];
  topProducts?: ProductRecord[];
  supplierAnalytics?: MerchantAnalyticsResponse['supplierAnalytics'];
  topBrand?: MerchantAnalyticsResponse['topBrand'];
  topCustomer?: MerchantAnalyticsResponse['topCustomer'];
  topPaymentMethod?: MerchantAnalyticsResponse['topPaymentMethod'];
  topSupplier?: MerchantAnalyticsResponse['topSupplier'];
  paymentMethods?: Array<{ name: string; value: number }>;
  inventoryAlerts?: InventoryAlert[];
  inventoryForecasts?: InventoryForecast[];
  lowStockCount?: number;
  outOfStockCount?: number;
  resolvedInventoryAlertCount?: number;
  segmentSummary?: SegmentSummary;
  adAnalytics?: AdAnalyticsData;
}

export interface AnalyticsGridProps {
  data: AnalyticsData;
  loading: boolean;
  activeCategory: AnalyticsCategory;
  merchant: MerchantData | null;
  canManageAdsIntegrations: boolean;
  canCustomizeLayout: boolean;
  categoryError?: string | null;
  onAnalyticsRetry?: () => void;
  onAdsReportingSynced?: () => void;
  syncWindow?: AdsSyncWindow;
}

export type CurrencyFormatter = (value: number) => string;
export type PercentFormatter = (value: number) => string;
export type WidgetVisibility = (key: string) => boolean;
