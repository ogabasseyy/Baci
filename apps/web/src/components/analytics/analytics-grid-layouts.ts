import type { Layout, LayoutItem } from 'react-grid-layout/legacy';

import type { AnalyticsCategory } from './analytics-category-nav';
import { DEFAULT_LAYOUTS } from './analytics-grid-default-layouts';

export type Layouts = {
  lg: Layout;
  md: Layout;
  sm: Layout;
  xs: Layout;
  xxs: Layout;
};

export const ANALYTICS_WIDGET_IDS_BY_CATEGORY: Record<
  AnalyticsCategory,
  readonly string[]
> = {
  overview: [
    'summary-revenue',
    'summary-orders',
    'summary-profit',
    'summary-customers',
    'summary-tax',
    'summary-active',
    'summary-aov',
    'summary-margin',
    'summary-refund-rate',
    'summary-revenue-per-customer',
    'summary-units',
    'analytics-highlights',
    'revenue-chart',
    'payment-methods',
    'financial-summary',
    'orders-chart',
    'brand-breakdown',
    'customer-breakdown',
    'supplier-breakdown',
    'blog-performance',
    'sales-channel',
    'recent-sales',
    'top-products',
  ],
  finance: [
    'analytics-highlights',
    'summary-revenue',
    'revenue-chart',
    'recent-sales',
    'summary-profit',
    'summary-tax',
    'payment-methods',
    'summary-aov',
    'summary-margin',
    'summary-revenue-per-customer',
    'financial-summary',
    'orders-chart',
    'supplier-breakdown',
  ],
  products: [
    'analytics-highlights',
    'summary-orders',
    'top-products',
    'summary-refund-rate',
    'summary-units',
    'orders-chart',
    'brand-breakdown',
    'supplier-breakdown',
  ],
  customers: ['summary-customers', 'summary-active', 'customer-breakdown'],
  marketing: ['sales-channel', 'blog-performance'],
  inventory: [
    'inventory-alerts',
    'inventory-forecast',
    'inventory-summary',
    'low-stock-products',
  ],
  segments: [
    'segment-overview',
    'segment-distribution',
    'at-risk-customers',
    'champions-list',
  ],
  ads: [
    'ads-overview',
    'ads-platforms',
    'ads-attribution',
    'ads-privacy',
    'ads-reporting',
    'social-ads-reporting',
  ],
};

export type LayoutBreakpoint = 'lg' | 'md' | 'sm' | 'xs' | 'xxs';

function createCategoryLayouts(widgetIds: readonly string[]): Layouts {
  const visibleWidgetIds = new Set(widgetIds);
  const filterLayout = (layout: Layout | undefined): Layout =>
    (layout ?? []).filter((item) => visibleWidgetIds.has(item.i));

  return {
    lg: filterLayout(DEFAULT_LAYOUTS.lg),
    md: filterLayout(DEFAULT_LAYOUTS.md),
    sm: filterLayout(DEFAULT_LAYOUTS.sm),
    xs: filterLayout(DEFAULT_LAYOUTS.xs),
    xxs: filterLayout(DEFAULT_LAYOUTS.xxs),
  };
}

const CATEGORY_LAYOUTS: Record<string, Layouts> = Object.fromEntries(
  Object.entries(ANALYTICS_WIDGET_IDS_BY_CATEGORY).map(
    ([category, widgetIds]) => [category, createCategoryLayouts(widgetIds)]
  )
) as Record<string, Layouts>;

export function resolveCategoryLayouts(activeCategory: string): Layouts {
  return CATEGORY_LAYOUTS[activeCategory] ?? DEFAULT_LAYOUTS;
}

export function getAnalyticsLayoutWidgetIds(
  category: AnalyticsCategory,
  breakpoint: LayoutBreakpoint
): string[] {
  return (CATEGORY_LAYOUTS[category]?.[breakpoint] ?? []).map(
    (item: LayoutItem) => item.i
  );
}
