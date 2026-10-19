import type { AnalyticsCategory } from './analytics-category-nav';

export type AnalyticsPermissionCheck = (
  resource: string,
  action: string
) => boolean;

export function isAnalyticsCategoryAllowed(
  category: AnalyticsCategory,
  hasPermission: AnalyticsPermissionCheck
): boolean {
  if (category === 'inventory') return hasPermission('products', 'view');
  if (category === 'segments') return hasPermission('customers', 'view');
  return true;
}
