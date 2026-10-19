import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  Database,
  FileClock,
  KeyRound,
  LayoutDashboard,
  LayoutTemplate,
  PenSquare,
  Scale,
  Settings,
} from 'lucide-react';
import type { Route } from 'next';
import type { PlatformAdminPermission } from '@/config/platform-admin-rbac';

const adminNavigationItems = [
  {
    href: '/admin' as Route,
    icon: LayoutDashboard,
    label: 'Overview',
    permission: 'analytics.read',
  },
  {
    href: '/admin/merchants' as Route,
    icon: Building2,
    label: 'Merchants',
    permission: 'merchants.read',
  },
  {
    href: '/admin/analytics' as Route,
    icon: BarChart3,
    label: 'Analytics',
    permission: 'analytics.read',
  },
  {
    href: '/admin/reconciliation' as Route,
    icon: Scale,
    label: 'Reconciliation',
    permission: 'financials.read',
  },
  {
    href: '/admin/operations' as Route,
    icon: Activity,
    label: 'Operations',
    permission: 'operations.read',
  },
  {
    href: '/admin/audit' as Route,
    icon: FileClock,
    label: 'Audit Log',
    permission: 'audit.read',
  },
  {
    href: '/admin/system' as Route,
    icon: Database,
    label: 'System Health',
    permission: 'operations.read',
  },
  {
    href: '/admin/blog' as Route,
    icon: PenSquare,
    label: 'Blog',
    permission: 'content.manage',
  },
  {
    href: '/admin/notifications' as Route,
    icon: Bell,
    label: 'Notifications',
    permission: 'notifications.manage',
  },
  {
    href: '/admin/templates' as Route,
    icon: LayoutTemplate,
    label: 'Template Catalogue',
    permission: 'content.manage',
  },
  {
    href: '/admin/settings' as Route,
    icon: Settings,
    label: 'Platform Settings',
    permission: 'settings.read',
  },
  {
    href: '/admin/access' as Route,
    icon: KeyRound,
    label: 'Access',
    permission: 'roles.manage',
  },
] as const satisfies readonly {
  href: Route;
  icon: typeof LayoutDashboard;
  label: string;
  permission: PlatformAdminPermission;
}[];

export function getAdminNavigationItems(
  permissions: readonly PlatformAdminPermission[]
) {
  const allowed = new Set<PlatformAdminPermission>(permissions);
  return adminNavigationItems.filter((item) => allowed.has(item.permission));
}
