import { z } from 'zod';

const DASHBOARD_WIDGET_IDS = [
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
  'inventory-summary',
  'inventory-alerts',
  'inventory-forecast',
  'low-stock-products',
  'segment-overview',
  'segment-distribution',
  'at-risk-customers',
  'champions-list',
  'ads-overview',
  'ads-platforms',
  'ads-attribution',
  'ads-privacy',
  'ads-reporting',
  'social-ads-reporting',
] as const;

const LEGACY_VISIBLE_CARD_IDS = [
  'revenue',
  'orders',
  'customers',
  'products',
  'sales_by_channel',
  'top_products',
] as const;

const allowedLayoutWidgetIds = new Set<string>(DASHBOARD_WIDGET_IDS);
const allowedVisibleCardIds = new Set<string>([
  ...DASHBOARD_WIDGET_IDS,
  ...LEGACY_VISIBLE_CARD_IDS,
]);

const widgetId = z
  .string()
  .refine((value) => allowedLayoutWidgetIds.has(value), {
    message: 'Unknown dashboard widget',
  });

const visibleCardId = z
  .string()
  .refine((value) => allowedVisibleCardIds.has(value), {
    message: 'Unknown dashboard card',
  });

const layoutItem = z
  .object({
    h: z.number().int().min(1).max(20),
    i: widgetId,
    w: z.number().int().min(1).max(12),
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0).max(1_000),
  })
  .refine((item) => item.x + item.w <= 12, {
    message: 'Dashboard widget exceeds the 12-column grid',
    path: ['w'],
  });

const layout = z.array(layoutItem).max(100);

const responsiveLayout = z
  .object({
    lg: layout.optional(),
    md: layout.optional(),
    sm: layout.optional(),
    xs: layout.optional(),
    xxs: layout.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'Responsive layout must include at least one breakpoint',
  });

const singleLayoutConfig = z.union([layout, responsiveLayout]);
const categoryLayoutConfig = z
  .object({
    ads: singleLayoutConfig.optional(),
    customers: singleLayoutConfig.optional(),
    finance: singleLayoutConfig.optional(),
    inventory: singleLayoutConfig.optional(),
    marketing: singleLayoutConfig.optional(),
    overview: singleLayoutConfig.optional(),
    products: singleLayoutConfig.optional(),
    segments: singleLayoutConfig.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'Category layout must include at least one category',
  });

const layoutConfig = z.union([singleLayoutConfig, categoryLayoutConfig]);

/** Validates the bounded, known-widget dashboard layout persistence payload. */
export const dashboardPreferencesSchema = z
  .object({
    layout_config: layoutConfig.optional(),
    visible_cards: z.array(visibleCardId).max(50).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.layout_config !== undefined || value.visible_cards !== undefined,
    { message: 'At least one dashboard preference is required' }
  );
