'use client';

import { Menu, User } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { NotificationCenter } from '@/components/notifications/notification-center';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { cn } from '@/lib/utils';
import type { DashboardNavItem } from './dashboard-nav';

export function DashboardMobileNav({
  pathname,
  isSheetOpen,
  onSheetOpenChange,
  items,
  smartItems,
  userEmail,
  onNavItemClick,
  onSignOut,
}: {
  pathname: string;
  isSheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  items: DashboardNavItem[];
  smartItems: DashboardNavItem[];
  userEmail?: string;
  onNavItemClick: (itemId: string) => void;
  onSignOut: () => void;
}) {
  const renderMobileNavItem = (
    item: DashboardNavItem,
    key: string,
    options: { isSubItem?: boolean } = {}
  ) => {
    const isExactActive = pathname === item.href;
    const hasActiveChild =
      item.children?.some((child) => pathname === child.href) ?? false;
    const isSectionActive =
      item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`);
    const isActive = isExactActive || hasActiveChild || isSectionActive;

    return (
      <Link
        key={key}
        href={item.href}
        aria-current={isExactActive ? 'page' : undefined}
        onClick={() => {
          onNavItemClick(item.id);
          onSheetOpenChange(false);
        }}
        className={cn(
          'flex items-center rounded-xl text-sm font-medium transition-all',
          options.isSubItem ? 'gap-2 px-3 py-2' : 'gap-3 px-4 py-3',
          isActive
            ? 'bg-primary text-primary-foreground shadow-md'
            : 'text-muted-foreground hover:bg-muted'
        )}
      >
        <item.icon className={options.isSubItem ? 'size-4' : 'size-5'} />
        {item.label}
        {item.badge && (
          <Badge className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent text-accent-foreground px-1.5 text-[10px]">
            {item.label === 'Pages' ? '!' : item.badge}
          </Badge>
        )}
      </Link>
    );
  };

  const renderMobileNavTree = (item: DashboardNavItem) => (
    <div key={item.id} className="grid gap-1">
      {renderMobileNavItem(item, item.id)}
      {item.children && item.children.length > 0 && (
        <ul
          aria-label={`${item.label} submenu`}
          className="ml-6 grid list-none gap-1 border-l border-border pl-3"
        >
          {item.children.map((child) => (
            <li key={child.id}>
              {renderMobileNavItem(child, child.id, { isSubItem: true })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <header className="flex h-16 items-center gap-4 border-b bg-white/50 dark:bg-black/50 backdrop-blur-md px-4 md:hidden sticky top-0 z-20 transition-all duration-300">
      <Sheet open={isSheetOpen} onOpenChange={onSheetOpenChange}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 md:hidden">
            <Menu className="size-5" />
            <span className="sr-only">Toggle navigation menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="flex flex-col w-[280px] p-0 border-r-0 bg-transparent shadow-none"
        >
          <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
          {/* Mobile Sheet Content - Reusing Glass Style */}
          <div className="h-full w-full rounded-r-3xl border-r border-y border-white/20 bg-white/90 dark:bg-black/90 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex h-20 items-center px-6 border-b border-white/10">
              <Link
                href="/dashboard"
                className="flex items-center gap-2 font-semibold"
              >
                <Logo />
              </Link>
            </div>
            <div className="grid gap-3 p-4 overflow-y-auto">
              {smartItems.length > 0 && (
                <nav aria-label="Smart shortcuts" className="grid gap-2">
                  <span className="px-4 text-[10px] font-semibold uppercase text-muted-foreground/70">
                    Smart shortcuts
                  </span>
                  {smartItems.map((item) =>
                    renderMobileNavItem(item, `mobile-smart-${item.id}`)
                  )}
                  <div className="my-1 h-px bg-border" />
                </nav>
              )}
              <nav className="grid gap-2" aria-label="Main navigation">
                {items.map(renderMobileNavTree)}
              </nav>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex justify-end items-center gap-2">
        <ThemeToggle />
        <NotificationCenter />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label="User menu"
            >
              <User className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{userEmail}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut}>Logout</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
