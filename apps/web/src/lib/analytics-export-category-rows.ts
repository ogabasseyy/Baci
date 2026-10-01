import type {
  AdAnalyticsData,
  AnalyticsData,
  InventoryAlert,
  InventoryForecast,
  SegmentInfo,
} from '@/components/analytics/analytics-grid-types';
import { csvRow, formatCurrency } from './analytics-export-formatters';

export function appendAdsCsvRows(
  rows: string[],
  adAnalytics: AdAnalyticsData
): void {
  rows.push('AD PERFORMANCE');
  rows.push(csvRow('Metric', 'Value'));
  rows.push(csvRow('Total Spend', adAnalytics.summary.totalSpend ?? 'N/A'));
  rows.push(csvRow('Total ROAS', adAnalytics.summary.totalRoas ?? 'N/A'));
  rows.push(csvRow('Total Orders', adAnalytics.summary.totalOrders));
  rows.push(csvRow('Total Conversions', adAnalytics.summary.totalConversions));
  rows.push(
    csvRow(
      'Attributed Revenue',
      formatCurrency(adAnalytics.summary.totalAttributedRevenue)
    )
  );
  rows.push(csvRow('Tracking Rate', `${adAnalytics.summary.trackingRate}%`));
  rows.push(
    csvRow(
      'Click Attribution Rate',
      `${adAnalytics.summary.clickAttributionRate}%`
    )
  );
  rows.push(csvRow('LDU Rate', `${adAnalytics.summary.lduRate}%`));
  rows.push(
    csvRow('Offline Conversions Enabled', adAnalytics.offlineConversionsEnabled)
  );
  rows.push('');

  rows.push('AD PLATFORM PERFORMANCE');
  rows.push(
    csvRow(
      'Platform',
      'Configured',
      'Conversions',
      'Revenue',
      'Click-attributed'
    )
  );
  for (const platform of adAnalytics.platforms) {
    rows.push(
      csvRow(
        platform.name,
        platform.configured,
        platform.conversions,
        formatCurrency(platform.revenue),
        platform.clickAttributed
      )
    );
  }
  rows.push('');

  if (adAnalytics.googleAds) {
    rows.push('GOOGLE ADS REPORTING');
    rows.push(csvRow('Metric', 'Value'));
    const metrics = adAnalytics.googleAds.metrics;
    rows.push(csvRow('Account', adAnalytics.googleAds.accountName ?? 'N/A'));
    rows.push(csvRow('Currency', adAnalytics.googleAds.currency ?? 'N/A'));
    rows.push(csvRow('Spend', metrics?.spend ?? 'N/A'));
    rows.push(csvRow('Impressions', metrics?.impressions ?? 'N/A'));
    rows.push(csvRow('Clicks', metrics?.clicks ?? 'N/A'));
    rows.push(csvRow('Conversions', metrics?.conversions ?? 'N/A'));
    rows.push(csvRow('CTR', metrics?.ctr ?? 'N/A'));
    rows.push(csvRow('CPC', metrics?.cpc ?? 'N/A'));
    rows.push(csvRow('Reporting Start', metrics?.startDate ?? 'N/A'));
    rows.push(csvRow('Reporting End', metrics?.endDate ?? 'N/A'));
    rows.push('');
  }

  if (adAnalytics.socialAds) {
    rows.push('SOCIAL ADS REPORTING');
    rows.push(
      csvRow(
        'Provider',
        'Status',
        'Account',
        'Spend by Currency',
        'Impressions',
        'Clicks',
        'Conversions',
        'Reach',
        'Freshness'
      )
    );
    for (const provider of adAnalytics.socialAds.providers) {
      const metrics = provider.metrics;
      const spend = (metrics?.spendByCurrency ?? [])
        .map(
          ({ currencyCode, spendAmountDecimal }) =>
            `${currencyCode} ${spendAmountDecimal}`
        )
        .join('; ');
      rows.push(
        csvRow(
          provider.displayName,
          provider.connectionStatus,
          provider.accountName ?? 'N/A',
          spend || 'N/A',
          metrics?.impressions ?? 'N/A',
          metrics?.clicks ?? 'N/A',
          metrics?.conversions ?? 'N/A',
          metrics?.reach ?? 'N/A',
          provider.freshness
        )
      );
    }
    rows.push(
      csvRow('Attribution Notice', adAnalytics.socialAds.attributionNotice)
    );
    rows.push('');
  }
}

