import type { AnalyticsCategory } from '@/components/analytics/analytics-category-nav';

export interface AnalyticsExportDateRange {
  from: Date | undefined;
  to: Date | undefined;
}

const USD_CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  style: 'currency',
});

const CATEGORY_LABELS: Record<AnalyticsCategory, string> = {
  ads: 'Ad Conversions',
  customers: 'Customers',
  finance: 'Finance',
  inventory: 'Inventory',
  marketing: 'Marketing',
  overview: 'Overview',
  products: 'Products',
  segments: 'Customer Segments',
};

export function formatCurrency(value: number): string {
  return USD_CURRENCY_FORMATTER.format(value);
}

export function formatPercentage(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatDateRange(from: Date | undefined, to: Date | undefined): string {
  if (!from || !to) return 'All Time';
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };
  return `${from.toLocaleDateString('en-US', options)} - ${to.toLocaleDateString('en-US', options)}`;
}

/**
 * Some analytics categories are snapshots rather than date-bounded reports.
 * Keep that distinction in downloaded reports so a lifetime segment aggregate
 * is never presented as if it were calculated for the date-picker window.
 */
export function formatAnalyticsExportPeriod(
  category: AnalyticsCategory,
  dateRange?: AnalyticsExportDateRange
): string {
  if (category === 'segments') return 'Lifetime';
  if (category === 'inventory') return 'Current Snapshot';
  return formatDateRange(dateRange?.from, dateRange?.to);
}

export function getAnalyticsExportCategoryLabel(
  category: AnalyticsCategory
): string {
  return CATEGORY_LABELS[category];
}

export function escapeCSVField(
  field: string | number | boolean | null | undefined
): string {
  if (field === null || field === undefined) return '""';

  let escaped = String(field).trim();
  if (/^[=+\-@\t\r]/.test(escaped)) {
    escaped = `'${escaped}`;
  }
  escaped = escaped.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function csvRow(
  ...fields: Array<string | number | boolean | null | undefined>
): string {
  return fields.map(escapeCSVField).join(',');
}
