'use client';

import {
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shield,
  User,
  Users,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getAdminNavigationItems } from '@/config/admin-navigation';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { PlatformAdminContext } from '@/schemas/platform-admin-context';

function isActiveAdminPath(pathname: string, href: Route) {
  return pathname === href || (href !== '/admin' && pathname.startsWith(href));
}

export function AdminShell({
  adminContext,
  adminEmail,
  children,
}: {
  adminContext: PlatformAdminContext;
  adminEmail: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navItems = getAdminNavigationItems(adminContext.permissions);
  const adminHomeHref = navItems[0]?.href ?? '/admin';
  const canReadPlatformSettings =
    adminContext.permissions.includes('settings.read');

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to main content
      </a>
      <div
        className={cn(
          'grid min-h-screen w-full transition-all',
          isCollapsed
            ? 'md:grid-cols-[80px_1fr]'
            : 'md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]'
        )}
      >
        <div className="hidden border-r bg-card md:block">
          <div className="flex h-full max-h-screen flex-col">
            <div
              className={cn(
                'flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6',
                isCollapsed && 'justify-center'
              )}
            >
              <Link
                href={adminHomeHref}
                className="flex items-center gap-2 font-semibold"
              >
                <Logo />
                {!isCollapsed && (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
                    <Shield className="size-4 text-primary" />
                    Admin
                  </span>
                )}
              </Link>
            </div>
            <div className="flex-1 overflow-y-auto">
              <TooltipProvider>
                <nav
                  className="mt-2 grid items-start px-2 text-sm font-medium lg:px-4"
                  aria-label="Admin navigation"
                >
                  {navItems.map((item) => {
                    const isActive = isActiveAdminPath(pathname, item.href);
                    return (
                      <Link
                        key={item.label}
                        href={item.href}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary',
                          isActive && 'bg-muted text-primary',
                          isCollapsed && 'justify-center'
                        )}
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center gap-3">
                              <item.icon
                                className="size-4"
                                aria-hidden="true"
                              />
                              {!isCollapsed && <span>{item.label}</span>}
                            </span>
                          </TooltipTrigger>
                          {isCollapsed && (
                            <TooltipContent side="right">
                              {item.label}
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </Link>
                    );
                  })}
                  <div className="my-4 border-t" />
                  <Link
                    href="/dashboard"
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary',
                      isCollapsed && 'justify-center'
                    )}
                  >
                    <Users className="size-4" aria-hidden="true" />
                    {!isCollapsed && <span>Merchant Dashboard</span>}
                  </Link>
                </nav>
              </TooltipProvider>
            </div>
          </div>
        </div>

        <div className="relative flex flex-col">
          <Button
            variant="default"
            size="icon"
            onClick={() => setIsCollapsed((collapsed) => !collapsed)}
            className={cn(
              'fixed top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-primary text-primary-foreground transition-all hover:bg-primary/90 md:flex',
              isCollapsed ? 'left-[68px]' : 'left-[208px] lg:left-[268px]'
            )}
          >
            {isCollapsed ? (
              <PanelLeftOpen className="size-5" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-5" aria-hidden="true" />
            )}
            <span className="sr-only">
              {isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            </span>
          </Button>

          <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b bg-card px-4 lg:h-[60px] lg:px-6">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 md:hidden"
                >
                  <Menu className="size-5" aria-hidden="true" />
                  <span className="sr-only">Toggle navigation menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex flex-col">
                <nav
                  className="grid gap-2 text-lg font-medium"
                  aria-label="Mobile admin navigation"
                >
                  <Link
                    href={adminHomeHref}
                    className="mb-4 flex items-center gap-2 text-lg font-semibold"
                  >
                    <Logo />
                    <Shield className="size-4 text-primary" />
                    <span className="text-sm text-primary">Admin</span>
                  </Link>
                  {navItems.map((item) => {
                    const isActive = isActiveAdminPath(pathname, item.href);
                    return (
                      <Link
                        key={item.label}
                        href={item.href}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground',
                          isActive && 'bg-muted text-foreground'
                        )}
                      >
                        <item.icon className="size-5" aria-hidden="true" />
                        {item.label}
                      </Link>
                    );
                  })}
                  <div className="my-2 border-t" />
                  <Link
                    href="/dashboard"
                    className="mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground"
                  >
                    <Users className="size-5" aria-hidden="true" />
                    Merchant Dashboard
                  </Link>
                </nav>
              </SheetContent>
            </Sheet>

            <div className="w-full flex-1">
              <div className="flex items-center gap-2">
                <Shield className="size-4 text-primary" aria-hidden="true" />
                <span className="text-sm font-medium">Platform Admin</span>
                <span className="text-xs capitalize text-muted-foreground">
                  {adminContext.role}
                </span>
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="default" size="icon" className="rounded-full">
                  <User className="size-5" aria-hidden="true" />
                  <span className="sr-only">Toggle user menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {adminEmail ?? 'Admin Account'}
                </DropdownMenuLabel>
                {canReadPlatformSettings && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => router.push('/admin/settings')}
                    >
                      <Settings className="mr-2 size-4" aria-hidden="true" />
                      Platform Settings
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <LogOut className="mr-2 size-4" aria-hidden="true" />
                  <span>Logout</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <main
            id="main-content"
            className="flex flex-1 flex-col gap-4 overflow-y-auto bg-muted/30 p-4 lg:gap-6 lg:p-6"
          >
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
