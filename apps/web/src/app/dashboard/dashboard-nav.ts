import {
  BarChart3,
  Bot,
  FileText,
  Gift,
  Globe,
  LayoutDashboard,
  LayoutTemplate,
  Megaphone,
  MessageCircle,
  Newspaper,
  Package,
  Paintbrush,
  Search,
  Settings,
  ShoppingCart,
  Store,
  Tag,
  Trophy,
  UploadCloud,
  UserCog,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import type { Route } from 'next';
import type { MerchantData, StaffAccess } from '@/hooks/merchant/types';
import { isRepairsBusinessType } from '@/lib/repairs/repairs-feature';
import { isSantaCampaignVisible } from './santa-navigation';

export type DashboardNavItem = {
  id: string;
  href: Route;
  icon: typeof LayoutDashboard;
  label: string;
  badge?: number;
  badgeVariant?: 'default' | 'destructive';
  children?: DashboardNavItem[];
};

export function flattenDashboardNavItems(
  items: DashboardNavItem[]
): DashboardNavItem[] {
  return items.flatMap((item) => {
    const { children, ...itemWithoutChildren } = item;
    return [itemWithoutChildren, ...flattenDashboardNavItems(children ?? [])];
  });
}

export function buildDashboardNavItems(
  ordersCount: number
): DashboardNavItem[] {
  return [
    {
      id: 'dashboard',
      href: '/dashboard' as Route,
      icon: LayoutDashboard,
      label: 'Dashboard',
    },
    {
      id: 'analytics',
      href: '/dashboard/analytics' as Route,
      icon: BarChart3,
      label: 'Analytics',
    },
    {
      id: 'orders',
      href: '/dashboard/orders' as Route,
      icon: ShoppingCart,
      label: 'Orders',
      badge: ordersCount > 0 ? ordersCount : undefined,
    },
    {
      id: 'products',
      href: '/dashboard/products' as Route,
      icon: Package,
      label: 'Products',
    },
    {
      id: 'repairs',
      href: '/dashboard/repairs' as Route,
      icon: Wrench,
      label: 'Repairs',
    },
    {
      id: 'marketing',
      href: '/dashboard/marketing' as Route,
      icon: Megaphone,
      label: 'Marketing',
      children: [
        {
          id: 'discount-codes',
          href: '/dashboard/marketing/discount-codes' as Route,
          icon: Tag,
          label: 'Discount Codes',
        },
      ],
    },
    {
      id: 'blog',
      href: '/dashboard/blog' as Route,
      icon: Newspaper,
      label: 'Blog',
    },
    {
      id: 'marketplaces',
      href: '/dashboard/channels' as Route,
      icon: Store,
      label: 'Marketplaces',
    },
    {
      id: 'domains',
      href: '/dashboard/domains' as Route,
      icon: Globe,
      label: 'Domains',
    },
    {
      id: 'migrations',
      href: '/dashboard/migrations' as Route,
      icon: UploadCloud,
      label: 'Migrations',
    },
    {
      id: 'customers',
      href: '/dashboard/customers' as Route,
      icon: Users,
      label: 'Customers',
    },
    {
      id: 'staff',
      href: '/dashboard/staff' as Route,
      icon: UserCog,
      label: 'Staff',
    },
    {
      id: 'loyalty',
      href: '/dashboard/loyalty' as Route,
      icon: Gift,
      label: 'Loyalty',
    },
    {
      id: 'quiz',
      href: '/dashboard/quiz' as Route,
      icon: Trophy,
      label: 'Quiz',
    },
    {
      id: 'santa',
      href: '/dashboard/santa' as Route,
      icon: MessageCircle,
      label: 'Santa Campaign',
    },
    {
      id: 'wallet',
      href: '/dashboard/wallet' as Route,
      icon: Wallet,
      label: 'Wallet',
    },
    {
      id: 'seo',
      href: '/dashboard/seo' as Route,
      icon: Search,
      label: 'SEO',
    },
    {
      id: 'agentic',
      href: '/dashboard/agentic' as Route,
      icon: Bot,
      label: 'Agentic',
    },
    {
      id: 'pages',
      href: '/dashboard/pages' as Route,
      icon: FileText,
      label: 'Pages',
      // Badge disabled temporarily
    },
    {
      id: 'templates',
      href: '/dashboard/templates' as Route,
      icon: LayoutTemplate,
      label: 'Templates',
    },
    {
      id: 'customize',
      icon: Paintbrush,
      label: 'Customize Website',
      href: '/builder' as Route,
    },
    {
      id: 'settings',
      href: '/dashboard/settings' as Route,
      icon: Settings,
      label: 'Settings',
    },
  ];
}

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
