'use client';

import {
  BarChart3,
  Bot,
  ChevronDown,
  FileText,
  Gift,
  Globe,
  LayoutDashboard,
  LayoutTemplate,
  Loader2,
  LogOut,
  Megaphone,
  Menu,
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
  User,
  UserCog,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  type Dispatch,
  type SetStateAction,
  Suspense,
  useEffect,
  useState,
} from 'react';
import { useUpgradeModal } from '@/components/dashboard/upgrade-modal';
import { Logo } from '@/components/logo';
import { NotificationBanner } from '@/components/notifications/notification-banner';
import { NotificationCenter } from '@/components/notifications/notification-center';
import { Badge } from '@/components/ui/badge';
import { BagLoader } from '@/components/ui/bag-loader';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/auth-context';
import { useMerchant } from '@/hooks/use-merchant-client';
import { COUNTRIES, getCountryByCode } from '@/lib/countries';
import { isRepairsBusinessType } from '@/lib/repairs/repairs-feature';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { DashboardNavCapsule } from './dashboard-nav-capsule';
import { isSantaCampaignVisible } from './santa-navigation';
import {
  buildSmartNavStorageKey,
  getSmartShortcutItems,
  readSmartNavUsage,
  recordSmartNavUsage,
  type SmartNavUsage,
} from './smart-nav';

// The original layout is now a client component to prevent hydration errors.

export type DashboardNavItem = {
  id: string;
  href: Route;
  icon: typeof LayoutDashboard;
  label: string;
  badge?: number;
  badgeVariant?: 'default' | 'destructive';
  children?: DashboardNavItem[];
};

function flattenDashboardNavItems(
  items: DashboardNavItem[]
): DashboardNavItem[] {
  return items.flatMap((item) => {
    const { children, ...itemWithoutChildren } = item;
    return [itemWithoutChildren, ...flattenDashboardNavItems(children ?? [])];
  });
}

// Module-scope helper: dynamic import() expressions are not yet supported by
// React Compiler inside component bodies, so the lazy Supabase load lives here.
async function fetchOrdersCount(merchantId: string): Promise<number> {
  const { createClient } = await import('@/lib/supabase/client');
  const supabase = createClient();
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('merchant_id', merchantId);

  if (error) {
    return 0;
  }

  return count || 0;
}

// Module-scope helper: syncs the persisted smart-nav usage from localStorage
// once the merchant id is known (post-hydration external-store read).
function loadSmartNavUsage(
  merchantId: string,
  setUsage: Dispatch<SetStateAction<SmartNavUsage>>
): void {
  if (typeof window === 'undefined') {
    return;
  }

  const storageKey = buildSmartNavStorageKey(merchantId);
  setUsage(readSmartNavUsage(window.localStorage, storageKey));
}

