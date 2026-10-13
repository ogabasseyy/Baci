import { cloneElement } from 'react';
import {
  type AnalyticsDetailWidgetId,
  AnalyticsDetailWidgets,
} from './analytics-detail-widgets';
import type {
  AnalyticsData,
  CurrencyFormatter,
  WidgetVisibility,
} from './analytics-grid-types';

const DETAIL_WIDGET_IDS: readonly AnalyticsDetailWidgetId[] = [
  'orders-chart',
  'brand-breakdown',
  'customer-breakdown',
  'supplier-breakdown',
  'blog-performance',
];

interface AnalyticsDetailWidgetGroupProps {
  data: AnalyticsData;
  formatCurrency: CurrencyFormatter;
  isWidgetVisible: WidgetVisibility;
  viewMode?: boolean;
}

export function AnalyticsDetailWidgetGroup({
  data,
  formatCurrency,
  isWidgetVisible,
  viewMode = false,
}: AnalyticsDetailWidgetGroupProps) {
  const widgets = DETAIL_WIDGET_IDS.map((widgetId) =>
    isWidgetVisible(widgetId)
      ? cloneElement(
          AnalyticsDetailWidgets({ data, formatCurrency, widgetId }),
          { key: widgetId }
        )
      : null
  );
  return viewMode ? (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{widgets}</div>
  ) : (
    widgets
  );
}