export function appendInventoryCsvRows(
  rows: string[],
  data: Pick<
    AnalyticsData,
    | 'inventoryAlerts'
    | 'inventoryForecasts'
    | 'lowStockCount'
    | 'outOfStockCount'
    | 'resolvedInventoryAlertCount'
  >
): void {
  rows.push('INVENTORY SNAPSHOT');
  rows.push(csvRow('Metric', 'Value'));
  rows.push(csvRow('Low Stock Products', data.lowStockCount ?? 0));
  rows.push(csvRow('Out of Stock Products', data.outOfStockCount ?? 0));
  rows.push(csvRow('Resolved Alerts', data.resolvedInventoryAlertCount ?? 0));
  rows.push('');

  rows.push('INVENTORY ALERTS');
  rows.push(csvRow('Product', 'Alert Type', 'Current Stock', 'Status'));
  for (const alert of data.inventoryAlerts ?? []) {
    appendInventoryAlertCsvRow(rows, alert);
  }
  if ((data.inventoryAlerts ?? []).length === 0) {
    rows.push(csvRow('No active alerts'));
  }
  rows.push('');

  rows.push('INVENTORY FORECAST');
  rows.push(
    csvRow(
      'Product',
      'Current Stock',
      'Avg Daily Sales',
      'Days of Stock',
      'Sales Trend',
      'Status'
    )
  );
  for (const forecast of data.inventoryForecasts ?? []) {
    appendInventoryForecastCsvRow(rows, forecast);
  }
  if ((data.inventoryForecasts ?? []).length === 0) {
    rows.push(csvRow('No forecast data'));
  }
  rows.push('');
}

function appendInventoryAlertCsvRow(
  rows: string[],
  alert: InventoryAlert
): void {
  rows.push(
    csvRow(
      alert.product_name,
      alert.alert_type,
      alert.current_stock,
      alert.status
    )
  );
}

function appendInventoryForecastCsvRow(
  rows: string[],
  forecast: InventoryForecast
): void {
  rows.push(
    csvRow(
      forecast.product_name,
      forecast.current_stock,
      forecast.avg_daily_sales,
      forecast.days_of_stock,
      forecast.sales_trend,
      forecast.status ?? 'unclassified'
    )
  );
}

export function appendSegmentsCsvRows(
  rows: string[],
  segmentSummary: NonNullable<AnalyticsData['segmentSummary']>
): void {
  rows.push('CUSTOMER SEGMENTS (LIFETIME)');
  rows.push(csvRow('Metric', 'Value'));
  rows.push(csvRow('Total Customers', segmentSummary.total_customers));
  rows.push(csvRow('Champions', segmentSummary.champions_count));
  rows.push(csvRow('At Risk', segmentSummary.at_risk_count));
  rows.push(
    csvRow(
      'At Risk Average CLV',
      segmentSummary.at_risk_avg_clv === undefined
        ? 'N/A'
        : formatCurrency(segmentSummary.at_risk_avg_clv)
    )
  );
  rows.push('');
  rows.push('SEGMENT BREAKDOWN');
  rows.push(
    csvRow(
      'Segment',
      'Customers',
      'Average CLV',
      'Average Order Value',
      'Revenue'
    )
  );
  for (const segment of segmentSummary.segments) {
    appendSegmentCsvRow(rows, segment);
  }
  if (segmentSummary.segments.length === 0) {
    rows.push(csvRow('No segment data'));
  }
  rows.push('');
}

function appendSegmentCsvRow(rows: string[], segment: SegmentInfo): void {
  rows.push(
    csvRow(
      segment.segment,
      segment.count,
      segment.avg_clv === undefined ? 'N/A' : formatCurrency(segment.avg_clv),
      segment.avg_order_value === undefined
        ? 'N/A'
        : formatCurrency(segment.avg_order_value),
      segment.total_revenue === undefined
        ? 'N/A'
        : formatCurrency(segment.total_revenue)
    )
  );
}
