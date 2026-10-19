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

export type DashboardNavItem = {
  id: string;
  href: Route;
  icon: typeof LayoutDashboard;
  label: string;
  badge?: number;
  badgeVariant?: 'default' | 'destructive';
  children?: DashboardNavItem[];
};

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