const StoreLink = ({
  isMobile = false,
  isCollapsed,
  merchantLoading,
  storeUrl,
  customDomain,
}: {
  isMobile?: boolean;
  isCollapsed: boolean;
  merchantLoading: boolean;
  storeUrl: string;
  customDomain?: string;
}) => {
  const baseClassName = isMobile
    ? 'mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground'
    : cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground',
        isCollapsed && 'justify-center'
      );

  const isReady = !merchantLoading && storeUrl !== '#';

  if (!isReady) {
    const loadingContent = (
      <div className={cn(baseClassName, 'opacity-50 cursor-not-allowed')}>
        <Loader2
          className={cn(
            'size-4 motion-safe:animate-spin',
            isMobile && 'size-5'
          )}
        />
        {!isCollapsed && !isMobile && 'Visit Store'}
        {isMobile && 'Visit Store'}
      </div>
    );

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{loadingContent}</TooltipTrigger>
          <TooltipContent side="right">Loading store…</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const displayUrl = (() => {
    try {
      const url = new URL(storeUrl);
      return url.hostname;
    } catch {
      return 'Visit Store';
    }
  })();

  const linkContent = (
    <>
      <Store className={isMobile ? 'size-5' : 'size-4'} />
      {!isCollapsed && !isMobile && (
        <span className="font-medium text-foreground">{displayUrl}</span>
      )}
      {isMobile && (
        <span className="font-medium text-foreground">{displayUrl}</span>
      )}
    </>
  );

  // Validate that storeUrl is safe (relative or from trusted domain)
  // Only allow:
  // 1. Relative paths starting with /
  // 2. localhost URLs (development only)
  // 3. URLs ending with .usebaci.com (production)
  // 4. Custom domains that match merchant's custom_domain
  const isSafeUrl = (() => {
    if (storeUrl.startsWith('/') && !storeUrl.startsWith('//')) return true;
    if (storeUrl.startsWith('http://localhost:')) return true;

    try {
      const url = new URL(storeUrl);
      const trustedDomain =
        process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';

      // Allow custom domains that match merchant's custom_domain
      if (customDomain && url.hostname === customDomain) {
        return true;
      }

      // Ensure the hostname ends with our trusted domain (prevents subdomain takeover)
      return (
        url.hostname.endsWith(`.${trustedDomain}`) ||
        url.hostname === trustedDomain
      );
    } catch {
      return false;
    }
  })();
  let safeHref: Route = asRoute('/');
  if (isSafeUrl) {
    safeHref = asRoute(storeUrl);
  }

  return (
    <Link
      href={safeHref}
      className={cn(baseClassName, 'transition-all hover:text-primary')}
    >
      {isCollapsed && !isMobile ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{linkContent}</span>
            </TooltipTrigger>
            <TooltipContent side="right">Visit Store</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        linkContent
      )}
    </Link>
  );
};

