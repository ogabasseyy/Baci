import type { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AnalyticsCategory } from '@/components/analytics/analytics-category-nav';
import type { AnalyticsData } from '@/components/analytics/analytics-grid-types';

interface JsPDFWithAutoTable extends jsPDF {
  lastAutoTable?: {
    finalY: number;
  };
}

type CurrencyFormatter = (value: number) => string;

function addHeading(doc: jsPDF, title: string, yPosition: number): number {
  doc.setFontSize(14);
  doc.setTextColor(40);
  doc.text(title, 14, yPosition);
  return yPosition + 6;
}

function addTable(
  doc: JsPDFWithAutoTable,
  head: string[],
  body: string[][],
  yPosition: number
): number {
  autoTable(doc, {
    body: body.length > 0 ? body : [['No data']],
    head: [head],
    margin: { left: 14, right: 14 },
    startY: yPosition,
    styles: { fontSize: 8 },
    theme: 'grid',
  });
  return (doc.lastAutoTable?.finalY ?? yPosition) + 12;
}

function appendAdsSection(
  doc: JsPDFWithAutoTable,
  data: AnalyticsData,
  yPosition: number,
  formatCurrency: CurrencyFormatter
): number {
  const adAnalytics = data.adAnalytics;
  if (!adAnalytics) return yPosition;

  let y = addHeading(doc, 'Ad Performance', yPosition);
  const summary = adAnalytics.summary;
  y = addTable(
    doc,
    ['Metric', 'Value'],
    [
      ['Total spend', summary.totalSpend?.toString() ?? 'N/A'],
      ['Total ROAS', summary.totalRoas?.toString() ?? 'N/A'],
      ['Total orders', String(summary.totalOrders)],
      ['Total conversions', String(summary.totalConversions)],
      ['Attributed revenue', formatCurrency(summary.totalAttributedRevenue)],
      ['Tracking rate', `${summary.trackingRate}%`],
      ['Click attribution rate', `${summary.clickAttributionRate}%`],
      ['LDU rate', `${summary.lduRate}%`],
    ],
    y
  );
  y = addHeading(doc, 'Ad Platform Performance', y);
  y = addTable(
    doc,
    ['Platform', 'Configured', 'Conversions', 'Revenue', 'Click-attributed'],
    adAnalytics.platforms.map((platform) => [
      platform.name,
      platform.configured ? 'Yes' : 'No',
      String(platform.conversions),
      formatCurrency(platform.revenue),
      String(platform.clickAttributed),
    ]),
    y
  );

  if (adAnalytics.googleAds) {
    y = addHeading(doc, 'Google Ads Reporting', y);
    const metrics = adAnalytics.googleAds.metrics;
    y = addTable(
      doc,
      ['Metric', 'Value'],
      [
        ['Account', adAnalytics.googleAds.accountName ?? 'N/A'],
        ['Currency', adAnalytics.googleAds.currency ?? 'N/A'],
        ['Spend', metrics?.spend?.toString() ?? 'N/A'],
        ['Impressions', metrics?.impressions?.toString() ?? 'N/A'],
        ['Clicks', metrics?.clicks?.toString() ?? 'N/A'],
        ['Conversions', metrics?.conversions?.toString() ?? 'N/A'],
        ['CTR', metrics?.ctr?.toString() ?? 'N/A'],
        ['CPC', metrics?.cpc?.toString() ?? 'N/A'],
        [
          'Reporting window',
          `${metrics?.startDate ?? 'N/A'} – ${metrics?.endDate ?? 'N/A'}`,
        ],
      ],
      y
    );
  }

  if (adAnalytics.socialAds) {
    y = addHeading(doc, 'Social Ads Reporting', y);
    y = addTable(
      doc,
      [
        'Provider',
        'Status',
        'Account',
        'Spend',
        'Impressions',
        'Clicks',
        'Conversions',
      ],
      adAnalytics.socialAds.providers.map((provider) => {
        const metrics = provider.metrics;
        const spend = (metrics?.spendByCurrency ?? [])
          .map(
            ({ currencyCode, spendAmountDecimal }) =>
              `${currencyCode} ${spendAmountDecimal}`
          )
          .join('; ');
        return [
          provider.displayName,
          provider.connectionStatus,
          provider.accountName ?? 'N/A',
          spend || 'N/A',
          metrics?.impressions ?? 'N/A',
          metrics?.clicks ?? 'N/A',
          metrics?.conversions ?? 'N/A',
        ];
      }),
      y
    );
  }
  return y;
}

