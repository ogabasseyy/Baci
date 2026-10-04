import type { MerchantData, StaffAccess } from '@/hooks/merchant/types';
import { isRepairsBusinessType } from '@/lib/repairs/repairs-feature';
import type { DashboardNavItem } from './dashboard-nav-items';
import { isSantaCampaignVisible } from './santa-navigation';

export type DashboardNavFilterContext = {
  merchant: Pick<MerchantData, 'slug' | 'business_type'> | null;
  agenticMerchantSlug?: string | null;
  staffAccess: StaffAccess;
  hasPermission: (resource: string, action: string) => boolean;
};

// Map labels/paths to resources in role_permissions table
const resourceMap: Record<string, string> = {
  Dashboard: 'dashboard',
  Analytics: 'analytics',
  Orders: 'orders',
  Products: 'products',
  Repairs: 'repairs',
  Customers: 'customers',
  Staff: 'staff',
  Loyalty: 'marketing', // Loyalty is part of marketing permissions
  Quiz: 'marketing',
  'Santa Campaign': 'marketing',
  Wallet: 'wallet', // Assuming wallet exists, check role_permissions
  SEO: 'marketing',
  Agentic: 'integrations',
  Domains: 'settings',
  Pages: 'pages',
  Blog: 'marketing', // Blog is usually under marketing, or its own 'blog'
  Marketing: 'marketing',
  'Discount Codes': 'marketing',
  Templates: 'builder',
  'Customize Website': 'builder',
  Marketplaces: 'integrations',
  Settings: 'settings',
};

function canShowNavItem(
  item: DashboardNavItem,
  ctx: DashboardNavFilterContext
): boolean {
  // Santa Campaign is available only to the configured agentic tenant.
  if (
    item.label === 'Santa Campaign' &&
    !isSantaCampaignVisible(ctx.merchant?.slug, ctx.agenticMerchantSlug)
  ) {
    return false;
  }

  // Repairs catalogue is gated to electronics/gadgets merchants. The page
  // itself handles the feature-flag empty state for enabled business types.
  if (
    item.label === 'Repairs' &&
    !isRepairsBusinessType(ctx.merchant?.business_type)
  ) {
    return false;
  }

  // Owners always see everything
  if (ctx.staffAccess.isOwner) return true;

  if (item.label === 'Migrations') {
    return (
      ctx.hasPermission('settings', 'edit') ||
      ctx.hasPermission('orders', 'edit') ||
      ctx.hasPermission('products', 'create')
    );
  }

  const resource = resourceMap[item.label];
  if (resource) {
    // For menu visibility, we generally check for 'view' permission
    return ctx.hasPermission(resource, 'view');
  }

  return true;
}

export function filterDashboardNavItems(
  items: DashboardNavItem[],
  ctx: DashboardNavFilterContext
): DashboardNavItem[] {
  return items.flatMap((item): DashboardNavItem[] => {
    if (!canShowNavItem(item, ctx)) {
      return [];
    }

    const children = item.children?.filter((child) =>
      canShowNavItem(child, ctx)
    );
    return [
      {
        ...item,
        children: children && children.length > 0 ? children : undefined,
      },
    ];
  });
}
