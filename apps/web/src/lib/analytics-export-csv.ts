import type { AnalyticsCategory } from '@/components/analytics/analytics-category-nav';
import type { AnalyticsData } from '@/components/analytics/analytics-grid-types';
import {
  appendAdsCsvRows,
  appendInventoryCsvRows,
  appendSegmentsCsvRows,
} from './analytics-export-category-rows';
import {
  type AnalyticsExportDateRange,
  csvRow,
  escapeCSVField,
  formatAnalyticsExportPeriod,
  formatCurrency,
  formatPercentage,
  getAnalyticsExportCategoryLabel,
} from './analytics-export-formatters';

/**
 * Build the CSV payload without touching browser APIs. Keeping this pure lets
 * the dashboard test category-specific exports without relying on downloads.
 */
export function buildAnalyticsCsvContent(
  data: AnalyticsData,
  dateRange?: AnalyticsExportDateRange,
  merchantName?: string,
  category: AnalyticsCategory = 'overview'
): string {
  const { summary, recentSales, salesByChannel, salesByPaymentMethod } = data;
  const rows: string[] = [];

  rows.push(`Analytics Report - ${merchantName || 'Your Store'}`);
  rows.push(`Period: ${formatAnalyticsExportPeriod(category, dateRange)}`);
  if (category !== 'overview') {
    rows.push(`Category: ${getAnalyticsExportCategoryLabel(category)}`);
  }
  rows.push(`Generated: ${new Date().toLocaleString()}`);
  rows.push('');

  rows.push('SUMMARY METRICS');
  rows.push('Metric,Value,Change');
  if (summary) {
    rows.push(
      `Total Revenue,${formatCurrency(summary.revenue?.value || 0)},${formatPercentage(summary.revenue?.change || 0)}`
    );
    rows.push(
      `Total Sales,${summary.sales?.value || 0},${formatPercentage(summary.sales?.change || 0)}`
    );
    rows.push(`Total Units Sold,${summary.totalUnitsSold || 0},0%`);
    rows.push(
      `Total Customers,${summary.customers?.value || 0},${formatPercentage(summary.customers?.change || 0)}`
    );
    rows.push(
      `Average Order Value,${formatCurrency(summary.aov?.value || 0)},${formatPercentage(summary.aov?.change || 0)}`
    );
  }
  rows.push('');

  if (summary) {
    rows.push('FINANCIAL BREAKDOWN');
    rows.push('Item,Amount');
    rows.push(`Subtotal,${formatCurrency(summary.subtotal || 0)}`);
    rows.push(`Shipping,${formatCurrency(summary.shipping || 0)}`);
    rows.push(`Tax,${formatCurrency(summary.tax || 0)}`);
    rows.push(`Discounts,${formatCurrency(summary.discounts || 0)}`);
    rows.push(`Net Total,${formatCurrency(summary.revenue?.value || 0)}`);
    rows.push('');
  }

  if (salesByChannel && salesByChannel.length > 0) {
    rows.push('SALES BY CHANNEL');
    rows.push('Channel,Revenue');
    for (const channel of salesByChannel) {
      rows.push(`${channel.name},${formatCurrency(channel.value)}`);
    }
    rows.push('');
  }

  if (salesByPaymentMethod && salesByPaymentMethod.length > 0) {
    rows.push('SALES BY PAYMENT METHOD');
    rows.push('Method,Revenue');
    for (const payment of salesByPaymentMethod) {
      rows.push(`${payment.name},${formatCurrency(payment.value)}`);
    }
    rows.push('');
  }

  if (category === 'ads' && data.adAnalytics) {
    appendAdsCsvRows(rows, data.adAnalytics);
  } else if (category === 'inventory') {
    appendInventoryCsvRows(rows, data);
  } else if (category === 'segments' && data.segmentSummary) {
    appendSegmentsCsvRows(rows, data.segmentSummary);
  }

  if (recentSales && recentSales.length > 0) {
    rows.push('RECENT SALES');
    rows.push('Customer,Email,Amount,Date');
    for (const sale of recentSales) {
      rows.push(
        `${escapeCSVField(sale.name)},${escapeCSVField(sale.email)},${formatCurrency(sale.amount)},${new Date(sale.time).toLocaleDateString()}`
      );
    }
    rows.push('');
  }

  return rows.join('\n');
}

export { csvRow };