function appendInventorySection(
  doc: JsPDFWithAutoTable,
  data: AnalyticsData,
  yPosition: number
): number {
  let y = addHeading(doc, 'Inventory Snapshot', yPosition);
  y = addTable(
    doc,
    ['Metric', 'Value'],
    [
      ['Low stock products', String(data.lowStockCount ?? 0)],
      ['Out of stock products', String(data.outOfStockCount ?? 0)],
      ['Resolved alerts', String(data.resolvedInventoryAlertCount ?? 0)],
    ],
    y
  );
  y = addHeading(doc, 'Inventory Alerts', y);
  y = addTable(
    doc,
    ['Product', 'Alert type', 'Current stock', 'Status'],
    (data.inventoryAlerts ?? []).map((alert) => [
      alert.product_name,
      alert.alert_type,
      String(alert.current_stock),
      alert.status,
    ]),
    y
  );
  y = addHeading(doc, 'Inventory Forecast', y);
  return addTable(
    doc,
    ['Product', 'Stock', 'Avg/day', 'Days of stock', 'Trend', 'Status'],
    (data.inventoryForecasts ?? []).map((forecast) => [
      forecast.product_name,
      String(forecast.current_stock),
      String(forecast.avg_daily_sales),
      String(forecast.days_of_stock),
      forecast.sales_trend,
      forecast.status ?? 'unclassified',
    ]),
    y
  );
}

function appendSegmentsSection(
  doc: JsPDFWithAutoTable,
  data: AnalyticsData,
  yPosition: number,
  formatCurrency: CurrencyFormatter
): number {
  const segmentSummary = data.segmentSummary;
  if (!segmentSummary) return yPosition;

  let y = addHeading(doc, 'Customer Segments (Lifetime)', yPosition);
  y = addTable(
    doc,
    ['Metric', 'Value'],
    [
      ['Total customers', String(segmentSummary.total_customers)],
      ['Champions', String(segmentSummary.champions_count)],
      ['At risk', String(segmentSummary.at_risk_count)],
      [
        'At-risk average CLV',
        segmentSummary.at_risk_avg_clv === undefined
          ? 'N/A'
          : formatCurrency(segmentSummary.at_risk_avg_clv),
      ],
    ],
    y
  );
  y = addHeading(doc, 'Segment Breakdown', y);
  return addTable(
    doc,
    ['Segment', 'Customers', 'Average CLV', 'Average Order Value', 'Revenue'],
    segmentSummary.segments.map((segment) => [
      segment.segment,
      String(segment.count),
      segment.avg_clv === undefined ? 'N/A' : formatCurrency(segment.avg_clv),
      segment.avg_order_value === undefined
        ? 'N/A'
        : formatCurrency(segment.avg_order_value),
      segment.total_revenue === undefined
        ? 'N/A'
        : formatCurrency(segment.total_revenue),
    ]),
    y
  );
}

export function appendAnalyticsCategoryPdfSection(
  doc: JsPDFWithAutoTable,
  data: AnalyticsData,
  category: AnalyticsCategory,
  yPosition: number,
  formatCurrency: CurrencyFormatter
): number {
  if (category === 'ads') {
    return appendAdsSection(doc, data, yPosition, formatCurrency);
  }
  if (category === 'inventory') {
    return appendInventorySection(doc, data, yPosition);
  }
  if (category === 'segments') {
    return appendSegmentsSection(doc, data, yPosition, formatCurrency);
  }
  return yPosition;
}