export default function DashboardClientLayout({
  children,
  agenticMerchantSlug,
}: {
  children: React.ReactNode;
  agenticMerchantSlug?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { open: openUpgradeModal } = useUpgradeModal();
  const { merchant, loading: merchantLoading, updateMerchant } = useMerchant();
  const { user, loading: authLoading, signOut } = useAuth();
  const [isCapsuleExpanded, setIsCapsuleExpanded] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [smartNavUsage, setSmartNavUsage] = useState<SmartNavUsage>({});

  // Orders count for sidebar badge - fetched lazily to not block initial render
  const [ordersCount, setOrdersCount] = useState(0);

  // NOTE: Auth and onboarding redirects are now handled SERVER-SIDE in layout.tsx.
  // This effect is only for handling edge cases like session expiry during navigation.
  useEffect(() => {
    if (authLoading || user) return;

    // Wait briefly for potential session hydration, but restart the timer if auth
    // state changes so the safety net cannot be cancelled permanently.
    const timer = setTimeout(() => {
      router.push('/login');
    }, 500);

    return () => clearTimeout(timer);
  }, [user, authLoading, router]);

  // Orders count fetch effect
  useEffect(() => {
    let isMounted = true;

    // Only fetch if merchant exists and we're on dashboard
    // This is a lightweight call just for the badge count
    if (merchant?.id && ordersCount === 0) {
      // Use a simpler query just for count instead of full metrics
      fetchOrdersCount(merchant.id)
        .then((count) => {
          if (isMounted) {
            setOrdersCount(count);
          }
        })
        .catch(() => {
          if (isMounted) {
            setOrdersCount(0);
          }
        });
    }

    return () => {
      isMounted = false;
    };
  }, [merchant?.id, ordersCount]);

  useEffect(() => {
    if (!merchant?.id) {
      return;
    }

    loadSmartNavUsage(merchant.id, setSmartNavUsage);
  }, [merchant?.id]);

  const selectedCountry = merchant?.country
    ? getCountryByCode(merchant.country)
    : null;

  const getStoreUrl = () => {
    if (!merchant?.slug) return '#';

    const isDevelopment = process.env.NODE_ENV === 'development';

    if (isDevelopment) {
      // Use the running origin instead of a hardcoded port so any dev port
      // works. Falls back to :3000 during SSR, where window is unavailable.
      if (typeof window !== 'undefined') {
        return `${window.location.origin}/${merchant.slug}`;
      }
      return `http://localhost:3000/${merchant.slug}`;
    }

    // In production, prioritize custom domain
    if (merchant.custom_domain) {
      return `https://${merchant.custom_domain}`;
    }

    // Fallback to subdomain URL
    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';
    return `https://${merchant.slug}.${rootDomain}`;
  };

  const storeUrl = getStoreUrl();

  const handleSignOut = async () => {
    await signOut();
    // Use hard navigation to clear all client-side state/cache and avoid re-fetching protected routes
    window.location.href = '/login';
  };

  const navItems: DashboardNavItem[] = [
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

  const { hasPermission, staffAccess } = useMerchant();

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

  const canShowNavItem = (item: DashboardNavItem) => {
    // Santa Campaign is available only to the configured agentic tenant.
    if (
      item.label === 'Santa Campaign' &&
      !isSantaCampaignVisible(merchant?.slug, agenticMerchantSlug)
    ) {
      return false;
    }

    // Repairs catalogue is gated to electronics/gadgets merchants. The page
    // itself handles the feature-flag empty state for enabled business types.
    if (
      item.label === 'Repairs' &&
      !isRepairsBusinessType(merchant?.business_type)
    ) {
      return false;
    }

    // Owners always see everything
    if (staffAccess.isOwner) return true;

    if (item.label === 'Migrations') {
      return (
        hasPermission('settings', 'edit') ||
        hasPermission('orders', 'edit') ||
        hasPermission('products', 'create')
      );
    }

    const resource = resourceMap[item.label];
    if (resource) {
      // For menu visibility, we generally check for 'view' permission
      return hasPermission(resource, 'view');
    }

    return true;
  };

  const filteredNavItems = navItems.flatMap((item): DashboardNavItem[] => {
    if (!canShowNavItem(item)) {
      return [];
    }

    const children = item.children?.filter(canShowNavItem);
    return [
      {
        ...item,
        children: children && children.length > 0 ? children : undefined,
      },
    ];
  });

  const smartNavItems = getSmartShortcutItems({
    items: flattenDashboardNavItems(filteredNavItems),
    usage: smartNavUsage,
    urgentItemIds: ordersCount > 0 ? ['orders'] : [],
  });

  const handleNavItemClick = (itemId: string) => {
    if (!merchant?.id || typeof window === 'undefined') {
      return;
    }

    const storageKey = buildSmartNavStorageKey(merchant.id);
    const nextUsage = recordSmartNavUsage(
      window.localStorage,
      storageKey,
      itemId
    );
    setSmartNavUsage(nextUsage);
  };

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
          handleNavItemClick(item.id);
          setIsSheetOpen(false);
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

  // While checking auth OR if auth has succeeded but we are still waiting for the merchant,
  // show a full-page loading screen. This prevents content flashes and incorrect redirects.
  if (authLoading || (user && merchantLoading)) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center">
        <BagLoader size={64} />
      </div>
    );
  }

  // If after loading, there's still no user or no merchant, it means the redirect is in progress.
  // Render nothing to prevent a flash of the layout.
  if (!user || !merchant) {
    return null;
  }

  return (
    <>
      {/* Skip link for keyboard navigation */}

      <DashboardNavCapsule
        expanded={isCapsuleExpanded}
        items={filteredNavItems}
        pathname={pathname}
        onExpandedChange={setIsCapsuleExpanded}
        onNavigate={handleNavItemClick}
        onUpgrade={() => openUpgradeModal('ai_product_descriptions')}
      />

      <div className="grid min-h-screen w-full md:grid-cols-[92px_1fr]">
        <div aria-hidden="true" className="hidden md:block" />
        {/* Main Content Area */}
        <div className="flex flex-col relative min-h-screen overflow-x-hidden">
          {/* Mobile Header */}
          <header className="flex h-16 items-center gap-4 border-b bg-white/50 dark:bg-black/50 backdrop-blur-md px-4 md:hidden sticky top-0 z-20 transition-all duration-300">
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 md:hidden"
                >
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
                    {smartNavItems.length > 0 && (
                      <nav aria-label="Smart shortcuts" className="grid gap-2">
                        <span className="px-4 text-[10px] font-semibold uppercase text-muted-foreground/70">
                          Smart shortcuts
                        </span>
                        {smartNavItems.map((item) =>
                          renderMobileNavItem(item, `mobile-smart-${item.id}`)
                        )}
                        <div className="my-1 h-px bg-border" />
                      </nav>
                    )}
                    <nav className="grid gap-2" aria-label="Main navigation">
                      {filteredNavItems.map(renderMobileNavTree)}
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
                  <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* Desktop Header Actions (Refactored to Block for safety) */}
          <div className="hidden md:flex w-full justify-end items-center gap-3 px-6 pt-6 pb-2 z-20 bg-background/50 backdrop-blur-xs sticky top-0">
            <div className="flex items-center gap-2 p-1.5 rounded-full bg-white/60 dark:bg-black/40 backdrop-blur-xl border border-white/20 shadow-sm ml-auto">
              <StoreLink
                isMobile={false}
                isCollapsed={false}
                merchantLoading={merchantLoading}
                storeUrl={storeUrl}
                customDomain={merchant?.custom_domain}
              />
              <div className="w-px h-4 bg-border/50" />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-full px-3 gap-2 hover:bg-white/50"
                    aria-label="Select country"
                  >
                    {merchantLoading ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : selectedCountry ? (
                      <span className="text-lg leading-none">
                        {selectedCountry.flag}
                      </span>
                    ) : (
                      '🌐'
                    )}
                    <ChevronDown className="size-3 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[200px]">
                  <DropdownMenuLabel>Select Country</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {COUNTRIES.map((country) => (
                    <DropdownMenuItem
                      key={country.code}
                      onSelect={() => updateMerchant({ country: country.code })}
                    >
                      <span className="mr-2 text-lg">{country.flag}</span>
                      <span>{country.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="w-px h-4 bg-border/50" />

              <ThemeToggle />
              <NotificationCenter />

              <div className="w-px h-4 bg-border/50" />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-full hover:bg-white/50"
                    aria-label="User menu"
                  >
                    <User className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => router.push('/dashboard/settings')}
                  >
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleSignOut}
                    className="text-red-500"
                  >
                    <LogOut className="mr-2 size-4" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <main
            id="main-content"
            className="flex-1 transition-all duration-300 ease-in-out p-4 md:p-6 lg:p-8 overflow-auto"
          >
            <NotificationBanner />
            <Suspense
              fallback={
                <div className="flex h-screen items-center justify-center">
                  <BagLoader />
                </div>
              }
            >
              {children}
            </Suspense>
          </main>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/80 dark:bg-black/80 backdrop-blur-xl border-t border-white/20 safe-bottom">
        <div className="flex items-center justify-around h-16 px-2">
          <Link
            href="/dashboard"
            onClick={() => handleNavItemClick('dashboard')}
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
            onClick={() => handleNavItemClick('orders')}
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
            onClick={() => handleNavItemClick('products')}
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
            onClick={() => handleNavItemClick('customers')}
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
            onClick={() => setIsSheetOpen(true)}
            className={cn(
              'flex flex-col items-center justify-center gap-1 w-16 h-full transition-colors text-muted-foreground hover:text-foreground'
            )}
          >
            <Menu className="size-5" />
            <span className="text-[10px] font-medium">Menu</span>
          </button>
        </div>
      </div>
    </>
  );
}
