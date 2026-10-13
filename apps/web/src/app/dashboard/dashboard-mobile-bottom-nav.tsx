'use client';

import {
  LayoutDashboard,
  Menu,
  Package,
  ShoppingCart,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export function DashboardMobileBottomNav({
  pathname,
  ordersCount,
  onNavItemClick,
  onMenuClick,
}: {
  pathname: string;
  ordersCount: number;
  onNavItemClick: (itemId: string) => void;
  onMenuClick: () => void;
}) {
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/80 dark:bg-black/80 backdrop-blur-xl border-t border-white/20 safe-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        <Link
          href="/dashboard"
          onClick={() => onNavItemClick('dashboard')}
          className={cn(
            'flex flex-col items-center justify-center gap-1 w-16 h-full transition-colors',
            pathname === '/dashboard'
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <LayoutDashboard className="size-5" />
          <span className="text-[10px] font-medium">Home</span>
        </Link>
        <Link
          href="/dashboard/orders"
          onClick={() => onNavItemClick('orders')}
          className={cn(
            'flex flex-col items-center justify-center gap-1 w-16 h-full transition-colors relative',
            pathname === '/dashboard/orders'
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <div className="relative">
            <ShoppingCart className="size-5" />
            {ordersCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex size-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white ring-2 ring-background">
                {ordersCount}
              </span>
            )}
          </div>
          <span className="text-[10px] font-medium">Orders</span>
        </Link>
        <Link
          href="/dashboard/products"
          onClick={() => onNavItemClick('products')}
          className={cn(
            'flex flex-col items-center justify-center gap-1 w-16 h-full transition-colors',
            pathname === '/dashboard/products'
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Package className="size-5" />
          <span className="text-[10px] font-medium">Products</span>
        </Link>
        <Link
          href="/dashboard/customers"
          onClick={() => onNavItemClick('customers')}
          className={cn(
            'flex flex-col items-center justify-center gap-1 w-16 h-full transition-colors',
            pathname === '/dashboard/customers'
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Users className="size-5" />
          <span className="text-[10px] font-medium">Customers</span>
        </Link>
        <button
          type="button"
          onClick={onMenuClick}
          className={cn(
            'flex flex-col items-center justify-center gap-1 w-16 h-full transition-colors text-muted-foreground hover:text-foreground'
          )}
        >
          <Menu className="size-5" />
          <span className="text-[10px] font-medium">Menu</span>
        </button>
      </div>
    </div>
  );
}
