import type { DashboardNavItem } from './dashboard-nav-items';

export function flattenDashboardNavItems(
  items: DashboardNavItem[]
): DashboardNavItem[] {
  return items.flatMap((item) => {
    const { children, ...itemWithoutChildren } = item;
    return [itemWithoutChildren, ...flattenDashboardNavItems(children ?? [])];
  });
}
