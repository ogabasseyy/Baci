'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  type Dispatch,
  type SetStateAction,
  Suspense,
  useEffect,
  useState,
} from 'react';
import { useUpgradeModal } from '@/components/dashboard/upgrade-modal';
import { NotificationBanner } from '@/components/notifications/notification-banner';
import { BagLoader } from '@/components/ui/bag-loader';
import { useAuth } from '@/contexts/auth-context';
import { useMerchant } from '@/hooks/use-merchant-client';
import { getCountryByCode } from '@/lib/countries';
import { buildDashboardStoreUrl } from '@/lib/dashboard-store-url';
import { DashboardHeaderActions } from './dashboard-header-actions';
import { DashboardMobileBottomNav } from './dashboard-mobile-bottom-nav';
import { DashboardMobileNav } from './dashboard-mobile-nav';
import {
  buildDashboardNavItems,
  filterDashboardNavItems,
  flattenDashboardNavItems,
} from './dashboard-nav';
import { DashboardNavCapsule } from './dashboard-nav-capsule';
import {
  buildSmartNavStorageKey,
  getSmartShortcutItems,
  readSmartNavUsage,
  recordSmartNavUsage,
  type SmartNavUsage,
} from './smart-nav';
import { useOrdersCount } from './use-orders-count';

// The original layout is now a client component to prevent hydration errors.

// Re-exported so existing importers keep working; the type lives in ./dashboard-nav.
export type { DashboardNavItem } from './dashboard-nav';

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

  // Orders count for the sidebar badge - fetched lazily to not block initial render
  const ordersCount = useOrdersCount(merchant?.id);

  useEffect(() => {
    if (!merchant?.id) {
      return;
    }

    loadSmartNavUsage(merchant.id, setSmartNavUsage);
  }, [merchant?.id]);

  const selectedCountry = merchant?.country
    ? getCountryByCode(merchant.country)
    : null;

  const storeUrl = buildDashboardStoreUrl(merchant);

  const handleSignOut = async () => {
    await signOut();
    // Use hard navigation to clear all client-side state/cache and avoid re-fetching protected routes
    window.location.href = '/login';
  };

  const { hasPermission, staffAccess } = useMerchant();

  const navItems = buildDashboardNavItems(ordersCount);

  const filteredNavItems = filterDashboardNavItems(navItems, {
    merchant,
    agenticMerchantSlug,
    staffAccess,
    hasPermission,
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
          <DashboardMobileNav
            pathname={pathname}
            isSheetOpen={isSheetOpen}
            onSheetOpenChange={setIsSheetOpen}
            items={filteredNavItems}
            smartItems={smartNavItems}
            userEmail={user?.email}
            onNavItemClick={handleNavItemClick}
            onSignOut={handleSignOut}
          />

          <DashboardHeaderActions
            merchantLoading={merchantLoading}
            storeUrl={storeUrl}
            customDomain={merchant?.custom_domain}
            selectedCountry={selectedCountry}
            onSelectCountry={(countryCode) =>
              updateMerchant({ country: countryCode })
            }
            onSignOut={handleSignOut}
          />

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

      <DashboardMobileBottomNav
        pathname={pathname}
        ordersCount={ordersCount}
        onNavItemClick={handleNavItemClick}
        onMenuClick={() => setIsSheetOpen(true)}
      />
    </>
  );
}
